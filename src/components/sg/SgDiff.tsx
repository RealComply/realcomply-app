import { wordDiff } from "@/lib/sg-document/amendments";

// Before and after, side by side (Adam's mockup, screen 3): what went struck
// through in red, what came in highlighted in green. Plain text only.
export function SgDiff({ before, after }: { before: string; after: string }) {
  const parts = wordDiff(before, after);
  return (
    <div className="grid gap-2.5 sm:grid-cols-2">
      <div className="min-w-0 rounded-lg border border-rc-border bg-white px-3 py-2 text-sm leading-relaxed text-rc-ink">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-rc-faint">Before</p>
        {before.trim() ? (
          <p className="whitespace-pre-line break-words">
            {parts
              .filter((p) => p.kind !== "ins")
              .map((p, i) =>
                p.kind === "del" ? (
                  <del key={i} className="bg-rc-red-soft text-rc-red decoration-1">
                    {p.text}
                  </del>
                ) : (
                  <span key={i}>{p.text}</span>
                ),
              )}
          </p>
        ) : (
          <p className="text-rc-muted">A new paragraph.</p>
        )}
      </div>
      <div className="min-w-0 rounded-lg border border-rc-border bg-white px-3 py-2 text-sm leading-relaxed text-rc-ink">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-rc-faint">After</p>
        <p className="whitespace-pre-line break-words">
          {parts
            .filter((p) => p.kind !== "del")
            .map((p, i) =>
              p.kind === "ins" ? (
                <ins key={i} className="bg-rc-green-soft font-semibold text-rc-green-deep no-underline">
                  {p.text}
                </ins>
              ) : (
                <span key={i}>{p.text}</span>
              ),
            )}
        </p>
      </div>
    </div>
  );
}
