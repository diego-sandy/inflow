import { readLocal } from '@/lib/storage';

/**
 * What Claude may do through the MCP connector, one switch per kind of thing.
 *
 * Reading (and drafting into the Outbox, which only the user can send from)
 * is on by default, as it always was. Every action that changes something on
 * LinkedIn starts off: the user turns each kind on in Settings › AI › Claude,
 * so nothing new happens to their account until they decide it should.
 *
 * Stored in chrome.storage like the send settings, so the tools see the same
 * value whichever context runs them.
 */
export type McpPermission = 'read' | 'tidy' | 'invitations' | 'send' | 'delete';

export type McpPermissions = Record<McpPermission, boolean>;

export const DEFAULT_MCP_PERMISSIONS: McpPermissions = {
  read: true,
  tidy: false,
  invitations: false,
  send: false,
  delete: false,
};

/** At most this many messages Claude sends in any rolling hour. */
export const SEND_LIMIT_PER_HOUR = 15;
const HOUR_MS = 60 * 60 * 1000;

export const MCP_PERMISSION_INFO: { key: McpPermission; label: string; description: string }[] = [
  {
    key: 'read',
    label: 'Read and draft',
    description:
      'Read your messages, connections and Outbox, and put drafts in the Outbox for you to send. Turning this off leaves Claude with nothing it can do.',
  },
  {
    key: 'tidy',
    label: 'Tidy the inbox',
    description: 'Archive and unarchive, mark read or unread, move between Focused and Other, and star.',
  },
  {
    key: 'invitations',
    label: 'Answer invitations',
    description: 'Accept or ignore connection requests you have received.',
  },
  {
    key: 'send',
    label: 'Send messages',
    description: `Reply in a conversation, or send a draft from the Outbox, at most ${SEND_LIMIT_PER_HOUR} an hour. Held drafts stay held: nothing goes to someone who hasn't answered your InMail, or who replied after the draft was written.`,
  },
  {
    key: 'delete',
    label: 'Delete conversations',
    description: 'Delete a conversation from your LinkedIn inbox. LinkedIn cannot bring it back.',
  },
];

const KEY = 'mcpPermissions';
const SEND_LOG_KEY = 'mcpSendLog';

export async function getMcpPermissions(): Promise<McpPermissions> {
  const stored = (await readLocal<Partial<McpPermissions>>(KEY)) || {};
  const out = { ...DEFAULT_MCP_PERMISSIONS };
  for (const k of Object.keys(out) as McpPermission[]) {
    if (typeof stored[k] === 'boolean') out[k] = stored[k] as boolean;
  }
  return out;
}

export async function setMcpPermission(key: McpPermission, on: boolean): Promise<McpPermissions> {
  const next = { ...(await getMcpPermissions()), [key]: on };
  try {
    await chrome.storage.local.set({ [KEY]: next });
  } catch {
    // Storage unavailable: the defaults stand, which keep actions off.
  }
  return next;
}

export function permissionLabel(key: McpPermission): string {
  return MCP_PERMISSION_INFO.find((p) => p.key === key)?.label ?? key;
}

/** The refusal Claude gets for a switch that is off: says why, and where it lives. */
export function permissionRefusal(key: McpPermission): string {
  const label = permissionLabel(key);
  return `The user hasn't allowed this: "${label}" is off in inflow's Settings › AI › Claude. Tell the user; only they can turn it on.`;
}

// One claim at a time, or two sends in the same tick both see 14 and both go.
let sendChain: Promise<unknown> = Promise.resolve();

/**
 * Take one of the hour's sends, or say when the next one frees up. Counted at
 * the attempt, not on success: a send that fails at LinkedIn still went out
 * as a request on the user's account.
 */
export function claimSendSlot(now = Date.now()): Promise<{ ok: true } | { ok: false; nextAt: number }> {
  const run = sendChain.then(async () => {
    const log = ((await readLocal<number[]>(SEND_LOG_KEY)) || []).filter((t) => now - t < HOUR_MS);
    if (log.length >= SEND_LIMIT_PER_HOUR) {
      return { ok: false as const, nextAt: Math.min(...log) + HOUR_MS };
    }
    log.push(now);
    try {
      await chrome.storage.local.set({ [SEND_LOG_KEY]: log });
    } catch {
      // Storage unavailable: nothing persists, so nothing can be counted either.
    }
    return { ok: true as const };
  });
  sendChain = run.catch(() => {});
  return run;
}
