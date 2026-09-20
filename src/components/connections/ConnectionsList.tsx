import { useEffect, useMemo, useRef, useState } from 'react';
import { GroupAvatar } from '../common/GroupAvatar';
import { useConnections } from '@/hooks/useConnections';
import { useAutoCategorize } from '@/hooks/useAutoCategorize';
import { useAISession } from '@/hooks/useAISession';
import { useCategorizeMode } from '@/hooks/useCategorizeMode';
import { useUIStore, EMPTY_CONNECTION_FILTER, type ConnectionFilter } from '@/store/ui-store';
import { sendBridgeMessage } from '@/lib/bridge';
import { maybeAutoBackup } from '@/lib/backup-service';
import { db } from '@/db/database';
import { connectionProfileUrl, roleBadgeClass, interestTagClass } from './connection-format';
import { SparkleIcon } from '@/components/common/SparkleIcon';
import { ROLE_CATEGORIES, type ConnectionRole } from '@/types/connection';
import { InterestsEditor } from './InterestsEditor';
import { ConnectionContextMenu } from './ConnectionContextMenu';
import type { Connection } from '@/types/connection';

function filterMatches(c: Connection, f: ConnectionFilter): boolean {
  const roleOk = f.roles.length === 0 || (!!c.roleCategory && f.roles.includes(c.roleCategory));
  const tags = c.interestTags ?? [];
  const interestOk = f.interests.length === 0 || f.interests.some((t) => tags.includes(t));
  return roleOk && interestOk;
}

type SortMode = 'recent' | 'first' | 'last';

const SORT_OPTIONS: { id: SortMode; label: string }[] = [
  { id: 'recent', label: 'Recently added' },
  { id: 'first', label: 'First name' },
  { id: 'last', label: 'Last name' },
];

const SORT_KEY = 'inflow-connections-sort';
function getStoredSort(): SortMode {
  try {
    const s = localStorage.getItem(SORT_KEY);
    if (s === 'recent' || s === 'first' || s === 'last') return s;
  } catch {}
  return 'recent';
}
function saveSort(mode: SortMode) {
  try {
    localStorage.setItem(SORT_KEY, mode);
  } catch {}
}

/** Sort a copy of the list by the chosen mode (default: most recent first). */
function sortConnections(list: Connection[], mode: SortMode): Connection[] {
  const arr = [...list];
  if (mode === 'first') {
    arr.sort((a, b) => a.fullName.localeCompare(b.fullName) || b.connectedAt - a.connectedAt);
  } else if (mode === 'last') {
    arr.sort(
      (a, b) =>
        (a.lastName || '').localeCompare(b.lastName || '') ||
        (a.firstName || '').localeCompare(b.firstName || '') ||
        b.connectedAt - a.connectedAt,
    );
  } else {
    arr.sort((a, b) => b.connectedAt - a.connectedAt);
  }
  return arr;
}

function searchMatches(c: Connection, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    c.fullName.toLowerCase().includes(needle) ||
    (c.headline || '').toLowerCase().includes(needle)
  );
}

