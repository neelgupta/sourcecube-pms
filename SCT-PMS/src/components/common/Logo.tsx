import { cn } from "@/lib/cn";

/**
 * Sourcecube Technologies brand mark — four overlapping rounded tiles
 * (code, health, support, engineering) rendered in the brand green.
 */
export function LogoMark({ size = 36, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={cn("shrink-0", className)}
      role="img"
      aria-label="Sourcecube Technologies"
    >
      <defs>
        <linearGradient id="scTile" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#41c391" />
          <stop offset="100%" stopColor="#1f9d6d" />
        </linearGradient>
      </defs>

      {/* top-left tile — code brackets */}
      <g transform="translate(1 3) rotate(-6 15 15)">
        <rect width="30" height="30" rx="9" fill="url(#scTile)" />
        <path
          d="M12 10.5 7.5 15l4.5 4.5M18 10.5 22.5 15 18 19.5"
          stroke="#fff"
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>

      {/* top-right tile — pulse / health */}
      <g transform="translate(33 1) rotate(6 15 15)">
        <rect width="30" height="30" rx="9" fill="url(#scTile)" />
        <path
          d="M6.5 15h4l2.5-5.5L17 21l2.5-6h4"
          stroke="#fff"
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>

      {/* bottom-left tile — support headset */}
      <g transform="translate(2 33) rotate(4 15 15)">
        <rect width="30" height="30" rx="9" fill="url(#scTile)" />
        <path
          d="M8.5 17v-2a6.5 6.5 0 0 1 13 0v2"
          stroke="#fff"
          strokeWidth="2.1"
          strokeLinecap="round"
        />
        <rect x="6.5" y="16" width="4.5" height="6.5" rx="2" fill="#fff" />
        <rect x="19" y="16" width="4.5" height="6.5" rx="2" fill="#fff" />
      </g>

      {/* bottom-right tile — gear / engineering */}
      <g transform="translate(32 34) rotate(-5 15 15)">
        <rect width="30" height="30" rx="9" fill="url(#scTile)" />
        <circle cx="15" cy="15" r="3.4" stroke="#fff" strokeWidth="2.1" />
        <path
          d="M15 6.5v3M15 20.5v3M23.5 15h-3M9.5 15h-3M21 9l-2.1 2.1M11.1 18.9 9 21M21 21l-2.1-2.1M11.1 11.1 9 9"
          stroke="#fff"
          strokeWidth="2.1"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}

/** Full lockup: mark + SOU R CECUBE wordmark with the accented R, over TECHNOLOGIES. */
export function Logo({
  size = 36,
  showWordmark = true,
  className,
  tone = "dark",
}: {
  size?: number;
  showWordmark?: boolean;
  className?: string;
  tone?: "dark" | "light";
}) {
  const wordColor = tone === "light" ? "text-white" : "text-navy-900";
  const subColor = tone === "light" ? "text-white/70" : "text-navy-500";

  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark size={size} />
      {showWordmark && (
        <span className="flex flex-col leading-none">
          <span
            className={cn("text-[1.05rem] font-bold tracking-[0.14em]", wordColor)}
            style={{ fontSize: size * 0.44 }}
          >
            SOU<span className="text-brand-500">R</span>CECUBE
          </span>
          <span
            className={cn("mt-1 font-medium tracking-[0.42em]", subColor)}
            style={{ fontSize: size * 0.2 }}
          >
            TECHNOLOGIES
          </span>
        </span>
      )}
    </span>
  );
}
