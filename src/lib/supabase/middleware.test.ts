import { afterEach, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { NextRequest } from "next/server";
import { config } from "@/proxy";
import { isPublicPath, updateSession } from "./middleware";

// Code review fixes, part F1 (12 Oct 2026): the proxy file moved to src/,
// where Next runs it. It had never run, so its list of pages that work
// signed out had fallen behind, and starting it as it was would have sent
// Stripe, Vercel's scheduler, the unsubscribe link and the forgotten-password
// page to /login. Supabase is a stand-in throughout; no one signs in.

// ── Which pages work signed out ────────────────────────────────────────────

/** Every page and route in the app, as a path someone could visit. */
function appRoutes(): string[] {
  const root = join(process.cwd(), "src", "app");
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name === "page.tsx" || name === "route.ts") {
        const path = "/" + relative(root, dir).split(sep).filter(Boolean).join("/");
        out.push(path.replace(/\[[^\]]+\]/g, "x"));
      }
    }
  };
  walk(root);
  return [...new Set(out)].sort();
}

// Decided one by one. A page added later fails the last test below until it
// is put in one list or the other, so nobody adds a public page that quietly
// sends its visitors to /login, or a private one the proxy lets through.
const SIGNED_OUT_OK = [
  "/",
  "/login",
  "/signup",
  "/auth/callback",
  "/auth/confirm",
  "/forgot-password",
  "/terms",
  "/privacy",
  "/dpa",
  "/signoff/x",
  "/signoff/x/file",
  // Adopting the SG annexure from an email (0067), and its PDF.
  "/annexure/x",
  "/annexure/x/pdf",
  "/unsubscribe",
  "/api/cron/backup-storage",
  "/api/cron/licence-reminders",
  "/api/cron/listing-scan",
  "/api/cron/pm-retention",
  "/api/cron/subscription-end",
  "/api/cron/trust-reminders",
  "/api/cron/weekly-digest",
  "/api/health",
  "/api/search", // the route checks the signed-in user itself
  "/api/stripe/webhook",
];

const SIGNED_IN_ONLY = ["/accept-terms", "/removed", "/reset-password", "/staff-preview/records"];

describe("which pages work signed out", () => {
  it("every page someone reaches from an email, Stripe or the scheduler", () => {
    for (const path of SIGNED_OUT_OK) assert.equal(isPublicPath(path), true, path);
  });

  it("the rest send a signed-out visitor to /login", () => {
    for (const path of [...SIGNED_IN_ONLY, "/dashboard", "/dashboard/home", "/dashboard/x/summary"]) {
      assert.equal(isPublicPath(path), false, path);
    }
  });

  it("every page in the app has been decided, one way or the other", () => {
    const decided = new Set([...SIGNED_OUT_OK, ...SIGNED_IN_ONLY]);
    const undecided = appRoutes().filter((p) => !p.startsWith("/dashboard") && !decided.has(p));
    assert.deepEqual(undecided, [], "add each to SIGNED_OUT_OK or SIGNED_IN_ONLY above");
  });
});

describe("where the proxy runs", () => {
  const runsOn = (path: string) => new RegExp(`^${config.matcher[0]}$`).test(path);

  it("on pages", () => {
    for (const path of ["/", "/login", "/dashboard/home", "/unsubscribe", "/signoff/abc"]) assert.equal(runsOn(path), true, path);
  });

  it("not on route handlers, Next's own files or images", () => {
    for (const path of ["/api/stripe/webhook", "/api/cron/listing-scan", "/api/health", "/_next/static/chunk.js", "/favicon.ico", "/icon.svg", "/apple-icon.png"]) {
      assert.equal(runsOn(path), false, path);
    }
  });
});

// ── The session refresh ────────────────────────────────────────────────────

const SUPABASE = "https://proj.supabase.test";
const COOKIE = "sb-proj-auth-token";

