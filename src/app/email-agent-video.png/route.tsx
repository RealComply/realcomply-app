import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// The video picture in the agent welcome email (brief, 14 Oct 2026): a still
// from the agent video, the red and amber dots on Listings, with the "Watch"
// label drawn on it, as for the licensee video (see email-video.png, which
// says why the label is baked in).
//
// The still is public/agent-video-still.jpg, taken from the mockup Adam
// approved. Served from a path ending in .png so the auth proxy lets a mail
// client fetch it (see proxy.ts). Built once, at deploy.

export const dynamic = "force-static";

const WIDTH = 640;
const HEIGHT = 360;

export function GET() {
  const still = `data:image/jpeg;base64,${readFileSync(join(process.cwd(), "public", "agent-video-still.jpg")).toString("base64")}`;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          background: "#0f1d19",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={still}
          width={WIDTH}
          height={HEIGHT}
          style={{ position: "absolute", top: 0, left: 0, width: WIDTH, height: HEIGHT, objectFit: "cover" }}
          alt=""
        />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            background: "#16302a",
            color: "#ffffff",
            borderRadius: 999,
            padding: "14px 30px 14px 24px",
            fontSize: 28,
            fontWeight: 700,
          }}
        >
          <svg width={22} height={22} viewBox="0 0 12 12">
            <path d="M2.5 1.5v9l8-4.5z" fill="#2ecc8f" />
          </svg>
          Watch
        </div>
      </div>
    ),
    {
      width: WIDTH,
      height: HEIGHT,
      headers: { "cache-control": "public, max-age=86400" },
    },
  );
}
