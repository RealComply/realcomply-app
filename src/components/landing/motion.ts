"use client";

import { useEffect, useRef, useState } from "react";

// Shared motion helpers for the landing page infographics (22 Oct 2026).

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

// True once the element has scrolled a quarter into view. Fires once: the
// band plays on the way down and then stays at rest, and hover replays it.
export function useInViewOnce<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    // No IntersectionObserver (very old browsers): the band stays at rest,
    // fully visible, and hover still plays it.
    if (!el || seen || prefersReducedMotion() || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);

  return { ref, seen };
}

// Replays a keyframe animation on one element without touching its classes,
// so the scroll animation's end state is left alone. fill "backwards" holds
// the first frame through any delay, then hands back to the resting style.
export function replay(el: Element | null, keyframes: Keyframe[], duration: number, delay = 0) {
  if (!el || prefersReducedMotion() || typeof (el as HTMLElement).animate !== "function") return;
  (el as HTMLElement).animate(keyframes, { duration, delay, easing: "ease", fill: "backwards" });
}

// Stops a hover replay from restarting itself while it is still running.
export function makeGate(ms: number) {
  let busy = false;
  return () => {
    if (busy) return false;
    busy = true;
    setTimeout(() => {
      busy = false;
    }, ms);
    return true;
  };
}
