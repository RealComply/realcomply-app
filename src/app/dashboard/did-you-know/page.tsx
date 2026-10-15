import { requireAccess } from "@/lib/data/current-profile";
import {
  DID_YOU_KNOW_FOOTER,
  NSW_DID_YOU_KNOW,
  type DidYouKnowBlock,
  type DidYouKnowNote,
} from "@/lib/rules/nsw-did-you-know";

// Did you know? Short notes on obligations that sit outside a listing's file.
//
// Adam, 15 Oct 2026, mockup approved the same day: one page, two sections,
// side by side on a computer and stacked on a phone. Everyone signed in sees
// both; the first is written for the licensee in charge. No intro line, no
// quick links. Each note folds open; the first in each section starts open.
//
// The content lives in lib/rules/nsw-did-you-know.ts, not here, so another
// state is a content job. A native <details> for each note: no client
// component and no state, and it opens with the keyboard as well as a click.
//
// Any signed-in role. The dashboard layout does the signing-in check; the
// requireAccess here is the page's own, so it never renders for nobody.

export const metadata = { title: "Did you know? · RealComply" };

export default async function DidYouKnowPage() {
  await requireAccess();

  return (
    <main className="mx-auto w-full max-w-[1180px] flex-1 px-4 py-10">
      <h1 className="text-2xl font-bold tracking-tight text-rc-ink">Did you know?</h1>

      {/* Two columns from 768px (md), stacked below it. */}
      <div className="mt-5 grid items-start gap-[18px] md:grid-cols-2">
        {NSW_DID_YOU_KNOW.map((section) => (
          <section
            key={section.id}
            aria-labelledby={`dyk-${section.id}`}
            className="grid min-w-0 content-start gap-2.5 rounded-[16px] border border-rc-border bg-white p-5 shadow-card"
          >
            <h2 id={`dyk-${section.id}`} className="text-lg font-bold text-rc-ink">
              {section.heading}
            </h2>
            {section.audience && <p className="-mt-1.5 text-[13px] text-rc-muted">{section.audience}</p>}
            {section.notes.map((note, i) => (
              <Note key={note.title} note={note} startOpen={i === 0} />
            ))}
          </section>
        ))}
      </div>

      <p className="mt-5 text-[12.5px] text-rc-muted">{DID_YOU_KNOW_FOOTER}</p>
    </main>
  );
}

function Note({ note, startOpen }: { note: DidYouKnowNote; startOpen: boolean }) {
  return (
    <details open={startOpen} className="group rounded-[12px] border border-rc-border bg-rc-bg-alt">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2.5 rounded-[12px] px-3.5 py-3 font-semibold text-rc-ink group-open:rounded-b-none group-open:border-b group-open:border-rc-border [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">{note.title}</span>
        <span className="max-w-[55%] shrink-0 rounded-full bg-rc-green-soft px-2.5 py-0.5 text-right text-xs font-semibold text-rc-green-deep">
          {note.law}
        </span>
      </summary>
      <div className="grid gap-1.5 px-3.5 pb-3.5 pt-2.5 text-[14.5px] leading-relaxed text-rc-ink/80">
        {note.body.map((block, i) => (
          <Block key={i} block={block} />
        ))}
      </div>
    </details>
  );
}

function Block({ block }: { block: DidYouKnowBlock }) {
  if (block.kind === "list") {
    return (
      <ul className="list-disc space-y-0.5 pl-5">
        {block.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    );
  }
  if (block.kind === "small") return <p className="text-[12.5px] text-rc-muted">{block.text}</p>;
  return <p>{block.text}</p>;
}
