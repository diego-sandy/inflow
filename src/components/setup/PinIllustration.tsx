import { LogoMark } from '@/components/common/Wordmark';

/**
 * A drawn Chrome toolbar showing how to pin inflow: the cursor opens the
 * puzzle-piece menu, clicks the pin next to inflow, and the icon appears in
 * the toolbar. Drawn rather than a screenshot so it stays sharp, follows the
 * app theme, and doesn't go stale when Chrome restyles its toolbar.
 *
 * Every moving part runs on one 7s loop (`setup-pin-*` keyframes in
 * global.css). With reduced motion the loop stops on its most useful frame:
 * menu open, pin highlighted, icon in the toolbar.
 *
 * Laid out in fixed pixels on purpose: the cursor's keyframes target the
 * puzzle piece and the pin by coordinate.
 */
export function PinIllustration() {
  return (
    <div
      aria-hidden="true"
      className="relative mx-auto h-[170px] w-[300px] select-none overflow-hidden rounded-xl bg-surface-input ring-1 ring-inset ring-edge"
    >
      {/* Toolbar */}
      <div className="absolute left-0 top-0 h-10 w-[300px] bg-[#dee1e6] dark:bg-[#202124]" />
      <div className="absolute left-2.5 top-2 h-6 w-[190px] rounded-full bg-white px-3 text-[10px] leading-6 text-zinc-500 dark:bg-[#35363a] dark:text-zinc-400">
        linkedin.com/messaging
      </div>
      <div className="setup-pin-toolbar-mark absolute left-[210px] top-3">
        <LogoMark size={16} />
      </div>
      <PuzzleIcon className="absolute left-[236px] top-[11px] h-[18px] w-[18px] text-zinc-600 dark:text-zinc-300" />
      <div className="absolute left-[266px] top-2.5 h-5 w-5 rounded-full bg-zinc-400 dark:bg-zinc-600" />

      {/* Extensions menu */}
      <div className="setup-pin-menu absolute left-[120px] top-[46px] h-[78px] w-[172px] rounded-lg bg-white shadow-lg ring-1 ring-black/10 dark:bg-[#292a2d] dark:ring-white/10">
        <div className="px-3 pt-2.5 text-[10px] font-semibold text-zinc-700 dark:text-zinc-200">Extensions</div>
        <div className="absolute left-0 top-10 flex h-7 w-full items-center gap-2 px-3">
          <LogoMark size={16} />
          <span className="text-[11px] text-zinc-800 dark:text-zinc-100">inflow</span>
          <PinIcon className="setup-pin-pin absolute left-[146px] h-3.5 w-3.5" />
        </div>
      </div>

      {/* Cursor; its tip is the SVG origin, so keyframes translate it straight to a target. */}
      <svg className="setup-pin-cursor absolute left-0 top-0 h-5 w-5 drop-shadow" viewBox="0 0 20 20">
        <path d="M1 1L1 15L5 11L8 18L10.5 17L7.5 10L13 10Z" fill="#fff" stroke="#111" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function PuzzleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.5 11H19V7a2 2 0 0 0-2-2h-4V3.5a2.5 2.5 0 0 0-5 0V5H4a2 2 0 0 0-2 2v3.8h1.5a2.7 2.7 0 0 1 0 5.4H2V20a2 2 0 0 0 2 2h3.8v-1.5a2.7 2.7 0 0 1 5.4 0V22H17a2 2 0 0 0 2-2v-4h1.5a2.5 2.5 0 0 0 0-5z" />
    </svg>
  );
}

function PinIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M16 3a1 1 0 0 1 .7 1.7L15.4 6l2.6 5.2 1.3-1.3a1 1 0 1 1 1.4 1.4l-3.5 3.5-1.4-1.4L12 17.2V21a1 1 0 1 1-2 0v-3.8l-3.8-3.8L4.8 15a1 1 0 1 1-1.4-1.4l3.5-3.5 1.3 1.3L12.8 8.6 10.3 6 9 7.3A1 1 0 1 1 7.6 5.9l3.7-3.6A1 1 0 0 1 12 2h4z" />
    </svg>
  );
}
