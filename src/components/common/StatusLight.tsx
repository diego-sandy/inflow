/**
 * A status "light" — a small glowing dot, like a native connection LED.
 * green = connected/active, yellow = connecting (pulses), red = off/error.
 * Shared by the AI settings status rows and the Outbox MCP status bar so the
 * connection indicator looks the same everywhere.
 */
export type StatusTone = 'green' | 'yellow' | 'red';

const TONE_CLASS: Record<StatusTone, string> = {
  green: 'bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.18)]',
  yellow: 'bg-amber-500 shadow-[0_0_0_3px_rgba(245,158,11,0.18)] animate-pulse',
  red: 'bg-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.15)]',
};

export function StatusLight({ tone, className }: { tone: StatusTone; className?: string }) {
  return (
    <span className={`h-2 w-2 shrink-0 rounded-full ${TONE_CLASS[tone]} ${className ?? ''}`} aria-hidden="true" />
  );
}
