import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { unsubscribeTokenValid } from "@/lib/email/early-access-ack";

// Unsubscribe from the early-access list.
//
// GET shows a confirmation page. POST does the removal.
//
// THE SPLIT MATTERS. Corporate mail scanners and link-preview bots follow
// every URL in an inbound email, with GET. A one-click GET unsubscribe would
// therefore remove people who never touched the link — silently, and in a way
// nobody would notice until the list stopped growing. So the GET is inert and
// the actual write needs a form submission.
//
// Uses the service-role client because the table has no update policy: RLS
// denies anonymous updates by default, which is what stops a stranger marking
// other people unsubscribed. The HMAC is verified BEFORE the client is
// created, so the elevated privilege only ever runs on a request that already
// proved it holds a token derived from our own secret.

export const dynamic = "force-dynamic";

function page(title: string, body: string, showButton: { email: string; token: string } | null): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · RealComply</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f7f6;
       font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1b2b25}
  .card{max-width:30rem;margin:1.5rem;padding:2rem;background:#fff;border:1px solid #e3e7e4;border-radius:14px}
  h1{margin:0 0 .6rem;font-size:1.25rem;color:#0ca678}
  p{margin:0 0 1rem;color:#44554e}
  button{background:#0ca678;color:#fff;border:0;border-radius:999px;padding:.65rem 1.25rem;
         font-size:.95rem;font-weight:600;cursor:pointer}
  button:hover{opacity:.9}
</style></head>
<body><div class="card"><h1>${title}</h1>${body}${
    showButton
      ? `<form method="post">
           <input type="hidden" name="e" value="${showButton.email.replace(/"/g, "&quot;")}">
           <input type="hidden" name="t" value="${showButton.token.replace(/"/g, "&quot;")}">
           <button type="submit">Confirm unsubscribe</button>
         </form>`
      : ""
  }</div></body></html>`;
}

const html = (body: string, status = 200) =>
  new NextResponse(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get("e") ?? "";
  const token = request.nextUrl.searchParams.get("t") ?? "";

  if (!email || !token || !unsubscribeTokenValid(email, token)) {
    return html(
      page(
        "That link didn't work",
        "<p>This unsubscribe link is not valid. It may have been broken across two lines by your email program. Reply to the email you received and we will remove you by hand.</p>",
        null,
      ),
      400,
    );
  }

  return html(
    page(
      "Unsubscribe",
      `<p>Stop sending RealComply email to <strong>${email.replace(/</g, "&lt;")}</strong>?</p>`,
      { email, token },
    ),
  );
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const email = String(form.get("e") ?? "");
  const token = String(form.get("t") ?? "");

  if (!email || !token || !unsubscribeTokenValid(email, token)) {
    return html(
      page("That link didn't work", "<p>This unsubscribe link is not valid.</p>", null),
      400,
    );
  }

  try {
    const supabase = createServiceClient();
    const { error } = await supabase
      .from("early_access")
      .update({ unsubscribed_at: new Date().toISOString() })
      .eq("email", email.trim().toLowerCase());

    // Told they are off the list either way. They did the one thing we asked;
    // an error here is ours to chase in the logs, not theirs to retry.
    if (error) console.error("unsubscribe update failed:", email, error.message);
  } catch (err) {
    console.error("unsubscribe failed:", email, err);
  }

  return html(
    page(
      "You're unsubscribed",
      "<p>We won't email you about RealComply again. If this was a mistake you can register again at realcomply.com.au.</p>",
      null,
    ),
  );
}
