import { useId } from 'react';

/**
 * The inflow wordmark: "in" in the brand's deep violet, "flow" in the
 * cyan→violet gradient the mark uses. In dark themes the deep violet would sink
 * into the background, so "in" lightens there. `collapsed` renders a compact
 * gradient "f".
 */
export function Wordmark({ collapsed = false, className }: { collapsed?: boolean; className?: string }) {
  if (collapsed) {
    return (
      <span
        className={`select-none bg-gradient-to-r from-[#52d8fd] to-[#7b3cf0] bg-clip-text font-extrabold text-transparent ${className ?? 'text-lg'}`}
      >
        f
      </span>
    );
  }
  return (
    <span className={`select-none font-extrabold lowercase tracking-tight ${className ?? 'text-[16px]'}`}>
      <span className="text-[#4c1d95] dark:text-[#c4b5fd]">in</span>
      <span className="bg-gradient-to-r from-[#52d8fd] via-[#5a8dff] to-[#7b3cf0] bg-clip-text text-transparent">flow</span>
    </span>
  );
}

/**
 * The inflow mark: the i's dot, and its stem flowing out into streams.
 *
 * This is the simplified two-stream cut (assets/brand/inflow-mark-small.svg),
 * because the mark is shown at sidebar size, where the full three-stream
 * version's gaps close up. Same geometry as the 16/32px toolbar icons, so the
 * app and the toolbar show the same thing. The dot lightens in dark themes for
 * the same reason the wordmark's "in" does.
 */
export function LogoMark({ size = 24 }: { size?: number }) {
  const gid = useId();
  return (
    <svg width={size} height={size} viewBox="150 155 980 980" className="shrink-0" aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="170" y1="0" x2="1110" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#52d8fd" />
          <stop offset="0.5" stopColor="#5a8dff" />
          <stop offset="1" stopColor="#7b3cf0" />
        </linearGradient>
      </defs>
      <circle cx="296" cy="314" r="128" className="fill-[#4c1d95] dark:fill-[#a78bfa]" />
      <g fill={`url(#${gid})`}>
        <path d="M405 463H925C1030 463 1110 545 1110 650V745C1050 660 975 610 885 610H540C455 610 385 565 362 505C355 482 375 463 405 463Z" />
        <path d="M172 478C172 470 178 467 185 467H195C202 467 206 472 207 479C225 610 370 732 525 732H885C1010 732 1105 830 1105 955V990C1105 1045 1060 1090 1000 1090H410C275 1090 172 980 172 840Z" />
      </g>
    </svg>
  );
}

/** Brand: the mark when collapsed, the gradient wordmark when expanded. */
export function Logo({ collapsed = false }: { collapsed?: boolean }) {
  if (collapsed) return <LogoMark size={26} />;
  return <Wordmark className="text-[19px]" />;
}