function ConnectionRow({
  connection,
  selected,
  onSelect,
  onContextMenu,
}: {
  connection: Connection;
  selected: boolean;
  onSelect: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // Optional call: jsdom (tests) doesn't implement scrollIntoView.
    if (selected) ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);

  const name = connection.fullName || 'Unknown';
  const role = connection.roleCategory;
  const interestTags = connection.interestTags ?? [];
  return (
    <button
      ref={ref}
      type="button"
      data-connection-urn={connection.profileUrn}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors ${
        selected ? 'bg-surface-active' : 'hover:bg-surface-hover'
      }`}
    >
      <div className="shrink-0">
        <GroupAvatar names={[name]} pictures={[connection.pictureUrl]} size={40} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-fg-strong">{name}</span>
          {role && role !== 'Other' && (
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${roleBadgeClass(role)}`}
            >
              {role}
            </span>
          )}
        </div>
        {connection.headline && (
          <div className="truncate text-xs text-fg-secondary">{connection.headline}</div>
        )}
        {interestTags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {interestTags.map((t) => (
              <span
                key={t}
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${interestTagClass(t)}`}
              >
                ★ {t}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  );
}

/** A single checkbox row inside the Filter menu. */
function FilterMenuRow({
  label,
  count,
  checked,
  onToggle,
}: {
  label: React.ReactNode;
  count: number;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={onToggle}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-fg-secondary transition-colors hover:bg-surface-hover"
    >
      <span
        className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded ring-1 ring-inset ${
          checked ? 'bg-blue-500/80 ring-blue-500/80 text-white' : 'ring-edge'
        }`}
      >
        {checked && (
          <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        )}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 tabular-nums text-fg-faint">{count}</span>
    </button>
  );
}

/** A removable active-filter pill shown above the list. */
function ActivePill({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="flex shrink-0 items-center gap-1 rounded-full bg-blue-500/15 py-0.5 pl-2.5 pr-1 text-[11px] font-medium text-blue-700 ring-1 ring-inset ring-blue-500/30 dark:text-blue-300">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label} filter`}
        className="flex h-4 w-4 items-center justify-center rounded-full text-blue-700/70 transition-colors hover:bg-blue-500/20 dark:text-blue-300/70"
      >
        ×
      </button>
    </span>
  );
}

export function ConnectionsList() {
  const { connections, isLoading } = useConnections();
  const selected = useUIStore((s) => s.selectedConnectionUrn);
  const setSelected = useUIStore((s) => s.setSelectedConnectionUrn);
  const showToast = useUIStore((s) => s.showToast);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Filter + search live in the store so Insights can drill in with them set.
  const filter = useUIStore((s) => s.connectionsFilter);
  const setFilter = useUIStore((s) => s.setConnectionsFilter);
  const query = useUIStore((s) => s.connectionsSearch);
  const setQuery = useUIStore((s) => s.setConnectionsSearch);
  const [editingInterests, setEditingInterests] = useState(false);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [sort, setSort] = useState<SortMode>(getStoredSort);

  const toggleRole = (r: ConnectionRole) => {
    const has = filter.roles.includes(r);
    setFilter({ ...filter, roles: has ? filter.roles.filter((x) => x !== r) : [...filter.roles, r] });
  };
  const toggleInterest = (t: string) => {
    const has = filter.interests.includes(t);
    setFilter({ ...filter, interests: has ? filter.interests.filter((x) => x !== t) : [...filter.interests, t] });
  };
  const activeCount = filter.roles.length + filter.interests.length;
  const [contextMenu, setContextMenu] = useState<{ connection: Connection; x: number; y: number } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const changeSort = (mode: SortMode) => {
    setSort(mode);
    saveSort(mode);
  };

  const { available: aiAvailable } = useAISession();
  const [categorizeMode, setCategorizeMode] = useCategorizeMode();
  const {
    categorizing,
    remaining,
    done,
    failed,
    error: aiError,
    uncategorized,
    retry: retryCategorize,
    categorizeNow,
  } = useAutoCategorize(connections);

  // When a categorization pass finishes: confirm with a toast and auto-backup.
  const wasCategorizing = useRef(false);
  useEffect(() => {
    if (wasCategorizing.current && !categorizing && done > 0) {
      showToast({ message: `Categorized ${done} connection${done === 1 ? '' : 's'}` });
      void maybeAutoBackup();
    }
    wasCategorizing.current = categorizing;
  }, [categorizing, done, showToast]);

  // Refresh from LinkedIn when the section mounts. The list still renders
  // immediately from IndexedDB while the fetch is in flight.
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setSyncing(true);
    sendBridgeMessage({ type: 'FETCH_CONNECTIONS' })
      .then((res) => {
        if (!cancelled && !res.success) setError(res.error || 'Failed to load connections');
      })
      .catch((e) => {
        if (!cancelled) setError(String(e?.message || e));
      })
      .finally(() => {
        if (!cancelled) setSyncing(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Counts per role / interest, plus the filtered view.
  const { roleCounts, interestCounts, visible } = useMemo(() => {
    const roles = new Map<ConnectionRole, number>();
    const interests = new Map<string, number>();
    for (const c of connections) {
      if (c.roleCategory) roles.set(c.roleCategory, (roles.get(c.roleCategory) ?? 0) + 1);
      for (const t of c.interestTags ?? []) interests.set(t, (interests.get(t) ?? 0) + 1);
    }
    const filtered = connections.filter(
      (c) => filterMatches(c, filter) && searchMatches(c, query),
    );
    return {
      roleCounts: roles,
      interestCounts: interests,
      visible: sortConnections(filtered, sort),
    };
  }, [connections, filter, query, sort]);

  // Auto-select the first visible connection (or reconcile a stale selection).
  useEffect(() => {
    if (visible.length === 0) return;
    if (!selected || !visible.some((c) => c.profileUrn === selected)) {
      setSelected(visible[0].profileUrn);
    }
  }, [visible, selected, setSelected]);

  // Keyboard navigation for the connections list: j/k (or arrows) move the
  // selection, Enter opens the selected person's profile. The global handler
  // (useKeyboard) yields to us while the Connections section is active.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // "/" jumps to the search box (mirrors the inbox).
      if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (visible.length === 0) return;
      const idx = Math.max(0, visible.findIndex((c) => c.profileUrn === selected));
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setSelected(visible[Math.min(idx + 1, visible.length - 1)].profileUrn);
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setSelected(visible[Math.max(idx - 1, 0)].profileUrn);
      } else if (e.key === 'Enter') {
        const c = visible[idx];
        if (c) {
          e.preventDefault();
          window.open(connectionProfileUrl(c.publicId, c.fullName || 'Unknown'), '_blank', 'noopener,noreferrer');
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, selected, setSelected]);

  const showEmpty = !isLoading && connections.length === 0 && !syncing;
  const showLoading = (isLoading || syncing) && connections.length === 0 && !error;

  const rolesPresent = ROLE_CATEGORIES.filter((r) => (roleCounts.get(r) ?? 0) > 0);
  const interestsPresent = [...interestCounts.keys()].sort();
  const hasFilters = rolesPresent.length > 0 || interestsPresent.length > 0;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-1.5 border-b border-edge px-4 py-2.5">
        <h2 className="text-sm font-semibold text-fg-strong">Connections</h2>
        {connections.length > 0 && (
          <span className="rounded-full bg-surface-input px-1.5 py-0.5 text-[11px] font-medium text-fg-muted">
            {connections.length}
          </span>
        )}
        {syncing && !categorizing && (
          <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-fg-muted border-t-transparent" title="Refreshing connections from LinkedIn" />
        )}
        <div className="ml-auto flex items-center gap-1">
          {/* Sort — lives in the header so the toolbar can give search more room. */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setSortMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={sortMenuOpen}
              aria-label="Sort connections"
              className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium text-fg-muted ring-1 ring-inset ring-edge transition-colors hover:text-fg-secondary"
            >
              {SORT_OPTIONS.find((o) => o.id === sort)?.label ?? 'Sort'}
              <svg className={`h-3 w-3 transition-transform ${sortMenuOpen ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
            </button>
            {sortMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setSortMenuOpen(false)} />
                <div role="menu" className="absolute right-0 top-full z-50 mt-1 w-40 overflow-hidden rounded-xl border border-edge bg-surface-raised py-1 shadow-lg">
                  {SORT_OPTIONS.map((o) => {
                    const active = sort === o.id;
                    return (
                      <button
                        key={o.id}
                        role="menuitemradio"
                        aria-checked={active}
                        onClick={() => { changeSort(o.id); setSortMenuOpen(false); }}
                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${active ? 'text-blue-700 dark:text-blue-300' : 'text-fg-secondary hover:bg-surface-hover hover:text-fg-strong'}`}
                      >
                        <span className="flex-1">{o.label}</span>
                        {active && (
                          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                        )}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          {aiAvailable && (
            <button
              type="button"
              onClick={() => setCategorizeMode(categorizeMode === 'auto' ? 'manual' : 'auto')}
              aria-pressed={categorizeMode === 'auto'}
              aria-label={`AI auto-categorize ${categorizeMode === 'auto' ? 'on' : 'off'}`}
              title={
                categorizeMode === 'auto'
                  ? 'AI auto-categorize is ON — new connections are tagged automatically. Click to switch to manual.'
                  : 'AI auto-categorize is OFF — nothing runs until you ask. Click to turn on.'
              }
              className={`flex cursor-pointer items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset transition-colors ${
                categorizeMode === 'auto'
                  ? 'bg-blue-500/15 text-blue-300 ring-blue-500/30 hover:bg-blue-500/25'
                  : 'text-fg-muted ring-edge hover:text-fg-secondary'
              }`}
            >
              <SparkleIcon className="h-3 w-3" />
              {categorizeMode === 'auto' ? 'Auto' : 'Manual'}
            </button>
          )}
          {aiAvailable && !categorizing && uncategorized > 0 && (
            <button
              type="button"
              onClick={categorizeNow}
              title={`Categorize ${uncategorized} uncategorized connection${uncategorized === 1 ? '' : 's'}`}
              className="cursor-pointer rounded-md bg-blue-500/15 px-2 py-0.5 text-[11px] font-medium text-blue-700 ring-1 ring-inset ring-blue-500/30 transition-colors hover:bg-blue-500/25 dark:text-blue-300"
            >
              Categorize {uncategorized}
            </button>
          )}
        </div>
      </div>

      {/* AI categorization progress */}
      {categorizing && (
        <div className="border-b border-edge bg-blue-500/5 px-4 py-2" data-testid="categorize-progress">
          <div className="flex items-center justify-between text-[11px]">
            <span className="flex items-center gap-1.5 font-medium text-blue-300">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
              Scanning connections with AI…
            </span>
            <span className="tabular-nums text-fg-muted">
              {done} of {done + remaining}
            </span>
          </div>
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-surface-input">
            <div
              className="h-full rounded-full bg-blue-500 transition-all duration-300"
              style={{ width: `${done + remaining > 0 ? Math.max(4, Math.round((done / (done + remaining)) * 100)) : 8}%` }}
            />
          </div>
        </div>
      )}

      {/* AI categorization failure notice */}
      {!categorizing && failed > 0 && (() => {
        const failMsg =
          `Couldn't categorize ${failed} connection${failed === 1 ? '' : 's'}` +
          (aiError ? ` — ${aiError}` : '');
        return (
          <div className="flex items-start gap-2 border-b border-edge bg-amber-500/10 px-4 py-2 text-[11px] text-amber-300">
            <svg className="mt-0.5 h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            {/* Wraps to multiple lines; title gives the full text on hover too. */}
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-words" title={failMsg}>
              {failMsg}
            </span>
            <button
              onClick={retryCategorize}
              className="mt-0.5 shrink-0 rounded-md px-2 py-0.5 font-medium text-amber-200 ring-1 ring-inset ring-amber-500/30 transition-colors hover:bg-amber-500/10"
            >
              Retry
            </button>
          </div>
        );
      })()}

      {/* Search + sort toolbar */}
      <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
        <div className="relative min-w-0 flex-1">
          <svg
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-faint"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            ref={searchRef}
            data-connections-search
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                if (query) {
                  e.preventDefault();
                  e.stopPropagation();
                  setQuery('');
                }
                searchRef.current?.blur();
              }
            }}
            placeholder="Search connections…"
            className="w-full rounded-lg bg-surface-input py-1.5 pl-8 pr-2.5 text-sm text-fg-strong ring-1 ring-inset ring-edge outline-none placeholder:text-fg-faint focus:ring-blue-500/40"
          />
        </div>
        {hasFilters && (
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setFilterMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={filterMenuOpen}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ring-1 ring-inset transition-colors ${
                activeCount > 0 || filterMenuOpen
                  ? 'bg-blue-500/15 text-blue-700 ring-blue-500/30 dark:text-blue-300'
                  : 'bg-surface-input text-fg-secondary ring-edge hover:text-fg-strong'
              }`}
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
              </svg>
              Filter
              {activeCount > 0 && (
                <span className="rounded-full bg-blue-500/80 px-1.5 text-[10px] font-semibold tabular-nums text-white">
                  {activeCount}
                </span>
              )}
            </button>

            {filterMenuOpen && (
              <>
                {/* Backdrop closes the menu on any outside click. */}
                <div className="fixed inset-0 z-40" onClick={() => setFilterMenuOpen(false)} />
                <div
                  role="menu"
                  aria-label="Filter connections"
                  className="absolute right-0 top-full z-50 mt-1.5 max-h-96 w-64 overflow-y-auto rounded-xl border border-edge bg-surface-raised py-1.5 shadow-lg"
                >
                  {rolesPresent.length > 0 && (
                    <>
                      <p className="px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-fg-faint">Roles</p>
                      {rolesPresent.map((r) => (
                        <FilterMenuRow
                          key={`r:${r}`}
                          label={r}
                          count={roleCounts.get(r) ?? 0}
                          checked={filter.roles.includes(r)}
                          onToggle={() => toggleRole(r)}
                        />
                      ))}
                    </>
                  )}
                  {interestsPresent.length > 0 && (
                    <>
                      <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-fg-faint">Interest tags</p>
                      {interestsPresent.map((t) => (
                        <FilterMenuRow
                          key={`i:${t}`}
                          label={`★ ${t}`}
                          count={interestCounts.get(t) ?? 0}
                          checked={filter.interests.includes(t)}
                          onToggle={() => toggleInterest(t)}
                        />
                      ))}
                    </>
                  )}
                  <div className="mt-1 border-t border-edge pt-1">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setEditingInterests(true);
                        setFilterMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-medium text-blue-700 transition-colors hover:bg-surface-hover dark:text-blue-300"
                    >
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="3" />
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                      </svg>
                      Manage tags…
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Interests editor */}
      {editingInterests && (
        <InterestsEditor
          aiAvailable={aiAvailable}
          connectionCount={connections.length}
          onClose={() => setEditingInterests(false)}
          onRecategorize={async () => {
            // Clear the stamp so the auto-categorizer re-runs with new interests.
            if (db) await db.connections.toCollection().modify({ categorizedAt: 0 });
          }}
        />
      )}

      {/* Active filter pills */}
      {activeCount > 0 && (
        <div
          data-testid="connection-filters"
          className="flex items-center gap-1.5 overflow-x-auto border-b border-edge px-3 py-2"
        >
          {filter.roles.map((r) => (
            <ActivePill key={`r:${r}`} label={r} onRemove={() => toggleRole(r)} />
          ))}
          {filter.interests.map((t) => (
            <ActivePill key={`i:${t}`} label={`★ ${t}`} onRemove={() => toggleInterest(t)} />
          ))}
          <button
            type="button"
            onClick={() => setFilter(EMPTY_CONNECTION_FILTER)}
            className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-fg-muted transition-colors hover:text-fg-secondary"
          >
            Clear all
          </button>
        </div>
      )}

      {/* List */}
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {error && <div className="px-4 py-8 text-center text-sm text-red-400">{error}</div>}

        {!error && showLoading && (
          <div className="flex flex-col items-center gap-3 px-4 py-12 text-fg-muted">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-fg-muted border-t-transparent" />
            <span className="text-sm">Loading your connections…</span>
          </div>
        )}

        {!error && showEmpty && (
          <div className="px-4 py-12 text-center text-sm text-fg-muted">No connections found yet.</div>
        )}

        {!error && !showEmpty && visible.length === 0 && connections.length > 0 && (
          <div className="px-4 py-12 text-center text-sm text-fg-muted">
            No connections match this filter.
          </div>
        )}

        {visible.map((c) => (
          <ConnectionRow
            key={c.profileUrn}
            connection={c}
            selected={c.profileUrn === selected}
            onSelect={() => setSelected(c.profileUrn)}
            onContextMenu={(e) => {
              e.preventDefault();
              setSelected(c.profileUrn);
              setContextMenu({ connection: c, x: e.clientX, y: e.clientY });
            }}
          />
        ))}
      </div>

      {contextMenu && (
        <ConnectionContextMenu
          connection={contextMenu.connection}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
