/**
 * MCP action tools — what Claude can do on the account once the user allows it:
 * the switches (one per kind, actions off by default), and each action's rules
 * over a real (fake-indexeddb) database with the bridge mocked.
 */
import Dexie from 'dexie';

const sendBridgeMessage = vi.fn();
vi.mock('@/lib/bridge', () => ({
  sendBridgeMessage: (...args: any[]) => sendBridgeMessage(...args),
}));

import { switchDatabase, db } from '@/db/database';
import { callConnectorTool, callTool, toolDescriptors } from '@/lib/mcp/tools';
import {
  DEFAULT_MCP_PERMISSIONS,
  SEND_LIMIT_PER_HOUR,
  getMcpPermissions,
  setMcpPermission,
  type McpPermission,
} from '@/lib/mcp/permissions';
import { setLocalStore } from '../mocks/chrome';
import { useUIStore } from '@/store/ui-store';

const THEM = 'urn:li:fsd_profile:DANA';

function conv(over: Partial<any>): any {
  return {
    id: 'c' + Math.random().toString(36).slice(2),
    participantUrns: [THEM],
    participantNames: ['Dana Whitfield'],
    participantPictures: [],
    lastMessage: '',
    lastActivityAt: 1000,
    read: 1,
    archived: 0,
    category: 'PRIMARY_INBOX',
    ...over,
  };
}

function draft(over: Partial<any>): any {
  return {
    id: 'd' + Math.random().toString(36).slice(2),
    recipientUrns: [THEM],
    recipientName: 'Dana Whitfield',
    body: 'Hello',
    status: 'draft',
    createdAt: 1000,
    updatedAt: 1000,
    ...over,
  };
}

async function allow(...keys: McpPermission[]) {
  for (const k of keys) await setMcpPermission(k, true);
}

beforeEach(async () => {
  sendBridgeMessage.mockReset();
  sendBridgeMessage.mockResolvedValue({ success: true });
  await switchDatabase('MEMBER_MCP_ACTIONS');
  await db!.conversations.clear();
  await db!.messages.clear();
  await db!.scheduledMessages.clear();
  await db!.invitations.clear();
  await db!.pendingActions.clear();
  await db!.tombstones.clear();
  useUIStore.setState({ mcpActivity: [] });
});
afterEach(async () => {
  await Dexie.delete('InflowDB_MEMBER_MCP_ACTIONS').catch(() => {});
});

describe('switches', () => {
  it('start with reading on and every action off', async () => {
    expect(DEFAULT_MCP_PERMISSIONS).toEqual({ read: true, tidy: false, invitations: false, send: false, delete: false });
    expect(await getMcpPermissions()).toEqual(DEFAULT_MCP_PERMISSIONS);
  });

  it('remember a change, and ignore junk in storage', async () => {
    await setMcpPermission('tidy', true);
    expect((await getMcpPermissions()).tidy).toBe(true);
    setLocalStore('mcpPermissions', { send: 'yes', delete: true });
    expect(await getMcpPermissions()).toEqual({ ...DEFAULT_MCP_PERMISSIONS, delete: true });
  });

  it('every tool sits under exactly one switch, and all are advertised whatever the switches say', () => {
    const all = toolDescriptors().map((t) => t.name);
    expect(all).toEqual(expect.arrayContaining(['archive_conversations', 'send_message', 'send_draft', 'delete_conversation', 'respond_to_invitation']));
    const byGroup = (['read', 'tidy', 'invitations', 'send', 'delete'] as const).flatMap((p) => toolDescriptors([p]).map((t) => t.name));
    expect(byGroup.sort()).toEqual([...all].sort());
    expect(toolDescriptors(['send']).map((t) => t.name).sort()).toEqual(['send_draft', 'send_message']);
    expect(toolDescriptors(['delete']).map((t) => t.name)).toEqual(['delete_conversation']);
  });

  it('an action that is off is refused, says where to turn it on, and touches nothing', async () => {
    const c = conv({});
    await db!.conversations.add(c);
    await expect(callConnectorTool('archive_conversations', { conversationIds: [c.id] })).rejects.toThrow(
      /Tidy the inbox.*Settings › AI › Claude/,
    );
    expect(sendBridgeMessage).not.toHaveBeenCalled();
    expect((await db!.conversations.get(c.id))!.archived).toBe(0);
    expect(useUIStore.getState().mcpActivity[0].text).toMatch(/Blocked archive_conversations/);
  });

  it('turning reading off stops the read tools too', async () => {
    await setMcpPermission('read', false);
    await expect(callConnectorTool('list_conversations', {})).rejects.toThrow(/Read and draft/);
  });

  it('AI Chat (callTool with read only) cannot reach an action even when it is allowed', async () => {
    await allow('send');
    const c = conv({});
    await db!.conversations.add(c);
    await expect(callTool('send_message', { conversationId: c.id, body: 'hi' }, ['read'])).rejects.toThrow(/Unknown tool/);
    expect(sendBridgeMessage).not.toHaveBeenCalled();
  });
});

