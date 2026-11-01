import { useUIStore } from '@/store/ui-store';
import { MCP_PERMISSION_INFO } from '@/lib/mcp/permissions';
import { Toggle } from '@/components/common/Toggle';

/**
 * What Claude may do through the MCP connector, one switch per kind of action
 * (lib/mcp/permissions). Reading starts on, as it always was; everything that
 * changes the LinkedIn account starts off. A switch takes effect on Claude's
 * next tool call — no reconnect, no new session.
 */
export function ClaudePermissionsSettings() {
  const permissions = useUIStore((s) => s.mcpPermissions);
  const setPermission = useUIStore((s) => s.setMcpPermission);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-fg-strong">What Claude can do</h3>
        <p className="mt-1 text-xs text-fg-muted">
          For Claude connected through the inflow connector. A change applies to Claude's next request.
          When something is off, Claude is told it isn't allowed, and the attempt shows in the
          connector's activity.
        </p>
      </div>
      {MCP_PERMISSION_INFO.map((p, i) => (
        <div
          key={p.key}
          className={`flex items-center justify-between gap-4 ${i === 1 ? 'border-t border-edge pt-4' : ''}`}
        >
          <div className="min-w-0">
            <p className="text-sm font-medium text-fg-strong">{p.label}</p>
            <p className="text-xs text-fg-muted">{p.description}</p>
          </div>
          <Toggle label={p.label} checked={permissions[p.key]} onChange={(on) => setPermission(p.key, on)} />
        </div>
      ))}
    </div>
  );
}
