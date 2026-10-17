import { readLocal } from './storage';

const FULL_REFRESH_KEY = 'connectionsFullRefresh';

/**
 * How often inflow re-reads the whole connection list, as opposed to the
 * cheap check for new connections it makes on every visit.
 *
 * A full pass is the only thing that picks up changed headlines (a new job, a
 * new title), which is what roles and the Insights graphs are built from. It is
 * also the expensive part: one request per 40 people. So it is rare, and on a
 * large network rarer still.
 *
 *  - `auto`   — daily for a small network, weekly for a large one;
 *  - `weekly` — weekly regardless of size;
 *  - `manual` — only from "Refresh all connections now".
 *
 * The first load always runs, whatever the mode: without it there is no list.
 */
export type FullRefreshMode = 'auto' | 'weekly' | 'manual';

const MODES: FullRefreshMode[] = ['auto', 'weekly', 'manual'];

/** The parts of the background's sync result the UI explains to the user. */
export interface ConnectionsSyncStatus {
  loadingMore?: boolean;
  cooldownUntil?: number;
}

/**
 * One line telling the user why the list may be incomplete or not refreshing,
 * or null when there is nothing to say. Shared by the Connections list and the
 * Settings refresh button so they describe the same state the same way.
 */
export function connectionsSyncNotice(status: ConnectionsSyncStatus | undefined): string | null {
  if (!status) return null;
  if (status.cooldownUntil) {
    return 'LinkedIn asked inflow to slow down, so connections will refresh again in a few hours.';
  }
  if (status.loadingMore) {
    return 'Still loading your connections, a little at a time to stay gentle on LinkedIn. Newest first.';
  }
  return null;
}

export async function getFullRefreshMode(): Promise<FullRefreshMode> {
  const v = await readLocal<string>(FULL_REFRESH_KEY);
  return MODES.includes(v as FullRefreshMode) ? (v as FullRefreshMode) : 'auto';
}

export async function setFullRefreshMode(mode: FullRefreshMode): Promise<void> {
  try {
    await chrome.storage.local.set({ [FULL_REFRESH_KEY]: mode });
  } catch {
    // Storage unavailable: the default stands.
  }
}
