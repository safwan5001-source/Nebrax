"use client";

import { useEffect, useRef } from "react";
import { stepScrollUp } from "@/lib/presentation/header-design";

/**
 * CUST-HV V7c-1 — the `sticky: on-scroll-up` controller (V0 §9.2). Renders nothing visible: it finds
 * its own `<header>`, and toggles `data-header-hidden` on it (the stylesheet turns that into the slide).
 * The rule itself is `stepScrollUp` — pure, shared with the Canvas simulator.
 *
 * Without JavaScript the header simply stays (it is `sticky` like `always`). It is never hidden while
 * focus is inside it, while a menu / search is expanded or the page scroll is locked by an open dialog,
 * and a focus that arrives while it is hidden (keyboard Tab) brings it back first.
 */
export function HeaderScrollUp() {
  const marker = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const header = marker.current?.closest("header");
    if (!header) return;

    let state = { hidden: false, lastY: Math.max(0, window.scrollY) };
    let frame = 0;
    const apply = (hidden: boolean) => {
      if (hidden) header.setAttribute("data-header-hidden", "");
      else header.removeAttribute("data-header-hidden");
    };
    const pinned = () =>
      header.contains(document.activeElement) ||
      header.querySelector('[aria-expanded="true"]') !== null ||
      document.body.hasAttribute("data-scroll-locked");
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        state = stepScrollUp(
          state,
          window.scrollY,
          header.offsetHeight,
          pinned(),
        );
        apply(state.hidden);
      });
    };
    const reveal = () => {
      state = { hidden: false, lastY: Math.max(0, window.scrollY) };
      apply(false);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    header.addEventListener("focusin", reveal);
    return () => {
      window.removeEventListener("scroll", onScroll);
      header.removeEventListener("focusin", reveal);
      if (frame) cancelAnimationFrame(frame);
      apply(false);
    };
  }, []);

  return <span ref={marker} hidden data-header-scroll="" />;
}
