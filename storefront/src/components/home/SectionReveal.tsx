"use client";

import { useEffect } from "react";

/**
 * CUST-HV V5e-3 — the one-time `fade-up` reveal (V0 §6.6). It renders nothing; once mounted it
 * finds the sections that opted in (`data-sd~="reveal"`) and:
 *  - leaves **every section already in the viewport untouched** — nothing above the fold (the LCP
 *    content included) is ever hidden or delayed;
 *  - marks only the sections that start **below the fold** `data-reveal="wait"` and reveals each
 *    one **once** (`"in"`, a ≤ 400 ms opacity/transform transition) when it first scrolls into view;
 *  - does nothing at all under `prefers-reduced-motion: reduce` or without `IntersectionObserver`,
 *    and before JavaScript runs every section is simply visible (no-JS safe).
 * The stylesheet rules live in `globals.css` (`[data-sd~="reveal"][data-reveal=…]`).
 */
export function SectionReveal() {
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const pending = [
      ...document.querySelectorAll<HTMLElement>('[data-sd~="reveal"]'),
    ].filter((el) => el.getBoundingClientRect().top >= window.innerHeight);
    if (pending.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.setAttribute("data-reveal", "in");
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.12 },
    );
    for (const el of pending) {
      el.setAttribute("data-reveal", "wait");
      observer.observe(el);
    }
    return () => {
      observer.disconnect();
      for (const el of pending) el.removeAttribute("data-reveal");
    };
  }, []);

  return null;
}
