"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./infographics.module.css";
import { prefersReducedMotion } from "./motion";

// "Everything your compliance needs. One screen." Replaced "The part that
// does the work for you", 22 Oct 2026.
//
// REVERSAL, recorded loudly. From 17 Aug 2026 the rule for this page was
// "people know the result, not the how it works": no screens, no worked
// example. Adam reversed that on 22 Oct 2026 for speed to market against a
// competitor, and signed off this example screen in the Landing page updates
// thread. It is an illustration, not a real office: the addresses are made
// up and the numbers are examples.
//
// Each part of the screen comes alive in turn while the band is on screen.
// Hovering or tapping a part plays it and pauses the loop; the loop picks up
// again shortly after the pointer leaves.
//
// The Ask the Act answer is s 55(1)(b) of the Property and Stock Agents Act
// 2002: a licensee must serve a copy of the signed agency agreement within
// 48 hours after it is signed. Checked against the Act text 22 Oct 2026.

type Zone = "upload" | "check" | "office" | "ask";
const ORDER: Zone[] = ["upload", "check", "office", "ask"];
const TILES = [
  { to: 8, label: "Live listings" },
  { to: 7, label: "On track" },
  { to: 1, label: "Needs attention" },
];
const ANSWER = "Within 48 hours of it being signed.";
const STEP_MS = 3200;

function ZoneBox({
  zone,
  active,
  onPick,
  className,
  children,
}: {
  zone: Zone;
  active: Zone | null;
  onPick: (zone: Zone) => void;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`${styles.zone} ${active === zone ? styles.zoneOn : ""} ${className}`}
      onMouseEnter={() => onPick(zone)}
      onClick={() => onPick(zone)}
    >
      {children}
    </div>
  );
}

export function ProductScreen() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<Zone | null>(null);
  const [reading, setReading] = useState(false);
  const [counts, setCounts] = useState(TILES.map((t) => t.to));
  const [typed, setTyped] = useState<string | null>(null);
  const [pulseKey, setPulseKey] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const loop = useRef<ReturnType<typeof setInterval> | null>(null);
  const resume = useRef<ReturnType<typeof setTimeout> | null>(null);
  const step = useRef(-1);
  const visible = useRef(false);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  const later = (fn: () => void, ms: number) => timers.current.push(setTimeout(fn, ms));

  const activate = useCallback((zone: Zone) => {
    clearTimers();
    setActive(zone);
    setReading(false);
    setTyped(null);
    if (zone === "upload") {
      setReading(true);
      later(() => setReading(false), 1100);
    } else if (zone === "check") {
      setPulseKey((k) => k + 1);
    } else if (zone === "office") {
      const max = Math.max(...TILES.map((t) => t.to));
      setCounts(TILES.map(() => 0));
      for (let n = 1; n <= max; n++) later(() => setCounts(TILES.map((t) => Math.min(n, t.to))), n * 70);
    } else {
      for (let i = 0; i <= ANSWER.length; i++) later(() => setTyped(ANSWER.slice(0, i)), i * 35);
      later(() => setTyped(null), ANSWER.length * 35 + 40);
    }
  }, []);

  const stopLoop = useCallback(() => {
    if (loop.current) clearInterval(loop.current);
    loop.current = null;
  }, []);

  const startLoop = useCallback(() => {
    if (loop.current || prefersReducedMotion()) return;
    const next = () => {
      step.current = (step.current + 1) % ORDER.length;
      activate(ORDER[step.current]);
    };
    next();
    loop.current = setInterval(next, STEP_MS);
  }, [activate]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || prefersReducedMotion() || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(
      (entries) => {
        visible.current = entries.some((e) => e.isIntersecting);
        if (visible.current) startLoop();
        else stopLoop();
      },
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      stopLoop();
      clearTimers();
      if (resume.current) clearTimeout(resume.current);
    };
  }, [startLoop, stopLoop]);

  function hover(zone: Zone) {
    if (prefersReducedMotion() || active === zone) return;
    stopLoop();
    if (resume.current) clearTimeout(resume.current);
    step.current = ORDER.indexOf(zone);
    activate(zone);
  }

  function leave() {
    if (resume.current) clearTimeout(resume.current);
    resume.current = setTimeout(() => {
      if (visible.current) startLoop();
    }, 1500);
  }


  return (
    <div ref={wrapRef} className={styles.panel}>
      <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
        Everything your compliance needs. One screen.
      </h2>
      <p className="mt-3 mb-7 text-lg leading-relaxed text-rc-muted">The licensee&rsquo;s view in RealComply.</p>
      <div className={styles.screenWrap}>
        <div className={styles.screen} onMouseLeave={leave} aria-label="Example RealComply office view">
          <div className={styles.screenTop}>
            RealComply · Example Realty <span>Licensee view</span>
          </div>
          <div className={styles.screenBody}>
            <ZoneBox zone="upload" active={active} onPick={hover} className={styles.drop}>
              <span className={styles.doc} aria-hidden="true" />
              <span>Agency agreement.pdf</span>
              <span className={styles.read}>{reading ? "Reading…" : "Read and filed ✓"}</span>
            </ZoneBox>
            <ZoneBox zone="office" active={active} onPick={hover} className={styles.tiles}>
              {TILES.map((t, i) => (
                <div key={t.label} className={styles.tile}>
                  <b>{counts[i]}</b>
                  <small>{t.label}</small>
                </div>
              ))}
            </ZoneBox>
            <div className={styles.file}>
              <span className={styles.addr}>14 Example St, Sampletown</span>
              <span className={`${styles.pill} ${styles.pillOk}`}>On track</span>
              <div className={styles.stages} aria-hidden="true">
                <i className={styles.done} />
                <i className={styles.done} />
                <i className={styles.done} />
                <i />
                <i />
                <i />
              </div>
            </div>
            <ZoneBox zone="check" active={active} onPick={hover} className={styles.file}>
              <span className={styles.addr}>3 Mock Rd, Placeholder Bay</span>
              <span key={pulseKey} className={`${styles.pill} ${styles.pillAttention} ${pulseKey ? styles.pulse : ""}`}>
                Needs attention
              </span>
              <div className={styles.stages} aria-hidden="true">
                <i className={styles.done} />
                <i className={styles.done} />
                <i className={styles.held} />
                <i />
                <i />
                <i />
              </div>
              <span className={styles.flag}>Price guide sits below your estimate. Possible underquoting.</span>
            </ZoneBox>
            <ZoneBox zone="ask" active={active} onPick={hover} className={styles.ask}>
              <div className={styles.q}>How long do I have to give the vendor a copy of the agency agreement?</div>
              <div className={styles.a}>
                {typed ?? (
                  <>
                    {ANSWER} <code>PSA Act 2002, s 55(1)(b)</code>
                  </>
                )}
              </div>
            </ZoneBox>
          </div>
        </div>
      </div>
      <p className="mt-5 text-center text-sm text-rc-muted">
        The licensee reviews and signs off. RealComply is diligence support, not legal advice.
      </p>
    </div>
  );
}
