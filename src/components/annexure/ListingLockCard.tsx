import { openAnnexureSigning } from "@/lib/actions/sg-annexure";
import { lockCopy, type ListingGate } from "@/lib/agent-acknowledgement";
import { SignedAnnexureUpload } from "@/components/annexure/SignedAnnexureUpload";

// What Listings and the new listing page show in place of "Add listing"
// while the office's lock is on (job 7 brief, Parts 4 and 5; mockup tabs 2
// and 4). Nothing else in RealComply is locked, and existing listings open
// and save as normal. The database refuses a new listing either way (0071).

export function ListingLockCard({
  gate,
  actsAsLicensee,
  licenseeName,
  agencyId,
}: {
  gate: Exclude<ListingGate, null>;
  actsAsLicensee: boolean;
  licenseeName: string | null;
  agencyId: string;
}) {
  const copy = lockCopy(gate, { actsAsLicensee }, licenseeName);
  return (
    <section className="rounded-card border border-rc-border border-l-4 border-l-rc-amber bg-white p-4 shadow-card sm:p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h2 className="text-base font-bold text-rc-ink">Add listing</h2>
        <span className="rounded-full bg-rc-amber/15 px-2.5 py-0.5 text-xs font-bold text-rc-amber-deep">{copy.pill}</span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-rc-ink">{copy.text}</p>
      {copy.action === "upload" && (
        <div className="mt-3">
          <SignedAnnexureUpload agencyId={agencyId} variant="ghost" />
        </div>
      )}
      {copy.action === "review_and_sign" && (
        // A fresh signing link each time, as the Home card does.
        <form action={openAnnexureSigning} className="mt-3">
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-full bg-rc-green-deep px-5 py-2.5 text-sm font-bold text-white transition hover:bg-rc-green-deep-600"
          >
            Review and sign
          </button>
        </form>
      )}
    </section>
  );
}
