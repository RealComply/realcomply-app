import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// THE GUARD (Adam, 11 Nov 2026): "every date in RealComply is in Australian
// format, always, whatever the person's browser or computer is set to. Never
// US format." This fails the build if a native date box comes back, or a date
// is formatted anywhere but the shared formatter (lib/format-date.ts), which
// is fixed to en-AU and Sydney time.
//
//   - No <input type="date"> (or "datetime-local", "month", "week"): use
//     components/DateBox.tsx, which always shows dd/mm/yyyy.
//   - No toLocaleDateString, toLocaleTimeString or Intl.DateTimeFormat outside
//     lib/format-date.ts: use formatSydney or one of the shapes built on it.
//   - toLocaleString only on numbers, and only with "en-AU".

const ROOT = join(process.cwd(), "src");
const FORMATTER = "lib/format-date.ts";

type Finding = { file: string; line: number; rule: string; text: string };

/** Code only: line comments and the lines of block comments are left out, so prose can name what's banned. */
function codeLines(source: string): Array<{ n: number; text: string }> {
  const out: Array<{ n: number; text: string }> = [];
  let inBlock = false;
  source.split("\n").forEach((raw, i) => {
    let text = raw;
    if (inBlock) {
      const end = text.indexOf("*/");
      if (end < 0) return;
      text = text.slice(end + 2);
      inBlock = false;
    }
    text = text.replace(/\/\*.*?\*\//g, "");
    const start = text.indexOf("/*");
    if (start >= 0) {
      inBlock = true;
      text = text.slice(0, start);
    }
    const line = text.replace(/(^|[^:"'`])\/\/.*$/, "$1");
    if (line.trim()) out.push({ n: i + 1, text: line });
  });
  return out;
}

const DATE_OPTION = /\b(day|month|year|hour|minute|second|weekday|timeZone|dateStyle|timeStyle|era)\s*:/;

/** What one file does wrong. Exported for the test of the guard itself, below. */
export function findDateProblems(file: string, source: string): Finding[] {
  const found: Finding[] = [];
  const lines = codeLines(source);
  const add = (n: number, rule: string, text: string) => found.push({ file, line: n, rule, text: text.trim().slice(0, 140) });
  for (const { n, text } of lines) {
    if (/type\s*=\s*\{?\s*["'](date|datetime-local|month|week)["']\s*\}?|type\s*:\s*["'](date|datetime-local|month|week)["']/.test(text)) {
      add(n, "a native date box: use <DateBox> (components/DateBox.tsx)", text);
    }
    if (file === FORMATTER) continue;
    if (/\.toLocaleDateString\s*\(|\.toLocaleTimeString\s*\(|Intl\.DateTimeFormat\s*\(/.test(text)) {
      add(n, "a date formatted outside lib/format-date.ts: use formatSydney or a shape built on it", text);
    }
    for (const m of text.matchAll(/\.toLocaleString\s*\(([^)]*)\)?/g)) {
      const args = m[1] ?? "";
      const before = text.slice(0, m.index);
      if (!/^\s*["']en-AU["']/.test(args)) add(n, 'toLocaleString without "en-AU"', text);
      else if (DATE_OPTION.test(args) || /new Date\([^)]*\)\s*$/.test(before) || /\bDate\(\)\s*$/.test(before)) {
        add(n, "a date formatted with toLocaleString: use formatSydney or a shape built on it", text);
      }
    }
  }
  return found;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

describe("every date in Australian format (the guard)", () => {
  it("no native date box, and no date formatted outside lib/format-date.ts", () => {
    const problems = sourceFiles(ROOT).flatMap((path) => findDateProblems(relative(ROOT, path).replaceAll("\\", "/"), readFileSync(path, "utf8")));
    assert.deepEqual(
      problems.map((p) => `${p.file}:${p.line} ${p.rule}\n    ${p.text}`),
      [],
      "Dates must be Australian whatever the browser is set to (Adam, 11 Nov 2026)",
    );
  });

  it("the guard catches each kind of problem", () => {
    const bad = [
      '<input type="date" name="x" />',
      "<input type={'date'} />",
      "const d = new Date(x).toLocaleDateString();",
      'const d = new Date(x).toLocaleDateString("en-AU");',
      'const t = when.toLocaleTimeString("en-AU", { hour: "numeric" });',
      'const f = new Intl.DateTimeFormat("en-US").format(d);',
      'const f = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney" }).format(d);',
      "const s = amount.toLocaleString();",
      'const s = new Date().toLocaleString("en-AU");',
      'const s = d.toLocaleString("en-AU", { day: "numeric" });',
    ];
    for (const line of bad) assert.equal(findDateProblems("components/X.tsx", line).length, 1, line);
  });

  it("and lets the right things through", () => {
    const good = [
      '<DateBox name="x" defaultValue={iso} />',
      'const s = `$${amount.toLocaleString("en-AU")}`;',
      "// toLocaleDateString is banned, but saying so in a comment is fine",
      "const d = formatAuShortDate(iso);",
      '<input type="text" />',
    ];
    for (const line of good) assert.deepEqual(findDateProblems("components/X.tsx", line), [], line);
    assert.deepEqual(findDateProblems(FORMATTER, 'new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney" })'), []);
  });
});
