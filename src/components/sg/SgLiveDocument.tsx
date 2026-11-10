import { formatAuTimestamp } from "@/lib/format-date";
import { SG_DOC_TYPES, type SgDocType } from "@/lib/sg-document/fair-trading";
import { sectionHeading } from "@/lib/sg-document/sections";
import type { SgSectionView } from "@/lib/data/sg-document";

// The live document (Adam's mockup, 6 Nov 2026, screen 2): what kind of
// document it is and its version, the sections down the side, and each
// section's own words. Everyone in the office reads it. Quick amendments,
// a new full version compared, the review date and Export PDF come in the
// next parts.
export function SgLiveDocument({
  docType,
  versionLabel,
  savedAt,
  savedByName,
  sections,
  canUpload,
}: {
  docType: SgDocType | null;
  versionLabel: string | null;
  savedAt: string | null;
  savedByName: string | null;
  sections: SgSectionView[];
  canUpload: boolean;
}) {
  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-bold tracking-tight text-rc-ink">{docType ? SG_DOC_TYPES[docType] : "Supervision guidelines"}</h2>
          <p className="mt-0.5 text-sm text-rc-muted">
            {[versionLabel ? `Version ${versionLabel}` : null, savedAt ? `saved ${formatAuTimestamp(savedAt)}${savedByName ? ` by ${savedByName}` : ""}` : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
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

      <div className="mt-4 grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Sections" className="h-fit rounded-card border border-rc-border bg-white p-2 text-sm shadow-card lg:sticky lg:top-4">
          <ol>
            {sections.map((s) => (
              <li key={s.position}>
                <a href={`#sg-section-${s.position}`} className="block rounded-lg px-2.5 py-1.5 text-rc-muted transition hover:bg-rc-bg-alt hover:text-rc-ink">
                  {sectionHeading(s)}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <div className="min-w-0 space-y-3">
          {sections.map((s) => (
            <article
              key={s.position}
              id={`sg-section-${s.position}`}
              className="scroll-mt-4 rounded-card border border-rc-border bg-white p-5 shadow-card"
            >
              <h3 className="text-base font-semibold text-rc-ink">{sectionHeading(s)}</h3>
              <div className="mt-2 space-y-2 text-sm leading-relaxed text-rc-ink">
                {s.paragraphs.map((p, i) => (
                  <p key={i} className="max-w-[68ch] whitespace-pre-line break-words">
                    {p}
                  </p>
                ))}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
