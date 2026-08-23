"use client";

// Shown once, when the licensee in charge is replaced with a different person.
//
// WHY THIS IS A NOTICE AND NOT AN ITEM.
//
// Appointing a licensee in charge is notifiable to the Secretary within 5
// business days (s31(3) of the Act). RealComply deliberately does not track
// whether it happened, does not tick it off, and does not record that this was
// shown. Adam, 23 Aug 2026: "rather than us policing it, all we'll do is have a
// pop up screen with that clause with a courteous reminder... Agent makes the
// records, we just keep them on track with a helping hand."
//
// That is the product's whole liability posture in one screen. Tracking it
// would imply RealComply is the thing responsible for the lodgement, which it
// is not and must never appear to be. Saying nothing would waste the one moment
// we know the obligation has been triggered.
//
// The clause is quoted rather than paraphrased on purpose: the authority is the
// point, and a paraphrase of a statutory duty is our words standing in for the
// legislation's.

export function LicenseeChangeNotice({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-rc-ink/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="licensee-change-title"
    >
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-card border border-rc-border bg-white p-6 shadow-card-lg">
        <h2 id="licensee-change-title" className="text-lg font-semibold text-rc-ink">
          Heads up: Fair Trading needs to know
        </h2>
        <p className="mt-2 text-sm text-rc-muted">
          You&rsquo;ve changed who the licensee in charge is. That&rsquo;s a notifiable change.
        </p>

        <blockquote className="mt-4 rounded-r-lg border border-l-[3px] border-rc-border border-l-rc-green-deep bg-rc-bg-alt px-4 py-3 text-sm leading-relaxed text-rc-muted">
          <p className="font-semibold text-rc-ink">s31(3), Property and Stock Agents Act 2002 (NSW)</p>
          <p className="mt-1.5">
            An individual or corporation that employs the holder of a class 1 licence in accordance with this
            section must notify the Secretary of the following within 5 business days&mdash;
          </p>
          <p className="mt-1">(a) the name and licence number of the holder,</p>
          <p className="mt-1">
            (b) the address of each place of business at which the holder will discharge the holder&rsquo;s duties
            as a licensee in charge of the business.
          </p>
        </blockquote>

        <p className="mt-4 text-sm font-semibold text-rc-ink">What that means for you</p>
        <p className="mt-1 text-sm leading-relaxed text-rc-muted">
          You have <strong className="text-rc-ink">5 business days</strong> to tell NSW Fair Trading, and
          you&rsquo;ll need the new licensee&rsquo;s <strong className="text-rc-ink">name</strong>, their{" "}
          <strong className="text-rc-ink">licence number</strong>, and the{" "}
          <strong className="text-rc-ink">address of every place of business</strong> they&rsquo;ll be in charge
          of.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-rc-muted">
          RealComply doesn&rsquo;t lodge this for you or track its progress.
        </p>

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-rc-green-deep px-4 py-2 text-sm font-semibold text-white transition hover:bg-rc-green-deep-600"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
