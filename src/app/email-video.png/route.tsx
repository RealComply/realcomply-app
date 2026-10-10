import { ImageResponse } from "next/og";

// The video picture in the early access welcome email: YouTube's own
// thumbnail for the licensee video, with the "Watch" label drawn on it.
//
// WHY THE LABEL IS BAKED IN. An email cannot reliably lay one thing over
// another: Outlook ignores positioning and Gmail strips background images in
// places. Drawing the label into the picture is the only way it sits on the
// image for every reader, as in the approved mockup. The email gives the
// picture alt text, so a reader with images off still knows what it is.
//
// Served from a path ending in .png so the auth proxy lets a mail client
// fetch it (see proxy.ts).

export const dynamic = "force-static";

// The unlisted licensee video (brief, 10 Oct 2026). The same id is embedded on
// /dashboard/getting-started.
const THUMBNAIL = "https://i.ytimg.com/vi/xzAW28t758g/hqdefault.jpg";

const WIDTH = 640;
const HEIGHT = 360;

export function GET() {
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
        {/* hqdefault is 4:3 with black bars top and bottom; cover crops them. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={THUMBNAIL}
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
