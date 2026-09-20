/**
 * MCP read tools — the "toolbox" inflow exposes to an external agent (Claude).
 *
 * These are transport-agnostic: pure async functions over the local database.
 * The bridge advertises {@link toolDescriptors} to the companion and routes
 * incoming calls through {@link callTool}. Phase 1 is read-only — nothing here
 * sends a message or writes to the account.
 */
import { db } from '@/db/database';
import { computeInsights, parseCompany } from '@/lib/connection-insights';
import type { Connection } from '@/types/connection';

export interface McpToolDescriptor {
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments (as MCP expects). */
  inputSchema: Record<string, unknown>;
}

export interface McpTool extends McpToolDescriptor {
  handler: (args: Record<string, any>) => Promise<unknown>;
}

/** Compact, agent-friendly view of a connection (drops heavy/UI-only fields). */
function shape(c: Connection) {
  return {
    name: c.fullName,
    profileUrn: c.profileUrn,
    publicId: c.publicId || undefined,
    headline: c.headline || undefined,
    company: parseCompany(c.headline || '') || undefined,
    role: c.roleCategory,
    interests: c.interestTags?.length ? c.interestTags : undefined,
    connectedAt: c.connectedAt || undefined,
    summary: c.aiSummary || undefined,
    hasConversation: !!c.conversationSummary,
  };
}

async function allConnections(): Promise<Connection[]> {
  if (!db) return [];
  return db.connections.toArray();
}

export const MCP_TOOLS: McpTool[] = [
  {
    name: 'list_connections',
    description:
      "List the user's LinkedIn connections, optionally filtered by role category or interest tag. Returns compact records; use get_connection for full detail.",
    inputSchema: {
      type: 'object',
      properties: {
        role: { type: 'string', description: 'Role category to filter by, e.g. "Investor", "Founder".' },
        interest: { type: 'string', description: 'Interest tag to filter by, e.g. "Investors".' },
        limit: { type: 'number', description: 'Max results (default 50, max 200).' },
        offset: { type: 'number', description: 'Number of results to skip, for paging.' },
      },
      additionalProperties: false,
    },
    handler: async ({ role, interest, limit, offset }) => {
      const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
      const off = Math.max(Number(offset) || 0, 0);
      let list = await allConnections();
      if (role) list = list.filter((c) => c.roleCategory === role);
      if (interest) list = list.filter((c) => c.interestTags?.includes(interest));
      list.sort((a, b) => (b.connectedAt || 0) - (a.connectedAt || 0));
      return { total: list.length, offset: off, results: list.slice(off, off + lim).map(shape) };
    },
  },
  {
    name: 'search_connections',
    description: "Search the user's connections by name or headline (case-insensitive substring).",
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to match against name and headline.' },
        limit: { type: 'number', description: 'Max results (default 25, max 100).' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    handler: async ({ query, limit }) => {
      const q = String(query || '').trim().toLowerCase();
      const lim = Math.min(Math.max(Number(limit) || 25, 1), 100);
      if (!q) return { total: 0, results: [] };
      const list = (await allConnections()).filter(
        (c) => c.fullName?.toLowerCase().includes(q) || (c.headline || '').toLowerCase().includes(q),
      );
      return { total: list.length, results: list.slice(0, lim).map(shape) };
    },
  },
  {
    name: 'get_connection',
    description:
      'Get full detail for one connection by profileUrn or publicId, including the AI summary and any conversation recap.',
    inputSchema: {
      type: 'object',
      properties: {
        profileUrn: { type: 'string' },
        publicId: { type: 'string' },
      },
      additionalProperties: false,
    },
    handler: async ({ profileUrn, publicId }) => {
      const list = await allConnections();
      const c = list.find(
        (x) => (profileUrn && x.profileUrn === profileUrn) || (publicId && x.publicId === publicId),
      );
      if (!c) return { found: false };
      return {
        found: true,
        connection: {
          ...shape(c),
          conversationSummary: c.conversationSummary || undefined,
        },
      };
    },
  },
  {
    name: 'get_network_stats',
    description:
      "Summary statistics about the user's network: totals, breakdown by role, top firms, and interest-tag counts.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => {
      const insights = computeInsights(await allConnections());
      return {
        total: insights.total,
        categorized: insights.categorized,
        uncategorized: insights.uncategorized,
        roles: insights.roles.map((r) => ({ role: r.role, count: r.count })),
        topFirms: insights.companies.slice(0, 15),
        interests: insights.interests,
      };
    },
  },
  {
    name: 'get_conversation_summary',
    description:
      'Get the AI recap of the message history with one connection (by profileUrn). Returns the summary text, not raw messages.',
    inputSchema: {
      type: 'object',
      properties: { profileUrn: { type: 'string' } },
      required: ['profileUrn'],
      additionalProperties: false,
    },
    handler: async ({ profileUrn }) => {
      const list = await allConnections();
      const c = list.find((x) => x.profileUrn === profileUrn);
      if (!c) return { found: false };
      return {
        found: true,
        name: c.fullName,
        hasConversation: !!c.conversationSummary,
        conversationSummary: c.conversationSummary || undefined,
      };
    },
  },
];

const BY_NAME = new Map(MCP_TOOLS.map((t) => [t.name, t]));

/** Tool metadata to advertise to the MCP client (no handlers). */
export function toolDescriptors(): McpToolDescriptor[] {
  return MCP_TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

/** Run a tool by name. Throws on an unknown tool. */
export async function callTool(name: string, args: Record<string, any> = {}): Promise<unknown> {
  const tool = BY_NAME.get(name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  return tool.handler(args || {});
}
