/**
 * MCP read tools — the toolbox inflow exposes to Claude. Verifies each tool's
 * shape and filtering over a real (fake-indexeddb) database.
 */
import Dexie from 'dexie';
import { switchDatabase, db } from '@/db/database';
import { toolDescriptors, callTool } from '@/lib/mcp/tools';
import type { Connection } from '@/types/connection';

function conn(over: Partial<Connection>): Connection {
  return {
    profileUrn: 'urn:li:fsd_profile:' + Math.random().toString(36).slice(2),
    connectionUrn: 'urn:li:fsd_connection:C',
    connectedAt: 1000,
    publicId: '',
    firstName: '',
    lastName: '',
    fullName: 'Someone',
    headline: '',
    pictureUrl: '',
    syncedAt: 0,
    ...over,
  };
}

beforeEach(async () => {
  await switchDatabase('MEMBER_MCP');
  await db!.connections.clear();
});
afterEach(async () => {
  await Dexie.delete('InflowDB_MEMBER_MCP').catch(() => {});
});

it('advertises the read tools with schemas and no send/write tool', () => {
  const names = toolDescriptors().map((t) => t.name);
  expect(names).toEqual(
    expect.arrayContaining(['list_connections', 'search_connections', 'get_connection', 'get_network_stats', 'get_conversation_summary']),
  );
  // Phase 1 is read-only — nothing that sends or mutates the account.
  expect(names.some((n) => /send|create|write|schedule/i.test(n))).toBe(false);
  for (const t of toolDescriptors()) expect(t.inputSchema).toHaveProperty('type', 'object');
});

it('list_connections filters by role and interest', async () => {
  await db!.connections.bulkAdd([
    conn({ profileUrn: 'a', fullName: 'Ada', roleCategory: 'Investor', interestTags: ['Investors'], connectedAt: 3 }),
    conn({ profileUrn: 'b', fullName: 'Alan', roleCategory: 'Engineering', connectedAt: 2 }),
    conn({ profileUrn: 'c', fullName: 'Grace', roleCategory: 'Investor', connectedAt: 1 }),
  ]);

  const byRole: any = await callTool('list_connections', { role: 'Investor' });
  expect(byRole.total).toBe(2);
  expect(byRole.results.map((r: any) => r.name)).toEqual(['Ada', 'Grace']); // most recent first

  const byInterest: any = await callTool('list_connections', { interest: 'Investors' });
  expect(byInterest.total).toBe(1);
  expect(byInterest.results[0].name).toBe('Ada');
});

it('search_connections matches name and headline', async () => {
  await db!.connections.bulkAdd([
    conn({ profileUrn: 'a', fullName: 'Ada Lovelace', headline: 'Mathematician' }),
    conn({ profileUrn: 'b', fullName: 'Alan Turing', headline: 'Cryptanalyst at Bletchley' }),
  ]);
  const byName: any = await callTool('search_connections', { query: 'ada' });
  expect(byName.results.map((r: any) => r.name)).toEqual(['Ada Lovelace']);
  const byHeadline: any = await callTool('search_connections', { query: 'bletchley' });
  expect(byHeadline.results.map((r: any) => r.name)).toEqual(['Alan Turing']);
});

it('get_connection returns full detail incl. conversation summary', async () => {
  await db!.connections.add(
    conn({ profileUrn: 'a', publicId: 'ada', fullName: 'Ada', aiSummary: 'A pioneer', conversationSummary: 'Chatted about looms' }),
  );
  const res: any = await callTool('get_connection', { publicId: 'ada' });
  expect(res.found).toBe(true);
  expect(res.connection.summary).toBe('A pioneer');
  expect(res.connection.conversationSummary).toBe('Chatted about looms');

  const miss: any = await callTool('get_connection', { profileUrn: 'nope' });
  expect(miss.found).toBe(false);
});

it('get_network_stats summarizes roles and firms', async () => {
  await db!.connections.bulkAdd([
    conn({ profileUrn: 'a', fullName: 'Ada', roleCategory: 'Investor', headline: 'Partner at Acme', categorizedAt: 1 }),
    conn({ profileUrn: 'b', fullName: 'Al', roleCategory: 'Investor', headline: 'GP at Acme', categorizedAt: 1 }),
    conn({ profileUrn: 'c', fullName: 'Gr', roleCategory: 'Founder', headline: 'CEO at Solo', categorizedAt: 1 }),
  ]);
  const res: any = await callTool('get_network_stats', {});
  expect(res.total).toBe(3);
  const investor = res.roles.find((r: any) => r.role === 'Investor');
  expect(investor.count).toBe(2);
  expect(res.topFirms.find((f: any) => f.name === 'Acme').count).toBe(2);
});

it('throws on an unknown tool', async () => {
  await expect(callTool('delete_everything', {})).rejects.toThrow(/unknown tool/i);
});
