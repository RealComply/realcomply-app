// Lets a test import a .tsx component and render it with react-dom/server.
// Node's type stripping does not touch JSX, so .tsx files are compiled here
// with the TypeScript compiler the repo already has — no new dependency.
// Registered from inside the test that needs it (register() at runtime), so
// the shared `npm test` runner (scripts/test/register.mjs) stays as it is.
import { readFile } from "node:fs/promises";
import ts from "typescript";

export async function load(url, context, next) {
  if (!url.endsWith(".tsx")) return next(url, context);
  const source = await readFile(new URL(url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: url,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      verbatimModuleSyntax: false,
    },
  });
  return { format: "module", source: outputText, shortCircuit: true };
}
