// The house-badge mark from the locked brand direction ("house-shaped badge
// with a green tick inside") — lifted straight from the marketing site
// (RealComply-landing-page.html header/footer) rather than redrawn, so the
// product uses the same asset as the marketing site instead of a lookalike.
// "light" = dark house on a light background (nav, cards); "dark" = white
// house on a dark background (the sidebar).
//
// The dark variant was a dark green house with a faint outline (#1d3a31 on
// the #24453a sidebar). Only the tick and the word showed, which is part of
// why Adam found the RealComply brand "completely gone" (12 Oct 2026). White
// with the deeper green tick is the mark at full strength on a dark surface.
export function LogoMark({ size = 28, variant = "light" }: { size?: number; variant?: "light" | "dark" }) {
  const fill = variant === "dark" ? "#ffffff" : "#16302a";
  const tick = variant === "dark" ? "#0ca678" : "#2ecc8f";
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      {/* The marketing-site glyph's raw bounding box is 30 wide x 36 tall
          (a tall, narrow house), which reads as a rectangle rather than a
          square badge at product-UI sizes — this 20%-horizontal-stretch
          (matrix scale 1.2, re-centred) widens it to a 36x36 box, still the
          same house-and-tick silhouette, just squared off. Per Adam: "I wanna
          keep it square." */}
      <g transform="matrix(1.2,0,0,1,-4.8,0)">
        <path
          d="M13 43 L13 21 L9 21 L24 7 L39 21 L35 21 L35 43 Z"
          fill={fill}
          strokeLinejoin="round"
        />
        <path
          d="M17 31 l5 5 L31 25.5"
          fill="none"
          stroke={tick}
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
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
