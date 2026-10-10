import { NextResponse } from "next/server";
import { buildManifest, recordsAccess } from "@/lib/subscription-end/records";

// The list of everything "Download all records" puts in the zip. See
// lib/subscription-end/records.ts for who may call it and why.
export const maxDuration = 120;

export async function GET() {
  const access = await recordsAccess();
  if (!access) return NextResponse.json({ error: "Not available" }, { status: 403 });

  try {
    const manifest = await buildManifest(access.service, access.state.agencyId, access.state.agencyName);
    return NextResponse.json(manifest, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("records manifest failed", access.state.agencyId, e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Could not prepare the download" }, { status: 500 });
  }
}
