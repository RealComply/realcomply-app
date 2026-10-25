"use client";

import styles from "./infographics.module.css";
import { useInViewOnce } from "./motion";

// "Same rules. A clearer path." Replaced the How it works band, 22 Oct 2026.
// Copy is Adam's own, from his edit of the infographic copy doc: titles only,
// no body lines, six rows.
const ROWS = [
  {
    before: "Re-ticking and revising endless checklists",
    after: "Upload it. RealComply reads it and saves it everywhere it's needed.",
  },
  {
    before: "Disorganised and incomplete files",
    after: "A built-in AI compliance assistant that keeps you on track",
  },
  {
    before: "Weak estimated selling price notes and advertised price misalignment",
    after: "Advertising checked against your estimate",
  },
  {
    before: "Office compliance management",
    after: "The whole office at a glance, with built-in reminders",
  },
  {
    before: "Dig through legislation, wait on a consultant, or guess the rules and regulations",
    after: "Ask the Act. Get the answer in seconds.",
  },
  {
    before: "Audit panic. Weekends and nights pulling files together.",
    // Was "Audit ready, every day" (Adam, trial brief 23 Oct 2026).
    after: "Audit file on demand",
  },
];

// Plays once, when the panel scrolls into view. No replay on hover or tap
// from 23 Oct 2026 (Adam: "once the before and after animation has passed,
// don't have them animate again when the mouse is run over them. it is
// strange in practice"). Was a replay per row on hover and tap from 22 Oct.
// The other two graphics still replay on hover.
function Row({ before, after, i }: { before: string; after: string; i: number }) {
  return (
    <div className={styles.row} style={{ "--i": i } as React.CSSProperties}>
      <div className={`${styles.cell} ${styles.before}`}>
        <span className={styles.cellLabel}>Before RealComply</span>
        <h3>{before}</h3>
      </div>
      <div className={styles.arrow} aria-hidden="true">
        →
      </div>
      <div className={`${styles.cell} ${styles.after}`}>
        <span className={styles.cellLabel}>With RealComply</span>
        <h3>{after}</h3>
      </div>
    </div>
  );
}

export function BeforeAfter() {
  const { ref, seen } = useInViewOnce<HTMLDivElement>();
  return (
    <div ref={ref} className={`${styles.panel} ${seen ? styles.play : ""}`}>
      <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Same rules. A clearer path.</h2>
      <p className="mt-3 max-w-xl text-lg leading-relaxed text-rc-muted">
        What compliance looks like for most NSW sales agents today, and what it looks like for agents using
        RealComply.
      </p>
      <div className={`${styles.rows} mt-7`}>
        <div className={styles.head}>
          <span>
            <span className={`${styles.tag} ${styles.tagBefore}`}>Before RealComply</span>
          </span>
          <span />
          <span>
            <span className={`${styles.tag} ${styles.tagAfter}`}>With RealComply</span>
          </span>
        </div>
        {ROWS.map((r, i) => (
          <Row key={r.before} before={r.before} after={r.after} i={i} />
        ))}
      </div>
      <p className={styles.foot}>Less time on paperwork. More time on the job you love.</p>
    </div>
  );
}
