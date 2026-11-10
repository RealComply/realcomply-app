import Link from "next/link";

// On Home, for the licensee in charge and an office manager, while a draft of
// the supervision guidelines is waiting to be checked (Master, 10 Nov 2026:
// "A Home card tells them it's ready to check").
export function SgDraftReadyCard({ fileName, fromFileOnRecord }: { fileName: string; fromFileOnRecord: boolean }) {
  return (
    <section className="mt-6 rounded-card border border-rc-amber-deep/25 bg-rc-amber/10 px-4 py-3.5">
      <h2 className="text-sm font-semibold text-rc-amber-deep">Your supervision guidelines are ready to check</h2>
      <p className="mt-1 text-sm text-rc-ink">
        RealComply has read {fromFileOnRecord ? "your manual on file, " : ""}
        <span className="font-medium">{fileName}</span>
        {fromFileOnRecord ? "," : ""} into sections. Check it, pick what kind of document it is and confirm the version
        number, then save it as your live document. Until then, your current file stays as it is.
      </p>
      <Link
        href="/dashboard/sg-manual"
        className="mt-2.5 inline-block rounded-full bg-rc-green-deep px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-rc-green-deep-600"
      >
        Check and save
      </Link>
    </section>
  );
}
