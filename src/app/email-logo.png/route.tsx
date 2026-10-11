import { ImageResponse } from "next/og";

// The house-and-tick mark as a PNG, for the top of the early access emails.
//
// WHY A PNG, AND WHY GENERATED. Gmail and Outlook do not render SVG in email,
// and the app has no public folder of image files. The mark is drawn here from
// the same paths as components/Logo.tsx, so there is still one source for its
// shape, and served from a path ending in .png so the auth proxy lets it
// through (see the matcher in proxy.ts): a mail client fetching it is never
// signed in.
//
// The emails put the "RealComply" wordmark beside it in text, so a reader
// whose client blocks images still sees the name. See lib/email/early-access-invite.ts.

export const dynamic = "force-static";

const SIZE = 96;

export function GET() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#ffffff" }}>
        <svg width={SIZE} height={SIZE} viewBox="0 0 48 48">
          <g transform="matrix(1.2,0,0,1,-4.8,0)">
            <path d="M13 43 L13 21 L9 21 L24 7 L39 21 L35 21 L35 43 Z" fill="#16302a" strokeLinejoin="round" />
            <path
              d="M17 31 l5 5 L31 25.5"
              fill="none"
              stroke="#2ecc8f"
              strokeWidth={4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        </svg>
      </div>
    ),
    {
      width: SIZE,
      height: SIZE,
      headers: { "cache-control": "public, max-age=86400, immutable" },
    },
  );
}
