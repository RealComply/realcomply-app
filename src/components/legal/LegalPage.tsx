import Link from "next/link";
import { LEGAL_DOCUMENTS, type LegalDocument } from "@/lib/legal/documents";

// Renders a published legal document.
//
// Deliberately plain, and deliberately not behind a login: a privacy policy
// that only account holders can read is not published. It has to be readable
// by someone deciding whether to sign up, and by a regulator who never will.
//
// The body is written as plain text rather than going through a markdown
// library. The vocabulary is headings ("#", "##", "###"), paragraphs, "- "
// lists, "|" tables and bold, so a dependency would buy nothing and would put
// a parser between a lawyer's words and the page. Every character of the text
// reaches the page; the renderer only decides which element it sits in.
export function LegalPage({ doc }: { doc: LegalDocument }) {
  const blocks = doc.body.split("\n\n").filter((b) => b.trim());

  // A document that opens with its own "# " heading uses it as the page title,
  // so the lawyer's heading is shown as written rather than our label for it.
  const heading = blocks[0]?.startsWith("# ") ? blocks.shift()!.slice(2) : doc.title;

  const related = Object.values(LEGAL_DOCUMENTS).filter((d) => d.key !== doc.key);

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-12">
      <Link href="/" className="text-sm text-rc-muted transition hover:text-rc-ink hover:underline">
        ← RealComply
      </Link>

      <h1 className="mt-4 text-2xl font-semibold text-rc-ink">{heading}</h1>
      <p className="mt-1 text-xs text-rc-faint">
        Version {doc.version} · Effective {doc.effective}
      </p>

      {/* An unreviewed document says so, loudly. A placeholder that reads like
          a settled policy is worse than an obviously unfinished one, because
          someone will rely on it. This disappears when `reviewed` is true. */}
      {!doc.reviewed && (
        <p className="mt-4 rounded-lg border border-rc-amber-deep/30 bg-rc-amber/10 px-3 py-2 text-sm text-rc-amber-deep">
          This is a working draft awaiting legal review. It describes how RealComply actually operates, but it
          has not yet been settled by a lawyer and should not be relied on as final.
        </p>
      )}

      <div className="mt-8 space-y-4">{blocks.map((block, i) => renderBlock(block, i))}</div>

      <div className="mt-12 space-y-2 border-t border-rc-border pt-4 text-xs text-rc-faint">
        <p>
          {related.map((d, i) => (
            <span key={d.key}>
              {i > 0 && " · "}
              <Link href={d.path} className="font-medium text-rc-green-deep hover:underline">
                {d.title}
              </Link>
            </span>
          ))}
        </p>
        <p>Questions about this document: admin@realcomply.com.au</p>
      </div>
    </main>
  );
}

function renderBlock(block: string, key: number) {
  if (block.startsWith("# ")) {
    return (
      <h2 key={key} className="pt-4 text-lg font-semibold text-rc-ink">
        {block.slice(2)}
      </h2>
    );
  }
  if (block.startsWith("## ")) {
    return (
      <h2 key={key} className="pt-4 text-base font-semibold text-rc-ink">
        {block.slice(3)}
      </h2>
    );
  }
  if (block.startsWith("### ")) {
    return (
      <h3 key={key} className="pt-2 text-sm font-semibold text-rc-ink">
        {block.slice(4)}
      </h3>
    );
  }

  const lines = block.split("\n");

  if (lines.every((l) => l.startsWith("- "))) {
    return (
      <ul key={key} className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-rc-ink">
        {lines.map((l, i) => (
          <li key={i}>{renderInline(l.slice(2))}</li>
        ))}
      </ul>
    );
  }

  if (lines.every((l) => l.startsWith("|"))) {
    // Header row, then the "|---|" separator, then body rows.
    const cells = (l: string) => l.slice(1, -1).split("|").map((c) => c.trim());
    const [head, , ...rows] = lines;
    return (
      <div key={key} className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm text-rc-ink">
          <thead>
            <tr>
              {cells(head).map((c, i) => (
                <th key={i} className="border-b border-rc-border py-2 pr-4 align-bottom font-semibold">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>
                {cells(r).map((c, ci) => (
                  <td key={ci} className="border-b border-rc-border py-2 pr-4 align-top leading-relaxed">
                    {renderInline(c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // Sub-clauses such as "(a) ..." sit indented under the clause they belong
  // to, as they do in the lawyer's document.
  const isSubClause = /^\([a-z]+\) /.test(block);
  return (
    <p key={key} className={`text-sm leading-relaxed text-rc-ink ${isSubClause ? "pl-6" : ""}`}>
      {renderInline(block)}
    </p>
  );
}

// Bold only. Splitting on the delimiter and taking every odd index is the
// whole of it — no nesting to worry about, because the documents do not use
// any.
function renderInline(text: string) {
  return text.split("**").map((part, i) => (i % 2 === 1 ? <strong key={i}>{part}</strong> : part));
}
