/**
 * MCP action tools: what Claude can DO on the user's LinkedIn account, as
 * opposed to read or draft. Each is gated by one switch in Settings › AI ›
 * Claude (see ./permissions), all off until the user turns them on; the gate
 * itself is applied in callConnectorTool, so these handlers assume it passed.
 *
 * Sending keeps every rule the Outbox has: held drafts stay held, a Claude
 * InMail whose recipient the user hasn't confirmed stays unsent, and there is
 * an hourly cap on top.
 */
import { db } from '@/db/database';
import { sendBridgeMessage } from '@/lib/bridge';
import { queueHolds, unansweredInMail } from '@/lib/queue-holds';
import { awaitsRecipientConfirmation } from '@/lib/scheduled-messages';
import { getConfirmRecipient } from '@/lib/send-settings';
import { useUIStore } from '@/store/ui-store';
import { claimSendSlot, SEND_LIMIT_PER_HOUR } from './permissions';
import { deleteConversation, tidyConversation, type TidyAction } from './conversation-actions';
import type { McpTool } from './tools';

const MAX_BATCH = 50;

function ids(v: unknown): string[] {
  const list = (Array.isArray(v) ? v : [v]).map((x) => String(x ?? '').trim()).filter(Boolean);
  if (list.length === 0) throw new Error('conversationIds is required');
  if (list.length > MAX_BATCH) throw new Error(`At most ${MAX_BATCH} conversations at a time`);
  return [...new Set(list)];
}

const idsSchema = {
  type: 'array',
  items: { type: 'string' },
  minItems: 1,
  maxItems: MAX_BATCH,
  description: `Conversation ids from list_conversations or search_messages (1–${MAX_BATCH}).`,
};

/** Run one tidy action over many conversations, one after another. */
async function tidyAll(conversationIds: unknown, action: TidyAction) {
  const results = [];
  for (const id of ids(conversationIds)) results.push(await tidyConversation(id, action));
  const done = results.filter((r) => r.ok).length;
  return { done, failed: results.length - done, results };
}

function tidyTool(name: string, action: TidyAction, what: string): McpTool {
  return {
    name,
    permission: 'tidy',
    description: `${what} on LinkedIn. Applies to each conversation and any duplicate thread LinkedIn keeps with the same person in the same folder, as inflow's inbox does. Waits for LinkedIn and reports each conversation's outcome. Needs the user's "Tidy the inbox" permission.`,
    inputSchema: {
      type: 'object',
      properties: { conversationIds: idsSchema },
      required: ['conversationIds'],
      additionalProperties: false,
    },
    handler: ({ conversationIds }) => tidyAll(conversationIds, action),
  };
}

function hhmm(ms: number): string {
  return new Date(ms).toISOString().slice(11, 16) + ' UTC';
}

async function takeSendSlot(): Promise<void> {
  const slot = await claimSendSlot();
  if (!slot.ok) {
    throw new Error(
      `Claude has sent ${SEND_LIMIT_PER_HOUR} messages in the last hour, the most inflow allows. The next one can go at ${hhmm(slot.nextAt)}. Leave the rest as drafts for the user.`,
    );
  }
}

function logActivity(text: string) {
  useUIStore.getState().pushMcpActivity(text);
}

