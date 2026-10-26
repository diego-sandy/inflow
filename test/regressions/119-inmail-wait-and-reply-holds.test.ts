/**
 * Regression: follow-ups to unanswered InMails failed only at send time.
 *
 * LinkedIn allows one unanswered InMail per person: "You may not send another
 * message until the recipient responds to your InMail." Six of Claude's
 * follow-ups were drafted, approved and sent, and every one came back with
 * that error, though the unanswered InMails were already in the local data.
 *
 * Now (lib/queue-holds):
 *  - such a message is held as `waiting` instead of being attempted;
 *  - once they reply it becomes `replied`, never silently sendable, because a
 *    follow-up written before their reply may no longer fit. Any queued
 *    message whose recipient wrote after it was written is held the same way;
 *  - auto-send skips both;
 *  - Claude's create_draft refuses the InMail up front, and list_drafts says
 *    which drafts are held and why.
 */
import { switchDatabase, db } from '@/db/database';
import { makeConversation, makeMessage } from '../fixtures/factories';

const createConversation = vi.fn(async () => ({ conversationId: 'c-new' }));
const sendMessage = vi.fn(async () => undefined);
vi.mock('@/../entrypoints/background/api/messages', () => ({
  createConversation: (...a: any[]) => createConversation(...a),
  sendMessage: (...a: any[]) => sendMessage(...a),
}));
vi.mock('@/lib/send-settings', () => ({
  getAutoSendScheduled: async () => true,
  getConfirmRecipient: async () => true,
}));
vi.mock('@/lib/bridge', () => ({ sendBridgeMessage: vi.fn() }));

import { queueHolds, unansweredInMail, INMAIL_WAIT_ERROR_RE } from '@/lib/queue-holds';
import { runAutoSendTick } from '@/../entrypoints/background/auto-send';
import { callTool } from '@/lib/mcp/tools';

const DANA = 'urn:li:fsd_profile:DANA';
const OCT13 = Date.UTC(2026, 9, 13, 15, 11);
const OCT20 = Date.UTC(2026, 9, 20, 19, 58);
const OCT26 = Date.UTC(2026, 9, 26, 9, 0);

/** Dana's 1:1 thread with the user's InMail in it, optionally answered. */
async function inMailThread({ replyAt }: { replyAt?: number } = {}) {
  await db!.conversations.put(makeConversation({ id: 'conv-dana', participantUrns: [DANA], participantNames: ['Dana Whitfield'] }));
  await db!.messages.put(makeMessage({
    id: 'inmail-1', conversationId: 'conv-dana', isFromMe: true, createdAt: OCT13,
    subject: 'Coding at Harbor Lane Billing', body: 'Ms. Whitfield, …',
  }));
  if (replyAt) {
    await db!.messages.put(makeMessage({
      id: 'reply-1', conversationId: 'conv-dana', isFromMe: false, createdAt: replyAt, senderUrn: DANA, body: 'Thanks, tell me more',
    }));
  }
}

function queued(over: any = {}) {
  return {
    id: 'q' + Math.random().toString(36).slice(2),
    recipientUrns: [DANA],
    recipientName: 'Dana Whitfield',
    body: 'Following up on my note from last week…',
    inMailSubject: 'Re: Coding at Harbor Lane Billing',
    status: 'draft' as const,
    createdAt: OCT20,
    updatedAt: OCT20,
    ...over,
  };
}

beforeEach(async () => {
  await switchDatabase('holds-' + Math.random().toString(36).slice(2));
  createConversation.mockClear();
  sendMessage.mockClear();
});

