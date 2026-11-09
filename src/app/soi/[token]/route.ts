import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { EVIDENCE_BUCKET } from "@/lib/storage/evidence";

// A listing's Statement of Information, for its online ads (s72C(4); 0121;
// Adam, 10 Nov 2026: "the agent's own document, published by their choice").
//
// The link is the only credential: 64 random characters the database made.
// statement_of_information_public is the one thing it can ask, and it gives
// back the current statement's file only while the agent has the link
// switched on, the listing hasn't reached Settled or been signed off, isn't
// withdrawn from sale, and the office is still subscribed. Nothing else about
// the listing or the office is read. Never cached, so switching it off takes
// effect at once; never indexed.

export const dynamic = "force-dynamic";

const NOT_AVAILABLE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>Statement of Information</title></head><body style="font-family: system-ui, sans-serif; color: #1a1a1a; max-width: 32rem; margin: 4rem auto; padding: 0 1rem; line-height: 1.5"><h1 style="font-size: 1.25rem">This Statement of Information isn't available</h1><p>The link may have been switched off, or the property may no longer be for sale. Ask the real estate agent for a copy.</p></body></html>`;

const notAvailable = () =>
  new Response(NOT_AVAILABLE, {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" },
  });

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[0-9a-f]{64}$/.test(token)) return notAvailable();

  const { data, error } = await (await createClient()).rpc("statement_of_information_public", { p_token: token });
  const path = !error && Array.isArray(data) ? (data[0] as { pdf_path?: unknown } | undefined)?.pdf_path : null;
  // Only ever a PDF: RealComply makes one, and an upload has to be one.
  if (typeof path !== "string" || !path.toLowerCase().endsWith(".pdf")) return notAvailable();

  const { data: blob } = await createServiceClient().storage.from(EVIDENCE_BUCKET).download(path);
  if (!blob || blob.size === 0) return notAvailable();

  return new Response(blob, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="Statement of Information.pdf"',
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