describe('tidy', () => {
  beforeEach(() => allow('tidy'));

  it('archives each conversation and the twin in the same folder, not one elsewhere', async () => {
    const main = conv({ id: 'main', lastActivityAt: 3 });
    const twin = conv({ id: 'twin', lastActivityAt: 2 });
    const archivedTwin = conv({ id: 'old', archived: 1, category: 'ARCHIVE' });
    const other = conv({ id: 'other', participantUrns: ['urn:li:fsd_profile:SAM'], participantNames: ['Sam Reyes'] });
    await db!.conversations.bulkAdd([main, twin, archivedTwin, other]);

    const res: any = await callConnectorTool('archive_conversations', { conversationIds: ['main', 'other'] });
    expect(res).toMatchObject({ done: 2, failed: 0 });
    const called = sendBridgeMessage.mock.calls.map((c) => c[0]);
    expect(called).toEqual([
      { type: 'ARCHIVE', conversationId: 'main' },
      { type: 'ARCHIVE', conversationId: 'twin' },
      { type: 'ARCHIVE', conversationId: 'other' },
    ]);
    for (const id of ['main', 'twin', 'other']) {
      expect(await db!.conversations.get(id)).toMatchObject({ archived: 1, category: 'ARCHIVE' });
    }
    expect((await db!.pendingActions.toArray()).every((a) => a.status === 'confirmed')).toBe(true);
  });

  it('rolls back and reports a conversation LinkedIn refused, while the rest go through', async () => {
    await db!.conversations.bulkAdd([
      conv({ id: 'a', participantUrns: ['urn:li:fsd_profile:A'] }),
      conv({ id: 'b', participantUrns: ['urn:li:fsd_profile:B'], category: 'SECONDARY_INBOX' }),
    ]);
    sendBridgeMessage.mockImplementation(async (m: any) =>
      m.conversationId === 'b' ? { success: false, error: 'HTTP 500' } : { success: true },
    );
    const res: any = await callConnectorTool('move_conversations', { conversationIds: ['a', 'b'], to: 'other' });
    expect(res.done).toBe(1);
    expect(res.results[1]).toMatchObject({ conversationId: 'b', ok: false, error: 'HTTP 500' });
    expect(await db!.conversations.get('a')).toMatchObject({ category: 'SECONDARY_INBOX' });
    // Put back where it was.
    expect(await db!.conversations.get('b')).toMatchObject({ category: 'SECONDARY_INBOX', archived: 0 });
  });

  it('reports an unknown id instead of throwing the whole batch away', async () => {
    await db!.conversations.add(conv({ id: 'a' }));
    const res: any = await callConnectorTool('star_conversations', { conversationIds: ['a', 'nope'] });
    expect(res.done).toBe(1);
    expect(res.results[1]).toMatchObject({ conversationId: 'nope', ok: false });
    expect(await db!.conversations.get('a')).toMatchObject({ starred: 1 });
  });

  it("won't act on a local draft conversation", async () => {
    await db!.conversations.add(conv({ id: 'draft-1', draft: 1 }));
    const res: any = await callConnectorTool('mark_conversations_read', { conversationIds: ['draft-1'] });
    expect(res.results[0].ok).toBe(false);
    expect(sendBridgeMessage).not.toHaveBeenCalled();
  });
});

