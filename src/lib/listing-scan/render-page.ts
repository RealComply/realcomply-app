import { lookup } from "node:dns/promises";
import type { Browser } from "playwright-core";
import { checkAddress, isPublicAddress } from "@/lib/net/public-page";
import { sameWebsite } from "@/lib/listing-scan/pages-scan";
import {
  MAX_HTML_CHARS,
  MAX_REQUESTS,
  OPEN_TIMEOUT_MS,
  POLL_MS,
  SETTLE_TIMEOUT_MS,
  STEADY_POLLS,
  looksLikeChallenge,
  requestAllowed,
} from "@/lib/listing-scan/render-rules";

// THE HEADLESS FALLBACK'S BROWSER (Adam, 11 Nov 2026, through Master; fix 3
// of 3). A listings page that draws its listings in after it loads (Yes
// Property Agents' Base44 site; a Box+Dice app) reads as 0 listings to the
// plain read, which never runs the page's JavaScript. Such a page, and only
// such a page, is opened here in a headless Chromium, once, and read when it
// has drawn. The rules are in render-rules.ts.
//
// ONLY THE 7AM JOB HAS IT. The cron route opens it and passes it in, so the
// browser (about 84 MB) is bundled with that one function and no other. On
// Vercel it is @sparticuz/chromium, made for serverless functions. Anywhere
// else there is none unless LISTINGS_BROWSER_PATH names a Chromium, and the
// check runs as it did before.
//
// The browser is started on the first page that needs it, not before: most
// mornings it isn't needed at all.

export type DrawnPage = { url: URL; html: string };
export type Renderer = { render: (url: string) => Promise<DrawnPage>; close: () => Promise<void> };

/** Thrown when the page answered the browser with a challenge or a refusal. It isn't tried again. */
export class NotDrawn extends Error {}

/** Every address the name gives is public (as for the plain read), or it isn't fetched. */
async function publicHost(host: string, cache: Map<string, Promise<boolean>>): Promise<boolean> {
  let answer = cache.get(host);
  if (!answer) {
    answer = (async () => {
      try {
        checkAddress(`https://${host}/`);
        const addresses = await lookup(host, { all: true });
        return addresses.length > 0 && addresses.every((a) => isPublicAddress(a.address));
      } catch {
        return false;
      }
    })();
    cache.set(host, answer);
  }
  return answer;
}

async function browserToUse(): Promise<{ executablePath: string; args: string[] } | null> {
  if (process.env.VERCEL) {
    const chromium = (await import("@sparticuz/chromium")).default;
    return { executablePath: await chromium.executablePath(), args: chromium.args };
  }
  const local = process.env.LISTINGS_BROWSER_PATH;
  return local ? { executablePath: local, args: [] } : null;
}

/**
 * The browser for this morning's run, or null where there is none. Close it
 * when the run ends. The 7am job uses the defaults; a test on this machine
 * passes its own browser and stand-in website.
 */
export async function openRenderer(
  deps: {
    browser?: { executablePath: string; args: string[] };
    hostIsPublic?: (host: string) => Promise<boolean>;
  } = {},
): Promise<Renderer | null> {
  const which = deps.browser ?? (await browserToUse());
  if (!which) return null;
  let browser: Promise<Browser> | null = null;
  const hosts = new Map<string, Promise<boolean>>();
  const isPublic = deps.hostIsPublic ?? ((host: string) => publicHost(host, hosts));

  const render = async (raw: string): Promise<DrawnPage> => {
    const start = checkAddress(raw);
    if (!(await isPublic(start.hostname))) throw new NotDrawn("That address isn't a public website.");
    if (!browser) {
      const { chromium } = await import("playwright-core");
      browser = chromium.launch({ executablePath: which.executablePath, args: which.args, headless: true });
    }
    const context = await (await browser).newContext({
      javaScriptEnabled: true,
      acceptDownloads: false,
      serviceWorkers: "block",
      viewport: { width: 1280, height: 900 },
    });
    try {
      const page = await context.newPage();
      let requests = 0;
      await page.route("**/*", async (route) => {
        const req = route.request();
        const seen = {
          url: req.url(),
          resourceType: req.resourceType(),
          isNavigation: req.isNavigationRequest(),
          isMainFrame: req.frame() === page.mainFrame(),
        };
        requests += 1;
        if (requests > MAX_REQUESTS || !requestAllowed(seen, start)) return route.abort();
        const url = new URL(seen.url);
        if (url.protocol === "https:" && !(await isPublic(url.hostname))) return route.abort();
        return route.continue();
      });
      const response = await page.goto(start.toString(), { waitUntil: "domcontentloaded", timeout: OPEN_TIMEOUT_MS });
      // Looked at once, as it first arrives: a challenge is left there.
      const title = await page.title().catch(() => "");
      const text = await page.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
      if (looksLikeChallenge(response?.status() ?? null, title, text)) {
        throw new NotDrawn("The website answered the browser with a check or a refusal, so it was left there.");
      }
      // Waited on until it has drawn: the network goes quiet, then the page's
      // links stop changing for a moment (an app can pause before it asks
      // for its listings), or the time is up.
      const deadline = Date.now() + SETTLE_TIMEOUT_MS;
      await page.waitForLoadState("networkidle", { timeout: SETTLE_TIMEOUT_MS }).catch(() => {});
      let last = -1;
      let steady = 0;
      while (steady < STEADY_POLLS && Date.now() < deadline) {
        const links = await page.locator("a[href]").count().catch(() => 0);
        steady = links === last ? steady + 1 : 0;
        last = links;
        await page.waitForTimeout(POLL_MS);
      }
      // A page that went somewhere else (another website, which is stopped, so
      // the browser's own error page) is not this website's page.
      const at = new URL(page.url());
      if (at.protocol !== "https:" || !sameWebsite(at.hostname, start.hostname)) {
        throw new NotDrawn("The page tried to go to another website, so it was left there.");
      }
      const html = (await page.content()).slice(0, MAX_HTML_CHARS);
      return { url: at, html };
    } finally {
      await context.close().catch(() => {});
    }
  };

  const close = async () => {
    if (browser) await (await browser).close().catch(() => {});
  };

  return { render, close };
}
