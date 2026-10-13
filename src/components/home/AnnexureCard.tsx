import { FileSignature } from "lucide-react";
import { openAnnexureSigning } from "@/lib/actions/sg-annexure";
import { ANNEXURE_BOX_SMALL, ANNEXURE_BOX_TEXT } from "@/lib/email/early-access-invite";

// The reminder until the annexure is adopted (brief, 14 Oct 2026, part 4).
// On the licensee's Home only: the licensee in charge, or an agent on their
// own plan. Agents never see it. "Review and sign" makes a fresh link and
// opens the signing page (lib/actions/sg-annexure.ts).

export function AnnexureCard({ unavailable = false }: { unavailable?: boolean }) {
  return (
    <section className="mt-6 rounded-card border-2 border-rc-green-deep bg-white px-4 py-4 shadow-card sm:px-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rc-green-soft text-rc-green-deep">
            <FileSignature size={16} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            {/* The Home card's own title (brief); the line under it is the email box's. */}
            <h2 className="text-sm font-bold text-rc-ink">Adopt the annexure to your Supervision Guidelines</h2>
            <p className="mt-1 text-sm leading-relaxed text-rc-muted">{ANNEXURE_BOX_TEXT}</p>
          </div>
        </div>
        <form action={openAnnexureSigning} className="shrink-0">
          <button
            type="submit"
            className="inline-flex w-full items-center justify-center rounded-full bg-rc-green-deep px-5 py-2.5 text-sm font-bold text-white transition hover:bg-rc-green-deep-600 sm:w-auto"
          >
            Review and sign
          </button>
          <p className="mt-1.5 text-center text-[11px] text-rc-faint sm:text-right">{ANNEXURE_BOX_SMALL}</p>
        </form>
      </div>
      {unavailable && (
        <p role="alert" className="mt-3 text-sm font-medium text-rc-amber-deep">
          The signing page couldn&rsquo;t be opened just now. Try again in a minute.
        </p>
      )}
    </section>
  );
}