export const ACTION_TOOLS: McpTool[] = [
  tidyTool('archive_conversations', 'archive', 'Archive conversations'),
  tidyTool('unarchive_conversations', 'unarchive', 'Bring archived conversations back to Focused'),
  tidyTool('mark_conversations_read', 'markRead', 'Mark conversations read'),
  tidyTool('mark_conversations_unread', 'markUnread', 'Mark conversations unread'),
  {
    name: 'move_conversations',
    permission: 'tidy',
    description:
      "Move conversations between the Focused and Other inboxes on LinkedIn (this also takes them out of the archive). Applies to duplicate threads with the same person in the same folder too. Needs the user's \"Tidy the inbox\" permission.",
    inputSchema: {
      type: 'object',
      properties: {
        conversationIds: idsSchema,
        to: { type: 'string', enum: ['focused', 'other'], description: 'Where to move them.' },
      },
      required: ['conversationIds', 'to'],
      additionalProperties: false,
    },
    handler: ({ conversationIds, to }) => {
      if (to !== 'focused' && to !== 'other') throw new Error('to must be "focused" or "other"');
      return tidyAll(conversationIds, to);
    },
  },
  tidyTool('star_conversations', 'star', 'Star conversations'),
  tidyTool('unstar_conversations', 'unstar', 'Remove the star from conversations'),
  {
    name: 'list_invitations',
    permission: 'read',
    description:
      "List the connection requests the user has received and not yet answered: who, their headline, any note, when, and mutual connections. Pass refresh: true to check LinkedIn first (otherwise this reads what inflow last fetched). Use the id with respond_to_invitation.",
    inputSchema: {
      type: 'object',
      properties: {
        refresh: { type: 'boolean', description: 'Fetch the current list from LinkedIn first. Default false.' },
      },
      additionalProperties: false,
    },
    handler: async ({ refresh }) => {
      if (!db) return { total: 0, results: [] };
      if (refresh) {
        const res = await sendBridgeMessage({ type: 'FETCH_INVITATIONS' });
        if (!res?.success) throw new Error(res?.error || 'Could not fetch invitations from LinkedIn');
      }
      const rows = (await db.invitations.toArray())
        .filter((i) => i.status === 'pending')
        .sort((a, b) => b.sentAt - a.sentAt);
      return {
        total: rows.length,
        results: rows.map((i) => ({
          id: i.id,
          name: i.name,
          headline: i.headline || undefined,
          note: i.message || undefined,
          sentAt: i.sentAt ? new Date(i.sentAt).toISOString() : undefined,
          mutualConnections: i.mutualCount || 0,
          profileUrl: i.publicId ? `https://www.linkedin.com/in/${i.publicId}/` : undefined,
        })),
      };
    },
  },
  {
    name: 'respond_to_invitation',
    permission: 'invitations',
    description:
      "Accept or ignore a connection request the user received, by its id from list_invitations. Accepting makes them a first-degree connection; ignoring removes the request without telling them. Needs the user's \"Answer invitations\" permission.",
    inputSchema: {
      type: 'object',
      properties: {
        invitationId: { type: 'string', description: 'Invitation id from list_invitations.' },
        action: { type: 'string', enum: ['accept', 'ignore'] },
      },
      required: ['invitationId', 'action'],
      additionalProperties: false,
    },
    handler: async ({ invitationId, action }) => {
      if (!db) throw new Error('Database unavailable');
      if (action !== 'accept' && action !== 'ignore') throw new Error('action must be "accept" or "ignore"');
      const inv = await db.invitations.get(String(invitationId || ''));
      if (!inv || inv.status !== 'pending') {
        throw new Error('No pending invitation with that id — list_invitations (refresh: true) shows the current ones');
      }
      const res = await sendBridgeMessage({
        type: 'RESPOND_INVITATION',
        invitationId: inv.id,
        sharedSecret: inv.sharedSecret,
        action,
      });
      if (!res?.success) throw new Error(res?.error || `LinkedIn would not ${action} it`);
      logActivity(`Claude ${action === 'accept' ? 'accepted' : 'ignored'} ${inv.name}'s invitation`);
      return { done: true, action, name: inv.name };
    },
  },
  {
    name: 'send_message',
    permission: 'send',
    description: `Send a message now in an existing conversation, as the user. This really sends: there is no review step and no undo, so only send what the user asked for or approved, and prefer create_draft when in doubt. Refused if the other person hasn't answered the user's InMail (LinkedIn would not deliver it). At most ${SEND_LIMIT_PER_HOUR} sends an hour across send_message and send_draft. Needs the user's "Send messages" permission. To write to someone with no conversation yet, create_draft then send_draft.`,
    inputSchema: {
      type: 'object',
      properties: {
        conversationId: { type: 'string', description: 'Conversation id from list_conversations or search_messages.' },
        body: { type: 'string', description: 'The message text.' },
      },
      required: ['conversationId', 'body'],
      additionalProperties: false,
    },
    handler: async ({ conversationId, body }) => {
      if (!db) throw new Error('Database unavailable');
      const text = String(body || '').trim();
      if (!text) throw new Error('body is required');
      const conv = await db.conversations.get(String(conversationId || ''));
      if (!conv) throw new Error('No conversation with that id — list_conversations shows the ids');
      if (conv.draft === 1 || conv.id.startsWith('draft-')) {
        throw new Error('That is an unsent draft inside inflow, not a LinkedIn conversation');
      }
      if (conv.participantUrns.length === 1) {
        // Only the thread that is waiting, as in the Outbox's hold: a plain
        // message to a connection in another thread is not "another InMail".
        const pending = await unansweredInMail(db, conv.participantUrns[0]);
        if (pending && pending.conversationId === conv.id) {
          throw new Error(
            `They haven't replied to the user's InMail of ${new Date(pending.since).toISOString().slice(0, 10)} ("${pending.subject}"), so LinkedIn will not deliver another message until they do. Nothing was sent.`,
          );
        }
      }
      await takeSendSlot();
      const res = await sendBridgeMessage({ type: 'SEND_MESSAGE', conversationId: conv.id, body: text });
      if (!res?.success) throw new Error(res?.error || 'LinkedIn did not accept the message');
      await db.conversations.update(conv.id, { lastMessage: text, lastActivityAt: Date.now(), read: 1 });
      const to = (conv.participantNames || []).filter(Boolean).join(', ') || 'a conversation';
      logActivity(`Claude sent a message to ${to}`);
      return { sent: true, conversationId: conv.id, to: conv.participantNames };
    },
  },
  {
    name: 'send_draft',
    permission: 'send',
    description: `Send a draft or scheduled message from the user's Outbox now, by its id from list_drafts. This really sends, and an InMail spends a credit. It keeps the Outbox's rules: refused while the draft is held (the person hasn't answered an earlier InMail, or replied after it was written) or while a Claude InMail still awaits the user's recipient confirmation. At most ${SEND_LIMIT_PER_HOUR} sends an hour across send_message and send_draft. Needs the user's "Send messages" permission.`,
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Draft id from list_drafts.' } },
      required: ['id'],
      additionalProperties: false,
    },
    handler: async ({ id }) => {
      if (!db) throw new Error('Database unavailable');
      const row = await db.scheduledMessages.get(String(id || ''));
      if (!row) throw new Error('No draft with that id — list_drafts shows what is there');
      if (row.status === 'sent') throw new Error('That message was already sent');
      if (row.status === 'sending') throw new Error('That message is being sent right now');

      const hold = (await queueHolds(db, [row])).get(row.id);
      if (hold?.kind === 'waiting') {
        throw new Error(
          `Held: ${row.recipientName} hasn't replied to the user's InMail of ${new Date(hold.since).toISOString().slice(0, 10)}, so LinkedIn will not deliver this. Nothing was sent.`,
        );
      }
      if (hold) {
        throw new Error(
          `Held: ${row.recipientName} wrote after this draft was written, so the user needs to look at it again in the Outbox. Nothing was sent.`,
        );
      }
      if (awaitsRecipientConfirmation(row, await getConfirmRecipient())) {
        throw new Error(
          'The user has not yet confirmed this InMail goes to the right person (they do that in the Outbox by opening the profile). Nothing was sent.',
        );
      }

      // Claim it, or a scheduled tick or a click could send it a second time.
      const claimed = await db.scheduledMessages
        .where('id')
        .equals(row.id)
        .modify((r) => {
          if (r.status !== 'draft' && r.status !== 'scheduled' && r.status !== 'failed') return;
          r.status = 'sending';
          r.updatedAt = Date.now();
        });
      if (!claimed) throw new Error('That message is already being sent');

      try {
        await takeSendSlot();
      } catch (e) {
        await db.scheduledMessages.update(row.id, { status: row.status, updatedAt: Date.now() });
        throw e;
      }

      let error: string | undefined;
      try {
        const res = row.conversationId
          ? await sendBridgeMessage({ type: 'SEND_MESSAGE', conversationId: row.conversationId, body: row.body })
          : await sendBridgeMessage({
              type: 'CREATE_CONVERSATION',
              recipientUrns: row.recipientUrns,
              body: row.body,
              ...(row.inMailSubject !== undefined ? { inMail: { subject: row.inMailSubject } } : {}),
            });
        if (!res?.success) error = res?.error || 'Send failed';
      } catch (e: any) {
        error = e?.message || 'Send failed';
      }
      if (error) {
        await db.scheduledMessages.update(row.id, { status: 'failed', error, updatedAt: Date.now() });
        throw new Error(`LinkedIn did not send it: ${error}`);
      }
      await db.scheduledMessages.update(row.id, { status: 'sent', sentAt: Date.now(), updatedAt: Date.now() });
      logActivity(`Claude sent your draft to ${row.recipientName || 'Unknown'}`);
      return { sent: true, id: row.id, to: row.recipientName, inMail: row.inMailSubject !== undefined };
    },
  },
  {
    name: 'delete_conversation',
    permission: 'delete',
    description:
      "Delete a conversation from the user's LinkedIn inbox, with any duplicate thread with the same person in the same folder. Permanent: LinkedIn cannot restore it. Only do this when the user asked for that conversation to be deleted; archive_conversations is the reversible way to clear the inbox. Needs the user's \"Delete conversations\" permission.",
    inputSchema: {
      type: 'object',
      properties: { conversationId: { type: 'string', description: 'Conversation id from list_conversations.' } },
      required: ['conversationId'],
      additionalProperties: false,
    },
    handler: async ({ conversationId }) => {
      const out = await deleteConversation(String(conversationId || ''));
      if (!out.ok) throw new Error(out.error || 'Delete failed');
      logActivity(`Claude deleted the conversation with ${(out.with || []).filter(Boolean).join(', ') || 'someone'}`);
      return { deleted: true, conversationId: out.conversationId, with: out.with };
    },
  },
];