describe('queueHolds', () => {
  it('holds a follow-up InMail while the first is unanswered', async () => {
    await inMailThread();
    const msg = queued();
    const hold = (await queueHolds(db!, [msg as any])).get(msg.id);
    expect(hold).toEqual({ kind: 'waiting', since: OCT13, subject: 'Coding at Harbor Lane Billing', conversationId: 'conv-dana' });
  });

  it('holds a reply into that same waiting thread too', async () => {
    await inMailThread();
    const msg = queued({ inMailSubject: undefined, conversationId: 'conv-dana' });
    expect((await queueHolds(db!, [msg as any])).get(msg.id)?.kind).toBe('waiting');
  });

  it('once they reply, the follow-up is held for review, not released', async () => {
    await inMailThread({ replyAt: OCT26 });
    const msg = queued();
    expect((await queueHolds(db!, [msg as any])).get(msg.id)).toEqual({ kind: 'replied', at: OCT26, conversationId: 'conv-dana' });
  });

  it('a review (edit, or "Still send it") after their reply clears it', async () => {
    await inMailThread({ replyAt: OCT26 });
    const msg = queued({ reviewedAt: OCT26 + 60_000 });
    expect((await queueHolds(db!, [msg as any])).has(msg.id)).toBe(false);
  });

  it('a draft written after their reply is not held', async () => {
    await inMailThread({ replyAt: OCT13 + 3600_000 });
    const msg = queued({ createdAt: OCT20 });
    expect((await queueHolds(db!, [msg as any])).has(msg.id)).toBe(false);
  });

  it('holds any queued message, not only InMail, when they wrote after it was written', async () => {
    await db!.conversations.put(makeConversation({ id: 'conv-zack', participantUrns: ['urn:li:fsd_profile:Z'] }));
    await db!.messages.put(makeMessage({ conversationId: 'conv-zack', isFromMe: false, createdAt: OCT26 }));
    const msg = queued({ recipientUrns: ['urn:li:fsd_profile:Z'], inMailSubject: undefined });
    expect((await queueHolds(db!, [msg as any])).get(msg.id)?.kind).toBe('replied');
  });

  it('does not hold a plain message to a connection over an old unanswered InMail', async () => {
    await inMailThread();
    const msg = queued({ inMailSubject: undefined, conversationId: undefined });
    expect((await queueHolds(db!, [msg as any])).has(msg.id)).toBe(false);
  });

  it('ignores group threads and InMails that never went out', async () => {
    await db!.conversations.put(makeConversation({ id: 'group', participantUrns: [DANA, 'urn:li:fsd_profile:OTHER'] }));
    await db!.messages.put(makeMessage({ conversationId: 'group', isFromMe: true, subject: 'Group hello', createdAt: OCT13 }));
    await db!.conversations.put(makeConversation({ id: 'conv-dana', participantUrns: [DANA] }));
    await db!.messages.put(makeMessage({ conversationId: 'conv-dana', isFromMe: true, subject: 'Failed one', createdAt: OCT13, status: 'failed' }));
    const msg = queued();
    expect((await queueHolds(db!, [msg as any])).has(msg.id)).toBe(false);
  });

  it('only pending messages are held', async () => {
    await inMailThread();
    const sent = queued({ status: 'sent' });
    expect((await queueHolds(db!, [sent as any])).has(sent.id)).toBe(false);
  });

  it('recognises LinkedIn’s refusal text', () => {
    expect(INMAIL_WAIT_ERROR_RE.test('You may not send another message until the recipient responds to your InMail.')).toBe(true);
  });
});

describe('auto-send', () => {
  it('skips a scheduled follow-up that is waiting for a reply, and one they have replied to since', async () => {
    const now = OCT26 + 3600_000;
    await inMailThread();
    await db!.scheduledMessages.add(queued({ id: 'w', status: 'scheduled', scheduledAt: now - 60_000 }) as any);
    await db!.conversations.put(makeConversation({ id: 'conv-zack', participantUrns: ['urn:li:fsd_profile:Z'] }));
    await db!.messages.put(makeMessage({ conversationId: 'conv-zack', isFromMe: false, createdAt: OCT26 }));
    await db!.scheduledMessages.add(queued({
      id: 'r', recipientUrns: ['urn:li:fsd_profile:Z'], recipientName: 'Zack', inMailSubject: undefined,
      status: 'scheduled', scheduledAt: now - 60_000,
    }) as any);

    await runAutoSendTick(now);

    expect(createConversation).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    expect((await db!.scheduledMessages.get('w'))!.status).toBe('scheduled');
    expect((await db!.scheduledMessages.get('r'))!.status).toBe('scheduled');
  });
});

describe('Claude’s tools', () => {
  it('create_draft refuses a second InMail to someone who has not answered the first', async () => {
    await inMailThread();
    await expect(
      callTool('create_draft', {
        profileUrn: DANA,
        body: 'Following up…',
        inMailSubject: 'Re: Coding at Harbor Lane Billing',
        recipientName: 'Dana Whitfield',
        profileUrl: 'https://www.linkedin.com/in/dana-whitfield-4471/',
      }),
    ).rejects.toThrow(/hasn't replied to the user's InMail of 2026-10-13 .*no draft was created/);
    expect(await db!.scheduledMessages.count()).toBe(0);
  });

  it('create_draft still drafts the InMail once they have replied', async () => {
    await inMailThread({ replyAt: OCT26 });
    const res: any = await callTool('create_draft', {
      profileUrn: DANA,
      body: 'Thanks for getting back to me…',
      inMailSubject: 'Re: Coding at Harbor Lane Billing',
      recipientName: 'Dana Whitfield',
      profileUrl: 'https://www.linkedin.com/in/dana-whitfield-4471/',
    });
    expect(res.created).toBe(true);
  });

  it('list_drafts says which drafts are held, and why', async () => {
    await inMailThread();
    await db!.scheduledMessages.add(queued({ id: 'w' }) as any);
    const res: any = await callTool('list_drafts', {});
    expect(res.results[0]).toMatchObject({
      held: 'waiting_for_inmail_reply',
      unansweredInMail: { subject: 'Coding at Harbor Lane Billing', sentAt: new Date(OCT13).toISOString() },
    });
  });

  it('unansweredInMail answers for a person, not a draft', async () => {
    await inMailThread();
    expect(await unansweredInMail(db!, DANA)).toMatchObject({ subject: 'Coding at Harbor Lane Billing' });
    expect(await unansweredInMail(db!, 'urn:li:fsd_profile:NOBODY')).toBeNull();
  });
});
