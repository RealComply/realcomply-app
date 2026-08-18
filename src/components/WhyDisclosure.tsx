import type { ReactNode } from "react";

// A one-line "why" that opens if you want it and stays out of the way if you
// don't.
//
// Adam, 18 Aug 2026: "It's good to have an education piece in there and
// clarification, but at the same time, having these sections so text heavy is
// just gonna put people off... most agents don't need to know this stuff. The
// licensee themselves will know what registers they need to keep and why."
//
// That's the right instinct and it cuts against a real temptation in a
// compliance product: every rule we learn feels worth explaining, and the
// screen fills with paragraphs nobody reads. The rule still has to be
// somewhere — an agent who ticks the wrong box needs a way to find out why
// it was wrong — but it does not have to be shouted at everyone, every visit.
//
// A native <details> rather than React state: no client component, no
// hydration, works before JavaScript loads, and the browser handles the
// keyboard and screen-reader behaviour correctly for free.
export function WhyDisclosure({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="group rounded-md border border-rc-border bg-white px-3 py-2 text-xs [&_summary::-webkit-details-marker]:hidden">
      <summary className="cursor-pointer list-none font-medium text-rc-muted transition hover:text-rc-ink">
        <span className="mr-1.5 inline-block text-rc-faint transition group-open:rotate-90">›</span>
        {summary}
      </summary>
      <p className="mt-2 pl-3 leading-relaxed text-rc-muted">{children}</p>
    </details>
  );
}
