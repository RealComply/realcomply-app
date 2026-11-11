import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import nextConfig from "../../../next.config";

// THE 7AM JOB CARRIES ITS WHOLE BROWSER (12 Nov 2026). On the first morning
// after #167 the browser couldn't start on Vercel: playwright-core loads
// browsers.json by a path it works out at run time, so the build didn't put
// it in the 7am function ("Cannot find module .../playwright-core/browsers.json").
// Every file the browser reads that way has to be named in next.config.ts.

const ROUTE = "/api/cron/listing-scan";
const root = process.cwd();

/** The files a "./folder/**" or plain-file entry names. Any other pattern fails the test, so it's never read wrong. */
function expand(entry: string): string[] {
  const rel = path.normalize(entry.replace(/^\.\//, ""));
  if (entry.endsWith("/**")) {
    const dir = rel.slice(0, -"/**".length);
    return (fs.readdirSync(path.join(root, dir), { recursive: true }) as string[])
      .map((f) => path.join(dir, f))
      .filter((f) => fs.statSync(path.join(root, f)).isFile());
  }
  assert.doesNotMatch(entry, /[*?[{]/, `${entry}: only "folder/**" and plain files are read here`);
  return [rel];
}

function shipped(): Set<string> {
  const entries = nextConfig.outputFileTracingIncludes?.[ROUTE] ?? [];
  return new Set(entries.flatMap(expand));
}

test("the 7am job names every file playwright-core loads by a worked-out path", () => {
  const bundle = path.join(root, "node_modules/playwright-core/lib/coreBundle.js");
  const code = fs.readFileSync(bundle, "utf8");
  // require(path.join(packageRoot, "browsers.json")) and the like.
  const loaded = [...code.matchAll(/require\(import_path\d*\.default\.join\(packageRoot, "([^"]+)"\)\)/g)].map((m) => m[1]);
  assert.ok(loaded.includes("browsers.json"), "the check still finds Playwright's own loads");
  const files = shipped();
  for (const name of loaded) {
    assert.ok(files.has(path.normalize(`node_modules/playwright-core/${name}`)), `playwright-core/${name} is in the 7am job`);
  }
  // Its code, read in at run time from lib/ (an app icon, the entry scripts).
  assert.ok(files.has(path.normalize("node_modules/playwright-core/lib/coreBundle.js")));
  assert.ok(files.has(path.normalize("node_modules/playwright-core/lib/server/chromium/appIcon.png")));
});

test("the 7am job carries the compressed Chromium", () => {
  const files = shipped();
  for (const name of ["chromium.br", "fonts.tar.br", "swiftshader.tar.br", "al2023.tar.br"]) {
    assert.ok(files.has(path.normalize(`node_modules/@sparticuz/chromium/bin/${name}`)), `${name} is in the 7am job`);
  }
});

test("no other page or job is given the browser", () => {
  for (const [route, globs] of Object.entries(nextConfig.outputFileTracingIncludes ?? {})) {
    if (route === ROUTE) continue;
    for (const g of globs) assert.doesNotMatch(g, /playwright|chromium/, `${route} doesn't carry the browser`);
  }
});
