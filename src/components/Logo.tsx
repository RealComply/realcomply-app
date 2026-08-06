// The house-badge mark from the locked brand direction ("house-shaped badge
// with a green tick inside") — lifted straight from the marketing site
// (RealComply-landing-page.html header/footer) rather than redrawn, so the
// product uses the same asset as the marketing site instead of a lookalike.
// "light" = dark house on a light background (nav, cards); "dark" = lifted
// fill on a dark background, for any future ink-dark surface.
export function LogoMark({ size = 28, variant = "light" }: { size?: number; variant?: "light" | "dark" }) {
  const fill = variant === "dark" ? "#1d3a31" : "#16302a";
  const stroke = variant === "dark" ? "rgba(255,255,255,.18)" : "none";
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path
        d="M13 43 L13 21 L9 21 L24 7 L39 21 L35 21 L35 43 Z"
        fill={fill}
        stroke={stroke}
        strokeWidth={stroke !== "none" ? 1.2 : undefined}
        strokeLinejoin="round"
      />
      <path
        d="M17 31 l5 5 L31 25.5"
        fill="none"
        stroke="#2ecc8f"
        strokeWidth={4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Logo({ size = 20, className = "" }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-bold tracking-tight text-rc-ink ${className}`}>
      <LogoMark size={size + 8} />
      <span style={{ fontSize: size }}>
        Real<span className="text-rc-green-deep">Comply</span>
      </span>
    </span>
  );
}
