// Lets Node's built-in test runner load the app's TypeScript as written.
//
// Node runs .ts files itself now (type stripping), so tests need no runner
// package — which matters here, because a test framework is several hundred
// lines of package-lock.json travelling to a laptop with no Node on it. What
// Node does not know is the two things the bundler does for the app:
//
//   "@/lib/x"   → src/lib/x   (the tsconfig path alias)
//   "./stripe"  → ./stripe.ts (imports written without an extension)
//   "next/server" → next/server.js (a package subpath with no "exports" map,
//                   which bundlers and CommonJS find but Node's ESM loader won't)
//
// Only specifiers that resolve to a file in this repo are touched; packages in
// node_modules resolve exactly as Node would resolve them anyway.
import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = new URL("../../src/", import.meta.url);
const EXTENSIONS = [".ts", ".tsx", "/index.ts", "/index.tsx"];

function isFile(url) {
  const path = fileURLToPath(url);
  return existsSync(path) && statSync(path).isFile();
}

export async function resolve(specifier, context, nextResolve) {
  let target = null;
  if (specifier.startsWith("@/")) {
    target = new URL(specifier.slice(2), SRC).href;
  } else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    if (!context.parentURL.includes("/node_modules/")) target = new URL(specifier, context.parentURL).href;
  }

  if (target && !isFile(target)) {
    const found = EXTENSIONS.map((ext) => target + ext).find(isFile);
    if (found) return nextResolve(found, context);
  }
  try {
    return await nextResolve(target ?? specifier, context);
  } catch (error) {
    const bareSubpath = !target && /^(@[^/]+\/)?[^./@][^/]*\/.+[^/]$/.test(specifier) && !/\.[cm]?js$/.test(specifier);
    if (error?.code === "ERR_MODULE_NOT_FOUND" && bareSubpath) {
      return nextResolve(specifier + ".js", context);
    }
    throw error;
  }
}