describe('invitations', () => {
  const inv = (over: Partial<any> = {}): any => ({
    id: '123',
    sharedSecret: 's3cret',
    fromUrn: THEM,
    name: 'Dana Whitfield',
    headline: 'Billing lead at Harbor Lane Billing',
    pictureUrl: '',
    publicId: 'dana-whitfield-example',
    message: 'Hi!',
    sentAt: 5000,
    status: 'pending',
    mutualCount: 2,
    mutualNames: [],
    mutualPictures: [],
    ...over,
  });

  it('lists pending invitations under the read switch', async () => {
    await db!.invitations.add(inv());
    const res: any = await callConnectorTool('list_invitations', {});
    expect(res.results[0]).toMatchObject({ id: '123', name: 'Dana Whitfield', note: 'Hi!', mutualConnections: 2 });
    expect(res.results[0]).not.toHaveProperty('sharedSecret');
  });

  it('accepts with the stored shared secret once allowed', async () => {
    await db!.invitations.add(inv());
    await expect(callConnectorTool('respond_to_invitation', { invitationId: '123', action: 'accept' })).rejects.toThrow(/Answer invitations/);
    await allow('invitations');
    const res: any = await callConnectorTool('respond_to_invitation', { invitationId: '123', action: 'accept' });
    expect(res).toMatchObject({ done: true, action: 'accept' });
    expect(sendBridgeMessage).toHaveBeenCalledWith({
      type: 'RESPOND_INVITATION',
      invitationId: '123',
      sharedSecret: 's3cret',
      action: 'accept',
    });
  });
});

