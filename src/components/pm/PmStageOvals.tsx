import { PmOval, pmOvalSpoken } from "@/components/pm/PmOval";
import type { PmStageView } from "@/lib/rules/pm-engine";

// The row of PM ovals at the top of a property, one per stage, joined by short
// lines that sit only in the gaps (brief A5). Same geometry as the sales
// progress bar. Each oval jumps to its stage's section below; a locked stage
// is faded, as on sales.

export function PmStageOvals({ stages }: { stages: PmStageView[] }) {
  return (
    <nav aria-label="Stages" className="relative -mx-1 overflow-x-auto px-1 pb-1 pt-0.5">
      <ol
        className="grid"
        style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(112px, 1fr))`, minWidth: `${stages.length * 112}px` }}
      >
        {stages.map((s, i) => {
          const started = s.before || s.oval.kind === "tick" || s.oval.kind === "underWay" || (s.oval.kind === "count" && s.done > 0);
          const spoken = `${s.title}: ${pmOvalSpoken(s.oval)}${s.locked ? ", locked" : ""}`;
          return (
            <li key={s.stage} className={`relative text-center ${s.locked ? "opacity-50" : ""}`}>
              {i > 0 && (
                <span
                  aria-hidden="true"
                  className={`absolute -left-2 top-[13px] h-[3px] w-4 rounded-full ${started && !s.before ? "bg-rc-green-deep" : "bg-rc-border"}`}
                />
              )}
              <a
                href={`#stage-${s.stage}`}
                aria-label={spoken}
                className="block rounded-lg outline-none transition hover:opacity-80 focus-visible:ring-2 focus-visible:ring-rc-green-deep/50"
              >
                <PmOval oval={s.oval} className="mx-auto h-[29px] w-[calc(100%-16px)] text-xs" />
                <span
                  aria-hidden="true"
                  className={`mt-1.5 block whitespace-nowrap px-1 pb-1 text-[11.5px] ${
                    started && !s.before ? "font-semibold text-rc-ink" : "font-medium text-rc-muted"
                  }`}
                >
                  {s.title}
                </span>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
