import type { ReactNode } from 'react';
import { useUIStore, type AppSection } from '@/store/ui-store';
import { Logo } from '@/components/common/Wordmark';

/** Width of the nav rail when expanded / collapsed (px). */
export const NAV_RAIL_WIDTH = 168;
export const NAV_RAIL_COLLAPSED_WIDTH = 56;

interface NavRailProps {
  /** Live count of connections, shown as a badge on the Connections item. */
  connectionsCount?: number;
  /** Unread count for the Inbox item (omitted → no badge). */
  inboxUnread?: number;
  /** Count of Outbox items needing attention (ready-to-send + failed). */
  outboxAttention?: number;
  /** Count of pending received invitations. */
  invitationsCount?: number;
}

function InboxIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  );
}

function PeopleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function InsightsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" />
      <rect x="7" y="11" width="3" height="6" />
      <rect x="12" y="7" width="3" height="10" />
      <rect x="17" y="13" width="3" height="4" />
    </svg>
  );
}

function InvitationsIcon({ className }: { className?: string }) {
  // Person with a plus — an incoming connection request.
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <line x1="19" y1="8" x2="19" y2="14" />
      <line x1="16" y1="11" x2="22" y2="11" />
    </svg>
  );
}

function OutboxIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
      <path d="M12 7v6" />
      <path d="M9.5 9.5 12 7l2.5 2.5" />
    </svg>
  );
}

function ChatIcon({ className }: { className?: string }) {
  // Assistant / bot: a screen with an antenna and two eyes.
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="8" width="16" height="11" rx="2.5" />
      <path d="M12 8V5" />
      <circle cx="12" cy="4" r="1.2" />
      <circle cx="9" cy="13" r="1" />
      <circle cx="15" cy="13" r="1" />
    </svg>
  );
}

interface ItemDef {
  id: AppSection;
  label: string;
  desc: string;
  Icon: (p: { className?: string }) => ReactNode;
  count?: number;
}

