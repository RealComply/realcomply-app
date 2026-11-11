import { formatAuTimestamp } from "@/lib/format-date";
import { SG_DOC_TYPES, type SgDocType } from "@/lib/sg-document/fair-trading";
import { sectionHeading } from "@/lib/sg-document/sections";
import { amendmentLine, amendmentRef, withAmendments, type SgAmendment } from "@/lib/sg-document/amendments";
import { nextReviewSaid } from "@/lib/sg-document/change-log";
import { SgQuickAmendment } from "@/components/sg/SgQuickAmendment";
import type { SgSectionView } from "@/lib/data/sg-document";

// The live document (Adam's mockup, 6 Nov 2026, screen 2): what kind of
// document it is, its version, how many amendments and when the next review
// is due, the sections down the side, and each section's own words.
// Everyone in the office reads it. Part 2 (0125): an approved amendment shows
// in place, highlighted, with its number, when it starts, why and who
// approved it, and the previous wording behind "Show previous wording"; the
// side list marks the sections amended. A new full version is compared in
// part 3; the annual review (part 4, 0126) is a card above this one, and the
// next review date shows here.
export function SgLiveDocument({
  documentId,
  docType,
  versionLabel,
  savedAt,
  savedByName,
  sections,
  amendments = [],
  nextReviewDue = null,
  canUpload,
  today,
  gaps = [],
  startAmendment = false,
}: {
  documentId: string;
  docType: SgDocType | null;
  versionLabel: string | null;
  savedAt: string | null;
  savedByName: string | null;
  sections: SgSectionView[];
  /** Approved amendments for everyone; drafts too for whoever runs the office (0125). */
  amendments?: SgAmendment[];
  /** YYYY-MM-DD (lib/sg-document/change-log.ts nextReviewDue). */
  nextReviewDue?: string | null;
  /** Whoever runs the office: uploads a new version and makes quick amendments. */
  canUpload: boolean;
  /** Today in Sydney, for a new amendment's start date. */
  today: string;
  /** What couldn't be read from the file, in plain words (lib/sg-document/checks.ts sgReadGapLines). */
  gaps?: string[];
  /** From the annual review card's "Quick amendment" (0126): the form starts open. */
  startAmendment?: boolean;
}) {
  const live = withAmendments(sections, amendments);
  const approved = amendments.filter((a) => a.status === "approved").length;
  const sub = [
    versionLabel ? (/^v/i.test(versionLabel) ? versionLabel : `Version ${versionLabel}`) : null,
    approved > 0 ? `${approved} ${approved === 1 ? "amendment" : "amendments"}` : null,
    nextReviewSaid(nextReviewDue),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-bold tracking-tight text-rc-ink">{docType ? SG_DOC_TYPES[docType] : "Supervision guidelines"}</h2>
          {sub && <p className="mt-0.5 text-sm text-rc-muted">{sub}</p>}
          {savedAt && (
            <p className="text-xs text-rc-faint">
              Saved {formatAuTimestamp(savedAt)}
              {savedByName ? ` by ${savedByName}` : ""}
            </p>
          )}
        </div>
        {canUpload && (
          <a
            href="#sg-upload"
            className="rounded-full border border-rc-border bg-white px-4 py-2 text-sm font-semibold text-rc-ink transition hover:border-rc-green-deep"
          >
            Upload new version
          </a>
        )}
      </div>

      {canUpload && (
        <div id="sg-quick-amendment" className="mt-3 scroll-mt-4">
          <SgQuickAmendment documentId={documentId} sections={sections} amendments={amendments} today={today} startOpen={startAmendment} />
        </div>
      )}

      {/* What couldn't be read (Adam, 10 Nov 2026): named, so the office
          checks those pages by hand. Never hidden, and saving isn't blocked. */}
      {gaps.length > 0 && (
        <div role="note" className="mt-4 rounded-xl border border-rc-amber-deep/25 bg-rc-amber/10 px-3.5 py-2.5 text-sm text-rc-ink">
          <p className="font-semibold text-rc-amber-deep">Not everything could be read</p>
          {gaps.map((g) => (
            <p key={g} className="mt-0.5">
              {g}
            </p>
          ))}
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Sections" className="h-fit rounded-card border border-rc-border bg-white p-2 text-sm shadow-card lg:sticky lg:top-4">
          <ol>
            {live.map((s) => (
              <li key={s.position}>
                <a
                  href={`#sg-section-${s.position}`}
                  className="flex items-start justify-between gap-2 rounded-lg px-2.5 py-1.5 text-rc-muted transition hover:bg-rc-bg-alt hover:text-rc-ink"
                >
                  <span className="min-w-0">{sectionHeading(s)}</span>
                  {s.refs.length > 0 && (
                    <span className="shrink-0 text-[11px] font-bold text-rc-amber-deep" title="Amended">
                      {s.refs.join(" ")}
                    </span>
                  )}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <div className="min-w-0 space-y-3">
          {live.map((s) => (
            <article
              key={s.position}
              id={`sg-section-${s.position}`}
              className="scroll-mt-4 rounded-card border border-rc-border bg-white p-5 shadow-card"
            >
              <h3 className="text-base font-semibold text-rc-ink">{sectionHeading(s)}</h3>
              <div className="mt-2 space-y-2 text-sm leading-relaxed text-rc-ink">
                {s.live.map((p, i) =>
                  p.amendment ? (
                    <div key={i} className="space-y-1.5 rounded-lg bg-rc-amber/15 px-3 py-2">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="rounded-full border border-rc-amber-deep/30 bg-white px-2 py-0.5 text-[11px] font-bold text-rc-amber-deep">
                          Amended {amendmentRef(p.amendment)}
                        </span>
                        <span className="text-xs text-rc-muted">{amendmentLine(p.amendment)}</span>
                      </p>
                      <p className="max-w-[68ch] whitespace-pre-line break-words">{p.text}</p>
                      {p.previous.length > 0 && (
                        <details className="text-sm">
                          <summary className="cursor-pointer text-xs font-semibold text-rc-green-deep">Show previous wording</summary>
                          <div className="mt-1 space-y-1.5">
                            {p.previous.map((w, k) => (
                              <p key={k} className="max-w-[68ch] whitespace-pre-line break-words border-l-2 border-rc-border pl-2.5 text-rc-muted">
                                <span className="font-semibold">{w.ref ? `${w.ref}:` : "As uploaded:"}</span>{" "}
                                {w.text}
                              </p>
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                  ) : (
                    <p key={i} className="max-w-[68ch] whitespace-pre-line break-words">
                      {p.text}
                    </p>
                  ),
                )}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
