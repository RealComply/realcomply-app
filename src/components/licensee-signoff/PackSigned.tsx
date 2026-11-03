import { GROUP_ORDER, GROUP_TILES, heldBackLine, monthName, signedSummary } from "@/lib/licensee-signoff/model";
import type { PackItem, PackRow } from "@/lib/licensee-signoff/pack";
import { dayLabel } from "@/lib/licensee-signoff/pack";

// The signed result (Adam, 3 Nov 2026; the approved mockup, view 4).
const WHAT_HAPPENED: Record<string, string> = {
  sales: "Each file is finalised, as if signed on its own. Its record says it was signed in this pack.",
  pm: "Nothing to sign.",
  trust: "Each reconciliation has its signature page added, and the audit is confirmed, as if signed one at a time.",
  office: "Gifts are marked reviewed, complaints signed off, training plans approved and the SG Manual signed.",
};

export function PackSigned({
  pack,
  items,
  licenseeName,
  officeManagerName,
  pdfHref,
}: {
  pack: PackRow;
  items: PackItem[];
  licenseeName: string;
  officeManagerName: string | null;
  pdfHref: string | null;
}) {
  const signed = items.filter((i) => i.signedAt);
  const held = items.filter((i) => i.heldBackAt);
  return (
    <div className="space-y-3">
      <section className="flex items-start gap-3 rounded-card border border-rc-green-deep/30 bg-white p-5 shadow-card">
        <span aria-hidden="true" className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-rc-green-deep text-white">
          ✓
        </span>
        <div className="space-y-2">
          <h2 className="text-lg font-bold text-rc-ink">{monthName(pack.month)} pack signed</h2>
          <p className="text-sm text-rc-muted">
            {signedSummary(pack.month, signed.length, pack.signed_name ?? licenseeName, dayLabel(pack.signed_at ?? ""), held.length)
              .split(". ")
              .slice(1)
              .join(". ")}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {pdfHref && (
              <a href={pdfHref} className="inline-flex min-h-10 items-center rounded-lg border border-rc-border bg-white px-4 text-sm font-semibold text-rc-ink">
                Download signed pack (PDF)
              </a>
            )}
            <span className="text-sm text-rc-muted">Also filed in Sign-offs.</span>
          </div>
        </div>
      </section>
      <section className="rounded-card border border-rc-border bg-white p-5 shadow-card">
        <h3 className="text-sm font-bold text-rc-ink">What happens to each item</h3>
        <ul className="mt-2 space-y-1.5">
          {GROUP_ORDER.map((g) => {
            const n = signed.filter((i) => i.group === g).length;
            if (n === 0) return null;
            return (
              <li key={g} className="flex items-start justify-between gap-3 rounded-xl border border-rc-border bg-rc-bg-alt px-3 py-2.5">
                <div>
                  <p className="text-sm font-semibold text-rc-ink">{GROUP_TILES[g]}</p>
                  <p className="text-xs text-rc-muted">{WHAT_HAPPENED[g]}</p>
                </div>
                <span className="rounded-full bg-rc-green-soft px-2 py-0.5 text-xs font-bold text-rc-green-deep">{n}</span>
              </li>
            );
          })}
          {held.map((i) => (
            <li key={i.id} className="flex items-start justify-between gap-3 rounded-xl border border-rc-amber/40 bg-rc-amber/10 px-3 py-2.5">
              <div>
                <p className="text-sm font-semibold text-rc-ink">Held back: {i.title}</p>
                <p className="text-xs text-rc-muted">
                  &ldquo;{i.heldBackNote}&rdquo; {heldBackLine({ officeManagerName, licenseeName: pack.signed_name ?? licenseeName, month: pack.month })}
                </p>
              </div>
              <span className="rounded-full border border-rc-amber/40 px-2 py-0.5 text-xs font-bold text-rc-amber-deep">1</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
