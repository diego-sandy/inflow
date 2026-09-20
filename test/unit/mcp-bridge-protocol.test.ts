/**
 * Bridge protocol — the message contract between the extension and the companion.
 * Pure logic: no real WebSocket, we drive it with fake inbound frames and assert
 * what it sends and how it reports status/activity.
 */
import { createBridgeSession, activityLabel } from '@/lib/mcp/bridge-protocol';

function harness(callTool = vi.fn(async () => ({ ok: true }))) {
  const sent: any[] = [];
  const status: { s: string; e?: string }[] = [];
  const activity: string[] = [];
  const session = createBridgeSession({
    token: 'CODE-123',
    tools: [{ name: 'search_connections', description: 'd', inputSchema: { type: 'object' } }],
    callTool,
    send: (m) => sent.push(m),
    onStatus: (s, e) => status.push({ s, e }),
    onActivity: (t) => activity.push(t),
  });
  return { session, sent, status, activity, callTool };
}

it('on open, authenticates and advertises tools', () => {
  const h = harness();
  h.session.open();
  expect(h.status[0].s).toBe('connecting');
  expect(h.sent[0]).toMatchObject({ type: 'hello', token: 'CODE-123' });
  expect(h.sent[0].tools[0].name).toBe('search_connections');
});

it('hello_ack marks connected', async () => {
  const h = harness();
  await h.session.handleMessage(JSON.stringify({ type: 'hello_ack' }));
  expect(h.status.map((x) => x.s)).toContain('connected');
  expect(h.activity).toContain('Connected to Claude');
});

it('error frame reports the reason', async () => {
  const h = harness();
  await h.session.handleMessage(JSON.stringify({ type: 'error', message: 'bad token' }));
  expect(h.status.at(-1)).toEqual({ s: 'error', e: 'bad token' });
});

it('answers ping with pong', async () => {
  const h = harness();
  await h.session.handleMessage(JSON.stringify({ type: 'ping' }));
  expect(h.sent).toEqual([{ type: 'pong' }]);
});

it('runs a tool call and returns the result, logging activity', async () => {
  const callTool = vi.fn(async () => ({ total: 3 }));
  const h = harness(callTool);
  await h.session.handleMessage(JSON.stringify({ type: 'call', id: 'x1', name: 'search_connections', args: { query: 'ada' } }));
  expect(callTool).toHaveBeenCalledWith('search_connections', { query: 'ada' });
  expect(h.sent[0]).toEqual({ type: 'result', id: 'x1', ok: true, data: { total: 3 } });
  expect(h.activity[0]).toMatch(/searched your connections.*ada/i);
});

it('reports a tool failure without throwing', async () => {
  const callTool = vi.fn(async () => { throw new Error('boom'); });
  const h = harness(callTool);
  await h.session.handleMessage(JSON.stringify({ type: 'call', id: 'x2', name: 'get_connection', args: {} }));
  expect(h.sent[0]).toEqual({ type: 'result', id: 'x2', ok: false, error: 'boom' });
});

it('ignores malformed frames', async () => {
  const h = harness();
  await h.session.handleMessage('not json');
  expect(h.sent).toEqual([]);
  expect(h.status).toEqual([]);
});

it('activityLabel describes known tools', () => {
  expect(activityLabel('list_connections', { role: 'Investor' })).toMatch(/Investor/);
  expect(activityLabel('get_network_stats')).toMatch(/network stats/i);
  expect(activityLabel('create_draft')).toMatch(/drafted a message/i);
  expect(activityLabel('mystery')).toMatch(/mystery/);
});
