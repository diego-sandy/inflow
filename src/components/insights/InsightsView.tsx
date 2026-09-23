import { useMemo, useState } from 'react';
import { useConnections } from '@/hooks/useConnections';
import { useUIStore } from '@/store/ui-store';
import { computeInsights, type CountItem } from '@/lib/connection-insights';
import { SparkleIcon } from '@/components/common/SparkleIcon';
import { ChartSection } from './ChartSection';
import { CHART_PALETTE, roleColor } from './chart-colors';
import { FollowUpsSection, AISuggestionsSection } from './SuggestionsTab';

function pctLabel(pct: number): string {
  return `${Math.round(pct * 100)}%`;
}

type TabKey = 'charts' | 'followups' | 'suggestions';
const TAB_KEY = 'inflow-insights-tab-v1';

function loadTab(): TabKey {
  try {
    const t = localStorage.getItem(TAB_KEY);
    if (t === 'charts' || t === 'followups' || t === 'suggestions') return t;
  } catch {}
  return 'charts';
}

export function InsightsView() {
  const { connections, isLoading } = useConnections();
  const setActiveSection = useUIStore((s) => s.setActiveSection);
  const showConnections = useUIStore((s) => s.showConnections);
  const insights = useMemo(() => computeInsights(connections), [connections]);

  const [tab, setTab] = useState<TabKey>(loadTab);
  const selectTab = (t: TabKey) => {
    setTab(t);
    try { localStorage.setItem(TAB_KEY, t); } catch {}
  };

  const { total, uncategorized, roles, interests, companies } = insights;
  const topRole = roles[0];
  const empty = !isLoading && connections.length === 0;

  // The three charts, left → right, shown on the Charts tab.
  const charts: { key: string; title: string; data: Parameters<typeof ChartSection>[0]['data'] }[] = [];
  if (roles.length > 0) {
    charts.push({
      key: 'composition',
      title: 'Composition by role',
      data: roles.map((r) => ({
        key: r.role,
        label: r.role,
        value: r.count,
        color: roleColor(r.role),
        ariaLabel: `Show ${r.role}`,
        onClick: () => showConnections({ filter: { roles: [r.role as any], interests: [] } }),
      })),
    });
  }
  if (companies.length > 0) {
    charts.push({
      key: 'firms',
      title: 'Firms your network clusters around',
      data: companies.slice(0, 10).map((c, i) => ({
        key: c.name,
        label: c.name,
        value: c.count,
        color: CHART_PALETTE[i % CHART_PALETTE.length],
        ariaLabel: `Show ${c.name}`,
        onClick: () => showConnections({ search: c.name }),
      })),
    });
  }
  if (interests.length > 0) {
    charts.push({
      key: 'interests',
      title: 'Interest tags',
      data: interests.map((t: CountItem, i) => ({
        key: t.name,
        label: `★ ${t.name}`,
        value: t.count,
        color: CHART_PALETTE[i % CHART_PALETTE.length],
        ariaLabel: `Show ★ ${t.name}`,
        onClick: () => showConnections({ filter: { roles: [], interests: [t.name] } }),
      })),
    });
  }

  const tabs: { id: TabKey; label: string; ai?: boolean }[] = [
    { id: 'charts', label: 'Charts' },
    { id: 'followups', label: 'Follow up' },
    { id: 'suggestions', label: 'AI suggestions', ai: true },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-edge px-6 py-3">
        <h2 className="text-base font-semibold text-fg-strong">Insights</h2>
        {total > 0 && (
          <span className="rounded-full bg-surface-input px-2 py-0.5 text-[11px] font-medium text-fg-muted">
            {total} connection{total === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {empty ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-sm text-fg-muted">No connections yet — open Connections to sync them.</p>
          <button onClick={() => setActiveSection('connections')} className="rounded-lg btn-primary px-4 py-2 text-sm font-medium">
            Go to Connections
          </button>
        </div>
      ) : (
        <>
          {/* Tab bar */}
          <div role="tablist" className="flex items-center gap-1 border-b border-edge px-6">
            {tabs.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => selectTab(t.id)}
                className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                  tab === t.id
                    ? 'border-blue-400 text-fg-strong'
                    : 'border-transparent text-fg-muted hover:text-fg-secondary'
                }`}
              >
                {t.ai && <SparkleIcon className="h-3.5 w-3.5 text-blue-400" />}
                {t.label}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            <div className="w-full">
              {tab === 'charts' && (
                <div className="space-y-5">
                  {topRole && (
                    <div className="rounded-xl bg-gradient-to-br from-blue-500/10 to-transparent p-5 ring-1 ring-inset ring-blue-500/20">
                      <p className="text-2xl font-semibold text-fg-strong">
                        Your network is {pctLabel(topRole.pct)} {topRole.role}
                      </p>
                      {companies.length > 0 && (
                        <p className="mt-1 text-sm text-fg-secondary">
                          Clustered around {companies.slice(0, 3).map((c) => c.name).join(', ')}
                          {companies.length > 3 ? ' and more' : ''}.
                        </p>
                      )}
                    </div>
                  )}

                  {uncategorized > 0 && (
                    <button onClick={() => setActiveSection('connections')} className="w-full rounded-lg bg-amber-500/10 px-4 py-2 text-left text-[13px] text-amber-300 ring-1 ring-inset ring-amber-500/20 transition-colors hover:bg-amber-500/15">
                      {uncategorized} of {total} not categorized yet — categorize them in Connections for complete insights.
                    </button>
                  )}

                  {charts.length === 0 ? (
                    <p className="py-8 text-center text-sm text-fg-muted">
                      Categorize your connections to see charts here.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 items-start gap-x-10 gap-y-8 md:grid-cols-2 xl:grid-cols-3">
                      {charts.map((c) => (
                        <div key={c.key} data-chart-card={c.key} className="min-w-0">
                          <h3 className="mb-3 text-sm font-semibold text-fg-strong">{c.title}</h3>
                          <ChartSection data={c.data} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {tab === 'followups' && <FollowUpsSection />}

              {tab === 'suggestions' && <AISuggestionsSection />}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
