import { openAnnexureSigning } from "@/lib/actions/sg-annexure";
import { newLicenseeLockCopy } from "@/lib/licensee-history";

// What Listings and New listing show in place of "Add listing" after a change
// of licensee in charge, until the new licensee adopts the annexure (0080;
// Adam, 16 Oct 2026: "Reuse the job 7 lock"). Same look as the job 7 lock.
// Existing listings open and save as normal.

export function NewLicenseeListingLock({
  isLicensee,
  licenseeName,
}: {
  isLicensee: boolean;
  licenseeName: string | null;
}) {
  const copy = newLicenseeLockCopy({ isLicensee }, licenseeName);
  return (
    <section className="rounded-card border border-rc-border border-l-4 border-l-rc-amber bg-white p-4 shadow-card sm:p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h2 className="text-base font-bold text-rc-ink">Add listing</h2>
        <span className="rounded-full bg-rc-amber/15 px-2.5 py-0.5 text-xs font-bold text-rc-amber-deep">{copy.pill}</span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-rc-ink">{copy.text}</p>
      {copy.action === "read_and_adopt" && (
        // A fresh signing link each time, as the Home card does.
        <form action={openAnnexureSigning} className="mt-3">
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-full bg-rc-green-deep px-5 py-2.5 text-sm font-bold text-white transition hover:bg-rc-green-deep-600"
          >
            Read and adopt
          </button>
        </form>
      )}
    </section>
  );
}