const b64url = (s: string) => Buffer.from(s).toString("base64url");
const jwt = (sub: string, exp: number) => `${b64url('{"alg":"HS256","typ":"JWT"}')}.${b64url(JSON.stringify({ sub, exp, role: "authenticated", aud: "authenticated" }))}.sig`;
const USER = { id: "00000000-0000-4000-8000-0000000000a1", aud: "authenticated", role: "authenticated", email: "agent@example.test" };

function sessionCookie(expiresAt: number, refreshToken: string): string {
  const session = {
    access_token: jwt(USER.id, expiresAt),
    refresh_token: refreshToken,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: expiresAt,
    user: USER,
  };
  return `${COOKIE}=base64-${b64url(JSON.stringify(session))}`;
}

let calls: string[];
let refreshWorks: boolean;

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon_test_key";
  calls = [];
  refreshWorks = true;
  mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "refresh_token") {
      calls.push("refresh");
      if (!refreshWorks) return json({ code: "refresh_token_not_found", message: "Invalid Refresh Token" }, 400);
      const expiresAt = Math.floor(Date.now() / 1000) + 3600;
      return json({ access_token: jwt(USER.id, expiresAt), refresh_token: "refresh-2", token_type: "bearer", expires_in: 3600, expires_at: expiresAt, user: USER });
    }
    if (url.pathname === "/auth/v1/user") {
      calls.push("user");
      return json(USER);
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  });
});

afterEach(() => mock.restoreAll());

const visit = (path: string, cookie?: string) =>
  updateSession(new NextRequest(`https://www.realcomply.com.au${path}`, { headers: cookie ? { cookie } : {} }));

const redirectedTo = (res: Response) => (res.status >= 300 && res.status < 400 ? new URL(res.headers.get("location")!).pathname : null);

describe("the proxy, signed out", () => {
  it("sends a dashboard page to /login, without asking Supabase anything", async () => {
    assert.equal(redirectedTo(await visit("/dashboard/home")), "/login");
    assert.deepEqual(calls, []);
  });

  it("lets the unsubscribe link, the forgotten-password page and a sign-off link through", async () => {
    for (const path of ["/unsubscribe?e=sam%40example.test&t=abc", "/forgot-password", "/signoff/token123"]) {
      assert.equal(redirectedTo(await visit(path)), null, path);
    }
  });
});

describe("the proxy, signed in", () => {
  it("an expired session is refreshed once, the new one is saved, and the response can't be cached", async () => {
    const res = await visit("/dashboard/home", sessionCookie(Math.floor(Date.now() / 1000) - 60, "refresh-1"));

    assert.equal(redirectedTo(res), null, "still signed in");
    assert.equal(calls.filter((c) => c === "refresh").length, 1);
    const saved = res.headers.getSetCookie().find((c) => c.startsWith(`${COOKIE}=`));
    assert.ok(saved, "the refreshed session is written back");
    const value = decodeURIComponent(saved!.split(";")[0].slice(COOKIE.length + 1));
    assert.equal(JSON.parse(Buffer.from(value.replace(/^base64-/, ""), "base64url").toString()).refresh_token, "refresh-2");
    assert.match(res.headers.get("cache-control") ?? "", /no-store/);
  });

  it("a session still in date is used as it is: no refresh", async () => {
    const res = await visit("/dashboard/home", sessionCookie(Math.floor(Date.now() / 1000) + 1800, "refresh-1"));

    assert.equal(redirectedTo(res), null);
    assert.ok(!calls.includes("refresh"));
  });

  it("a session that can't be refreshed (signed out elsewhere) goes to /login", async () => {
    refreshWorks = false;
    mock.method(console, "error", () => {}); // the auth library logs the refusal
    const res = await visit("/dashboard/home", sessionCookie(Math.floor(Date.now() / 1000) - 60, "revoked"));

    assert.equal(redirectedTo(res), "/login");
  });
});
