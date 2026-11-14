// Writes public/og.png, the share image for the public homepage.
// A brand card only. No product screen. Run: node scripts/landing-og.mjs
// The file lives in public/ so it is served without the sign-in check
// (src/proxy.ts skips image files).

import { writeFileSync } from "node:fs";
import { createElement as h } from "react";
import { ImageResponse } from "next/og.js";

const size = { width: 1200, height: 630 };

const card = h(
  "div",
  {
    style: {
      width: "100%",
      height: "100%",
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      background: "#0d1f19",
      padding: "72px 80px",
    },
  },
  h(
    "div",
    { style: { display: "flex", fontSize: 42, fontWeight: 700, color: "#ffffff" } },
    h("span", null, "Real"),
    h("span", { style: { color: "#2ecc8f" } }, "Comply"),
  ),
  h(
    "div",
    { style: { display: "flex", flexDirection: "column" } },
    h(
      "div",
      {
        style: {
          display: "flex",
          fontSize: 68,
          fontWeight: 700,
          lineHeight: 1.08,
          color: "#ffffff",
          letterSpacing: -1,
        },
      },
      "Stay on top of compliance.",
    ),
    h(
      "div",
      {
        style: {
          display: "flex",
          marginTop: 8,
          fontSize: 68,
          fontWeight: 700,
          lineHeight: 1.08,
          color: "#2ecc8f",
          letterSpacing: -1,
        },
      },
      "Without a full-time hire.",
    ),
  ),
  h(
    "div",
    { style: { display: "flex" } },
    h(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          borderRadius: 999,
          background: "#16302a",
          color: "#d5e8e0",
          fontSize: 28,
          fontWeight: 700,
          padding: "14px 28px",
        },
      },
      "Diligence support for NSW agencies",
    ),
  ),
);

const response = new ImageResponse(card, size);
const bytes = Buffer.from(await response.arrayBuffer());
writeFileSync(new URL("../public/og.png", import.meta.url), bytes);
console.log(`wrote public/og.png (${bytes.length} bytes)`);
