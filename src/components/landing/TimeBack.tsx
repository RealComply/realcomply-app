"use client";

import { useRef } from "react";
import styles from "./infographics.module.css";
import { makeGate, replay, useInViewOnce } from "./motion";

// "Get your time back." Two bars, before and with RealComply, 22 Oct 2026.
// NO HOUR FIGURES, on purpose. Adam: "remove the numbered hours, we can't
// verify those but the bars are a good visual representation." The bar
// lengths show the idea only. Don't add numbers here without measured ones.
const BEFORE = [
  { label: "Checklists", flex: 3 },
  { label: "Chasing documents", flex: 2 },
  { label: "Price checks", flex: 1.5 },
  { label: "Registers", flex: 1 },
  { label: "Act questions", flex: 1 },
  { label: "Status", flex: 0.6 },
];

const AFTER = [
  { label: "Upload", flex: 1.4 },
  { label: "Review", flex: 1 },
  { label: "Sign off", flex: 0.8 },
];

export function TimeBack() {
  const { ref, seen } = useInViewOnce<HTMLDivElement>();
  const beforeRef = useRef<HTMLDivElement>(null);
  const afterRef = useRef<HTMLDivElement>(null);
  const beforeGate = useRef(makeGate(1800));
  const afterGate = useRef(makeGate(1800));

  function playBefore() {
    if (!beforeRef.current || !beforeGate.current()) return;
    beforeRef.current.querySelectorAll(`.${styles.seg}`).forEach((seg, i) =>
      replay(seg, [
        { transform: "scaleX(0)", opacity: 0.3 },
        { transform: "none", opacity: 1 },
      ], 450, i * 150),
    );
  }

  function playAfter() {
    if (!afterRef.current || !afterGate.current()) return;
    replay(afterRef.current.querySelector(`.${styles.work}`), [
      { width: "100%" },
      { width: "100%", offset: 0.15 },
      { width: "24%" },
    ], 1300);
    replay(afterRef.current.querySelector(`.${styles.free}`), [{ opacity: 0 }, { opacity: 1 }], 500, 1100);
  }

  return (
    <div ref={ref} className={`${styles.panel} ${seen ? styles.play : ""}`}>
      <h2 className="mb-6 text-3xl font-extrabold tracking-tight sm:text-4xl">Get your time back.</h2>
      <div className={styles.week}>
        <div ref={beforeRef} className={`${styles.track} ${styles.trackBefore}`} onMouseEnter={playBefore} onClick={playBefore}>
          <p className={styles.trackHead}>
            <span className={`${styles.tag} ${styles.tagBefore}`}>Now</span> Without RealComply
          </p>
          <div className={styles.bar} role="img" aria-label="Without RealComply: a full bar of compliance jobs">
            {BEFORE.map((s, i) => (
              <div key={s.label} className={styles.seg} style={{ flex: s.flex, "--i": i } as React.CSSProperties}>
                {s.label}
              </div>
            ))}
          </div>
        </div>
        <div ref={afterRef} className={styles.track} onMouseEnter={playAfter} onClick={playAfter}>
          <p className={styles.trackHead}>
            <span className={`${styles.tag} ${styles.tagAfter}`}>With RealComply</span>
          </p>
          <div
            className={styles.bar}
            role="img"
            aria-label="With RealComply: a short bar of upload, review and sign off, and the rest is time for listing and selling"
          >
            <div className={styles.work}>
              {AFTER.map((s) => (
                <div key={s.label} className={styles.seg} style={{ flex: s.flex }}>
                  {s.label}
                </div>
              ))}
            </div>
            <div className={styles.free}>Listing and selling</div>
          </div>
        </div>
        <p className={styles.banner}>More time doing what you do best.</p>
      </div>
    </div>
  );
}