describe('sending', () => {
  beforeEach(() => allow('send'));

  it('send_message sends into the conversation and updates its preview', async () => {
    const c = conv({ id: 'c1' });
    await db!.conversations.add(c);
    const res: any = await callConnectorTool('send_message', { conversationId: 'c1', body: '  Thanks!  ' });
    expect(res.sent).toBe(true);
    expect(sendBridgeMessage).toHaveBeenCalledWith({ type: 'SEND_MESSAGE', conversationId: 'c1', body: 'Thanks!' });
    expect((await db!.conversations.get('c1'))!.lastMessage).toBe('Thanks!');
  });

  it("send_message refuses the thread whose InMail hasn't been answered", async () => {
    await db!.conversations.add(conv({ id: 'inmail' }));
    await db!.messages.add({
      id: 'm1', conversationId: 'inmail', senderUrn: 'me', senderName: 'You', senderPicture: '',
      body: 'Pitch', subject: 'Quick question', createdAt: 2000, isFromMe: true,
    } as any);
    await expect(callConnectorTool('send_message', { conversationId: 'inmail', body: 'Following up' })).rejects.toThrow(
      /haven't replied.*Nothing was sent/,
    );
    expect(sendBridgeMessage).not.toHaveBeenCalled();
  });

  it(`stops at ${SEND_LIMIT_PER_HOUR} sends an hour`, async () => {
    await db!.conversations.add(conv({ id: 'c1' }));
    for (let i = 0; i < SEND_LIMIT_PER_HOUR; i++) {
      await callConnectorTool('send_message', { conversationId: 'c1', body: `n${i}` });
    }
    await expect(callConnectorTool('send_message', { conversationId: 'c1', body: 'one more' })).rejects.toThrow(
      /in the last hour/,
    );
    expect(sendBridgeMessage).toHaveBeenCalledTimes(SEND_LIMIT_PER_HOUR);
  });

  it('send_draft sends a new conversation (as InMail when queued as one) and marks it sent', async () => {
    const d = draft({ inMailSubject: 'Hello there', source: 'user' });
    await db!.scheduledMessages.add(d);
    const res: any = await callConnectorTool('send_draft', { id: d.id });
    expect(res).toMatchObject({ sent: true, inMail: true });
    expect(sendBridgeMessage).toHaveBeenCalledWith({
      type: 'CREATE_CONVERSATION',
      recipientUrns: [THEM],
      body: 'Hello',
      inMail: { subject: 'Hello there' },
    });
    expect(await db!.scheduledMessages.get(d.id)).toMatchObject({ status: 'sent' });
  });

  it('send_draft keeps a draft held when they replied after it was written', async () => {
    await db!.conversations.add(conv({ id: 'c1' }));
    await db!.messages.add({
      id: 'm1', conversationId: 'c1', senderUrn: THEM, senderName: 'Dana', senderPicture: '',
      body: 'Actually…', createdAt: 5000, isFromMe: false,
    } as any);
    const d = draft({ conversationId: 'c1', createdAt: 1000 });
    await db!.scheduledMessages.add(d);
    await expect(callConnectorTool('send_draft', { id: d.id })).rejects.toThrow(/wrote after this draft/);
    expect(sendBridgeMessage).not.toHaveBeenCalled();
    expect(await db!.scheduledMessages.get(d.id)).toMatchObject({ status: 'draft' });
  });

  it("send_draft won't send Claude's InMail before the user confirms the person", async () => {
    const d = draft({ source: 'mcp', inMailSubject: 'Hi' });
    await db!.scheduledMessages.add(d);
    await expect(callConnectorTool('send_draft', { id: d.id })).rejects.toThrow(/not yet confirmed/);
    expect(sendBridgeMessage).not.toHaveBeenCalled();
  });

  it('send_draft records a LinkedIn failure on the draft', async () => {
    const d = draft({ conversationId: 'c9' });
    await db!.scheduledMessages.add(d);
    sendBridgeMessage.mockResolvedValue({ success: false, error: 'HTTP 422' });
    await expect(callConnectorTool('send_draft', { id: d.id })).rejects.toThrow(/HTTP 422/);
    expect(await db!.scheduledMessages.get(d.id)).toMatchObject({ status: 'failed', error: 'HTTP 422' });
  });
});

describe('deleting', () => {
  beforeEach(() => allow('delete'));

  it('deletes the conversation with its messages and leaves a tombstone', async () => {
    await db!.conversations.add(conv({ id: 'c1' }));
    await db!.messages.add({
      id: 'm1', conversationId: 'c1', senderUrn: THEM, senderName: 'Dana', senderPicture: '',
      body: 'x', createdAt: 1, isFromMe: false,
    } as any);
    const res: any = await callConnectorTool('delete_conversation', { conversationId: 'c1' });
    expect(res.deleted).toBe(true);
    expect(sendBridgeMessage).toHaveBeenCalledWith({ type: 'DELETE_CONVERSATION', conversationId: 'c1' });
    expect(await db!.conversations.get('c1')).toBeUndefined();
    expect(await db!.messages.get('m1')).toBeUndefined();
    expect(await db!.tombstones.get('c1')).toBeTruthy();
  });

  it('restores everything when LinkedIn refuses', async () => {
    await db!.conversations.add(conv({ id: 'c1' }));
    await db!.messages.add({
      id: 'm1', conversationId: 'c1', senderUrn: THEM, senderName: 'Dana', senderPicture: '',
      body: 'x', createdAt: 1, isFromMe: false,
    } as any);
    sendBridgeMessage.mockResolvedValue({ success: false, error: 'HTTP 500' });
    await expect(callConnectorTool('delete_conversation', { conversationId: 'c1' })).rejects.toThrow(/HTTP 500/);
    expect(await db!.conversations.get('c1')).toBeTruthy();
    expect(await db!.messages.get('m1')).toBeTruthy();
    expect(await db!.tombstones.get('c1')).toBeUndefined();
  });
});
