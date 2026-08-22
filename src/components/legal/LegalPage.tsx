import Link from "next/link";
import type { LegalDocument } from "@/lib/legal/documents";

// Renders a published legal document.
//
// Deliberately plain, and deliberately not behind a login: a privacy policy
// that only account holders can read is not published. It has to be readable
// by someone deciding whether to sign up, and by a regulator who never will.
//
// The body is written as plain text with "## " headings rather than going
// through a markdown library. The whole vocabulary is headings, paragraphs and
// bold, so a dependency would buy nothing and would put a parser between a
// lawyer's words and the page.
export function LegalPage({ doc }: { doc: LegalDocument }) {
  const blocks = doc.body.split("\n\n").filter((b) => b.trim());

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-12">
      <Link href="/" className="text-sm text-rc-muted transition hover:text-rc-ink hover:underline">
        ← RealComply
      </Link>

      <h1 className="mt-4 text-2xl font-semibold text-rc-ink">{doc.title}</h1>
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

      <div className="mt-8 space-y-4">
        {blocks.map((block, i) =>
          block.startsWith("## ") ? (
            <h2 key={i} className="pt-4 text-base font-semibold text-rc-ink">
              {block.slice(3)}
            </h2>
          ) : (
            <p key={i} className="text-sm leading-relaxed text-rc-ink">
              {renderInline(block)}
            </p>
          ),
        )}
      </div>

      <p className="mt-12 border-t border-rc-border pt-4 text-xs text-rc-faint">
        Questions about this document: admin@realcomply.com.au
      </p>
    </main>
  );
}

// Bold only. Splitting on the delimiter and taking every odd index is the
// whole of it — no nesting to worry about, because the documents do not use
// any.
function renderInline(text: string) {
  return text.split("**").map((part, i) => (i % 2 === 1 ? <strong key={i}>{part}</strong> : part));
}