export function NavRail({ connectionsCount, inboxUnread, outboxAttention, invitationsCount }: NavRailProps) {
  const activeSection = useUIStore((s) => s.activeSection);
  const setActiveSection = useUIStore((s) => s.setActiveSection);
  const collapsed = useUIStore((s) => s.navRailCollapsed);
  const toggleNavRail = useUIStore((s) => s.toggleNavRail);
  const goBackSection = useUIStore((s) => s.goBackSection);
  const goForwardSection = useUIStore((s) => s.goForwardSection);
  const canGoBack = useUIStore((s) => s.sectionHistory.length > 0);
  const canGoForward = useUIStore((s) => s.sectionForward.length > 0);

  const items: ItemDef[] = [
    { id: 'inbox', label: 'Inbox', desc: 'Read and reply to your LinkedIn messages.', Icon: InboxIcon, count: inboxUnread },
    { id: 'connections', label: 'Connections', desc: 'Your connections, auto-categorized by role and interest.', Icon: PeopleIcon, count: connectionsCount },
    { id: 'invitations', label: 'Invitations', desc: 'Pending connection requests — accept or ignore.', Icon: InvitationsIcon, count: invitationsCount },
    { id: 'outbox', label: 'Outbox', desc: 'Drafts and scheduled messages — you always send.', Icon: OutboxIcon, count: outboxAttention },
    { id: 'insights', label: 'Insights', desc: 'Network composition, firm clusters, and AI suggestions.', Icon: InsightsIcon },
    { id: 'chat', label: 'AI Chat', desc: 'Ask AI anything about your network.', Icon: ChatIcon },
  ];

  return (
    <nav
      aria-label="Sections"
      data-nav-rail
      className="group relative flex h-full flex-col gap-1 border-r border-edge bg-surface-raised px-2 py-3"
    >
      {/* Brand + back/forward navigation */}
      <div className={`mb-2 flex items-center ${collapsed ? 'flex-col gap-1.5' : 'px-2'}`}>
        <Logo collapsed={collapsed} />
        <div className={`flex items-center gap-0.5 ${collapsed ? '' : 'ml-auto'}`}>
          <button
            onClick={goBackSection}
            disabled={!canGoBack}
            title="Back"
            aria-label="Back to previous section"
            className="rounded-md p-1 text-fg-secondary transition-colors hover:bg-surface-hover hover:text-fg-strong disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <button
            onClick={goForwardSection}
            disabled={!canGoForward}
            title="Forward"
            aria-label="Forward to next section"
            className="rounded-md p-1 text-fg-secondary transition-colors hover:bg-surface-hover hover:text-fg-strong disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
          </button>
        </div>
      </div>

      {/* Section items */}
      {items.map(({ id, label, desc, Icon, count }) => {
        const active = activeSection === id;
        return (
          <div key={id} className="group/nav relative">
            <button
              onClick={() => setActiveSection(id)}
              aria-label={label}
              aria-current={active ? 'page' : undefined}
              className={`flex w-full cursor-pointer items-center rounded-lg text-sm font-medium transition-colors ${
                collapsed ? 'justify-center px-0 py-2' : 'gap-2.5 px-2.5 py-2'
              } ${
                active
                  ? 'bg-blue-500/15 text-fg-strong ring-1 ring-inset ring-blue-500/30'
                  : 'text-fg-muted hover:bg-surface-hover hover:text-fg-secondary'
              }`}
            >
              <span className="relative shrink-0">
                <Icon className="h-[18px] w-[18px]" />
                {/* Collapsed: a small dot stands in for the count badge. */}
                {collapsed && count !== undefined && count > 0 && (
                  <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-blue-400 ring-2 ring-surface-raised" />
                )}
              </span>
              {!collapsed && <span className="min-w-0 flex-1 truncate text-left">{label}</span>}
              {!collapsed && count !== undefined && count > 0 && (
                <span className={`shrink-0 text-[11px] font-semibold tabular-nums ${active ? 'text-blue-300' : 'text-fg-faint'}`}>
                  {count > 99 ? '99+' : count}
                </span>
              )}
            </button>

            {/* Hover description — instant custom tooltip to the right of the item. */}
            <div
              role="tooltip"
              className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 w-max max-w-[220px] -translate-y-1/2 rounded-lg bg-surface-raised px-3 py-2 opacity-0 shadow-lg ring-1 ring-inset ring-edge transition-opacity duration-100 group-hover/nav:opacity-100"
            >
              <p className="text-xs font-semibold text-fg-strong">{label}</p>
              <p className="mt-0.5 text-[11px] leading-snug text-fg-muted">{desc}</p>
            </div>
          </div>
        );
      })}

      <div className="flex-1" />

      {/* Settings */}
      <button
        onClick={() => useUIStore.getState().openSettings()}
        title={collapsed ? 'Settings' : undefined}
        aria-label="Settings"
        className={`flex cursor-pointer items-center rounded-lg py-2 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg-secondary ${
          collapsed ? 'justify-center px-0' : 'gap-2.5 px-2.5'
        }`}
      >
        <svg
          className="h-[18px] w-[18px] shrink-0"
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        {!collapsed && <span className="text-xs">Settings</span>}
      </button>

      {/* Collapse / expand — a clear toggle pinned at the bottom of the rail. */}
      <button
        onClick={toggleNavRail}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-expanded={!collapsed}
        className={`mt-1 flex cursor-pointer items-center rounded-lg py-2 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg-secondary ${
          collapsed ? 'justify-center px-0' : 'gap-2.5 px-2.5'
        }`}
      >
        <svg
          className="h-[18px] w-[18px] shrink-0"
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        >
          <path d={collapsed ? 'M9 6l6 6-6 6' : 'M15 6l-6 6 6 6'} />
        </svg>
        {!collapsed && <span className="text-xs">Collapse</span>}
      </button>
    </nav>
  );
}
