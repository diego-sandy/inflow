import { useState, type ReactNode } from 'react';
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

function ConnectorIcon({ className }: { className?: string }) {
  // A plug / link — the connection between Claude (MCP) and inflow.
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" />
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
  /** Nested sub-sections shown as an indented branch when expanded. */
  children?: ItemDef[];
}

/** One nav row: icon + label + count, with a hover tooltip and optional trailing control. */
function NavItem({
  item,
  active,
  collapsed,
  small,
  trailing,
  onClick,
}: {
  item: ItemDef;
  active: boolean;
  collapsed: boolean;
  small?: boolean;
  trailing?: ReactNode;
  onClick: () => void;
}) {
  const { label, desc, Icon, count } = item;
  return (
    <div className="group/nav relative">
      <div className="flex items-center">
        <button
          onClick={onClick}
          aria-label={label}
          aria-current={active ? 'page' : undefined}
          className={`flex cursor-pointer items-center rounded-lg font-medium transition-colors ${small ? 'text-[13px]' : 'text-sm'} ${
            collapsed ? 'w-full justify-center px-0 py-2' : 'flex-1 gap-2.5 px-2.5 py-2'
          } ${
            active
              ? 'bg-blue-500/15 text-fg-strong ring-1 ring-inset ring-blue-500/30'
              : 'text-fg-muted hover:bg-surface-hover hover:text-fg-secondary'
          }`}
        >
          <span className="relative shrink-0">
            <Icon className={small ? 'h-4 w-4' : 'h-[18px] w-[18px]'} />
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
        {!collapsed && trailing}
      </div>

      <div
        role="tooltip"
        className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 w-max max-w-[220px] -translate-y-1/2 rounded-lg bg-surface-raised px-3 py-2 opacity-0 shadow-lg ring-1 ring-inset ring-edge transition-opacity duration-100 group-hover/nav:opacity-100"
      >
        <p className="text-xs font-semibold text-fg-strong">{label}</p>
        <p className="mt-0.5 text-[11px] leading-snug text-fg-muted">{desc}</p>
      </div>
    </div>
  );
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

  const [branchOpen, setBranchOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem('inflow-connections-branch') !== '0';
    } catch {
      return true;
    }
  });
  const toggleBranch = () =>
    setBranchOpen((v) => {
      const next = !v;
      try {
        localStorage.setItem('inflow-connections-branch', next ? '1' : '0');
      } catch {}
      return next;
    });

  const items: ItemDef[] = [
    { id: 'inbox', label: 'Inbox', desc: 'Read and reply to your LinkedIn messages.', Icon: InboxIcon, count: inboxUnread },
    {
      id: 'connections',
      label: 'Connections',
      desc: 'Your connections, auto-categorized by role and interest.',
      Icon: PeopleIcon,
      count: connectionsCount,
      children: [
        { id: 'invitations', label: 'Invitations', desc: 'Pending connection requests — accept or ignore.', Icon: InvitationsIcon, count: invitationsCount },
      ],
    },
    { id: 'outbox', label: 'MCP connector', desc: 'Connect Claude (MCP) to source people and draft outreach — you always send.', Icon: ConnectorIcon, count: outboxAttention },
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

      {/* Section items (Connections carries an expandable Invitations branch) */}
      {items.map((item) => {
        const hasChildren = !!item.children?.length;
        if (!hasChildren) {
          return (
            <NavItem
              key={item.id}
              item={item}
              active={activeSection === item.id}
              collapsed={collapsed}
              onClick={() => setActiveSection(item.id)}
            />
          );
        }
        // A parent with a branch: the row navigates; the chevron toggles the branch.
        const chevron = (
          <button
            onClick={toggleBranch}
            aria-label={branchOpen ? `Collapse ${item.label}` : `Expand ${item.label}`}
            aria-expanded={branchOpen}
            className="ml-0.5 shrink-0 rounded-md p-1 text-fg-faint transition-colors hover:bg-surface-hover hover:text-fg-secondary"
          >
            <svg
              className={`h-3.5 w-3.5 transition-transform ${branchOpen ? 'rotate-90' : ''}`}
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            >
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        );
        return (
          <div key={item.id}>
            <NavItem
              item={item}
              // Collapsed, the branch is hidden — highlight the parent when a
              // child section (e.g. Invitations) is active so the rail isn't blank.
              active={activeSection === item.id || (collapsed && item.children!.some((c) => c.id === activeSection))}
              collapsed={collapsed}
              trailing={chevron}
              onClick={() => setActiveSection(item.id)}
            />
            {/* Expanded branch: indented children with a connector line. */}
            {!collapsed && branchOpen && (
              <div className="ml-[19px] mt-0.5 flex flex-col gap-0.5 border-l border-edge pl-2">
                {item.children!.map((child) => (
                  <NavItem
                    key={child.id}
                    item={child}
                    active={activeSection === child.id}
                    collapsed={false}
                    small
                    onClick={() => setActiveSection(child.id)}
                  />
                ))}
              </div>
            )}
            {/* Collapsed rail: the branch is a Connections detail — no child icon. */}
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
