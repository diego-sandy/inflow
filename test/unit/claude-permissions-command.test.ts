/**
 * ⌘K reaches Claude's permission switches directly: a "Claude permissions"
 * command that opens Settings › AI › Claude.
 */
import { buildCommands } from '@/components/command-palette/commands';

it('the palette has a Claude permissions command wired to its action', () => {
  const openClaudePermissions = vi.fn();
  const noop = () => {};
  const actions = new Proxy(
    { currentTheme: 'light', isDemoActive: false, aiSuggestionsEnabled: true, inboxLabels: undefined, inboxSectionLabel: undefined, selectedInOther: false, openClaudePermissions } as any,
    { get: (t, k) => (k in t ? t[k] : noop) },
  );
  const cmd = buildCommands(actions).find((c) => c.label === 'Claude permissions');
  expect(cmd).toBeTruthy();
  cmd!.action();
  expect(openClaudePermissions).toHaveBeenCalledOnce();
});
