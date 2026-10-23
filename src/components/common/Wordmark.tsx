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
 * This is the small cut (assets/brand/inflow-mark-small.svg): the same three
 * streams with wider gaps, because at sidebar size the full mark's gaps close
 * up. Same geometry as the 16/32px toolbar icons, so the
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
      <circle cx="291" cy="314" r="122" className="fill-[#4c1d95] dark:fill-[#a78bfa]" />
      <g fill={`url(#${gid})`}>
        <path d="M405 463H925C1030 463 1110 545 1110 650V745C1050 665 975 635 885 635H530C440 635 372 585 360 512C356 486 376 463 405 463Z" />
        <path d="M172 478C172 470 178 467 185 467H195C202 467 206 472 207 479C228 625 375 747 530 747H880C1005 747 1105 840 1105 960V985C1105 1043 1058 1090 1000 1090H925C919 1090 915 1086 915 1080V1065C915 945 830 850 700 850H410C275 850 172 745 172 610Z" />
        <path d="M172 832C172 828 176 827 178 830C245 915 330 960 425 960H680C760 960 807 1015 807 1080V1083C807 1087 804 1090 800 1090H410C275 1090 172 985 172 860Z" />
      </g>
    </svg>
  );
}

/** Brand: the mark when collapsed, the gradient wordmark when expanded. */
export function Logo({ collapsed = false }: { collapsed?: boolean }) {
  if (collapsed) return <LogoMark size={26} />;
  return <Wordmark className="text-[19px]" />;
}
