/**
 * Why a queued message should not go out yet, worked out from the messages
 * inflow has already synced. Two reasons, both about the recipient's side:
 *
 *  - `waiting`: the user sent this person an InMail and they have not
 *    answered. LinkedIn refuses any further message until they do — "You may
 *    not send another message until the recipient responds to your InMail."
 *    That used to be discovered by trying, and failing.
 *
 *  - `replied`: the person wrote to the user after this draft was written (or
 *    last reviewed). It may no longer fit what they said, so it waits for the
 *    user to look again rather than going out on its own. This is also what a
 *    `waiting` hold turns into once they answer: never a silent release.
 *
 * Shared by the Outbox (to show and gate), the background auto-send (to skip),
 * and the MCP tools (so Claude doesn't draft what cannot be sent).
 *
 * Only as good as the sync: an InMail sent long ago from linkedin.com that
 * inflow never fetched cannot be seen, and still fails at send time.
 */
import type { InflowDatabase } from '@/db/database';
import type { Message } from '@/types/message';
import type { ScheduledMessage } from '@/types/scheduled-message';

export type QueueHold =
  | {
      kind: 'waiting';
      /** When the unanswered InMail went out. */
      since: number;
      subject: string;
      conversationId: string;
    }
  | {
      kind: 'replied';
      /** When their newest message arrived. */
      at: number;
      conversationId: string;
    };

/** LinkedIn's wording for the refusal, so a failure it caused can be recognised. */
export const INMAIL_WAIT_ERROR_RE = /until the recipient responds to your InMail/i;

/** What we know about one person's side of their 1:1 threads. */
interface RecipientState {
  /** An InMail from the user that nothing from them has followed. */
  unanswered?: { at: number; subject: string; conversationId: string };
  /** Their newest message to the user. */
  lastFromThem?: { at: number; conversationId: string };
}

/**
 * Read the 1:1 threads with each recipient once, for a whole batch of queued
 * messages. Group threads are left out: a reply there is not an answer to an
 * InMail, nor necessarily about this draft.
 */
async function recipientStates(db: InflowDatabase, urns: Set<string>): Promise<Map<string, RecipientState>> {
  const states = new Map<string, RecipientState>();
  if (urns.size === 0) return states;
  const threads = await db.conversations
    .filter((c) => c.participantUrns?.length === 1 && urns.has(c.participantUrns[0]))
    .toArray();

  for (const conv of threads) {
    const urn = conv.participantUrns[0];
    const messages: Message[] = await db.messages
      .where('[conversationId+createdAt]')
      .between([conv.id, -Infinity], [conv.id, Infinity])
      .toArray();
    const state = states.get(urn) ?? {};

    let lastInMail: Message | undefined;
    let lastTheirs: Message | undefined;
    for (const m of messages) {
      if (m.status === 'failed') continue; // never reached them
      if (m.isFromMe && m.subject && (!lastInMail || m.createdAt > lastInMail.createdAt)) lastInMail = m;
      if (!m.isFromMe && (!lastTheirs || m.createdAt > lastTheirs.createdAt)) lastTheirs = m;
    }
    if (lastInMail && !(lastTheirs && lastTheirs.createdAt > lastInMail.createdAt)) {
      if (!state.unanswered || lastInMail.createdAt > state.unanswered.at) {
        state.unanswered = { at: lastInMail.createdAt, subject: lastInMail.subject!, conversationId: conv.id };
      }
    }
    if (lastTheirs && (!state.lastFromThem || lastTheirs.createdAt > state.lastFromThem.at)) {
      state.lastFromThem = { at: lastTheirs.createdAt, conversationId: conv.id };
    }
    states.set(urn, state);
  }
  return states;
}

function holdFor(msg: ScheduledMessage, state: RecipientState | undefined): QueueHold | null {
  if (!state) return null;
  // An InMail, or a reply into the very thread that is waiting: both are
  // "another message" as far as LinkedIn is concerned. A plain message to a
  // connection is not an InMail and is not held by this rule.
  const u = state.unanswered;
  if (u && (msg.inMailSubject !== undefined || msg.conversationId === u.conversationId)) {
    return { kind: 'waiting', since: u.at, subject: u.subject, conversationId: u.conversationId };
  }
  const t = state.lastFromThem;
  if (t && t.at > Math.max(msg.createdAt || 0, msg.reviewedAt || 0)) {
    return { kind: 'replied', at: t.at, conversationId: t.conversationId };
  }
  return null;
}

/** Only messages that could still go out can be held. */
function isPending(msg: ScheduledMessage): boolean {
  return msg.status === 'draft' || msg.status === 'scheduled' || msg.status === 'failed';
}

/** Holds for a batch of queued messages, keyed by message id. 1:1 only. */
export async function queueHolds(db: InflowDatabase, rows: ScheduledMessage[]): Promise<Map<string, QueueHold>> {
  const candidates = rows.filter((r) => isPending(r) && r.recipientUrns?.length === 1);
  const states = await recipientStates(db, new Set(candidates.map((r) => r.recipientUrns[0])));
  const holds = new Map<string, QueueHold>();
  for (const r of candidates) {
    const hold = holdFor(r, states.get(r.recipientUrns[0]));
    if (hold) holds.set(r.id, hold);
  }
  return holds;
}

/**
 * Whether a new InMail to this person would be refused right now — for a
 * draft that doesn't exist yet (Claude's create_draft).
 */
export async function unansweredInMail(
  db: InflowDatabase,
  recipientUrn: string,
): Promise<{ since: number; subject: string; conversationId: string } | null> {
  const state = (await recipientStates(db, new Set([recipientUrn]))).get(recipientUrn);
  return state?.unanswered ? { since: state.unanswered.at, subject: state.unanswered.subject, conversationId: state.unanswered.conversationId } : null;
}
