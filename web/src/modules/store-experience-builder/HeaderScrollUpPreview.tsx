"use client";

import { useEffect, useRef } from "react";
import { stepScrollUp } from "./presentation/header-design";

/** The nearest ancestor that actually scrolls (the preview pane), else the window. */
function scrollHost(from: HTMLElement): HTMLElement | Window {
  for (let el = from.parentElement; el; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if (overflowY === "auto" || overflowY === "scroll") return el;
  }
  return window;
}

/**
 * CUST-HV V7c-1 — the Canvas's scroll-position simulator for `sticky: on-scroll-up` (V0 §9.3 point 6):
 * the same pure rule (`stepScrollUp`) as the storefront controller, fed by the preview pane's own scroll,
 * toggling the same `data-header-hidden` attribute the shared stylesheet block slides.
 */
export function HeaderScrollUpPreview() {
  const marker = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const header = marker.current?.closest("header");
    if (!header) return;
    const host = scrollHost(header);
    const top = () => (host instanceof Window ? host.scrollY : host.scrollTop);

    let state = { hidden: false, lastY: Math.max(0, top()) };
    const apply = (hidden: boolean) => {
      if (hidden) header.setAttribute("data-header-hidden", "");
      else header.removeAttribute("data-header-hidden");
    };
    const onScroll = () => {
      state = stepScrollUp(
        state,
        top(),
        header.offsetHeight,
        header.contains(document.activeElement),
      );
      apply(state.hidden);
    };
    const reveal = () => {
      state = { hidden: false, lastY: Math.max(0, top()) };
      apply(false);
    };
    host.addEventListener("scroll", onScroll, { passive: true });
    header.addEventListener("focusin", reveal);
    return () => {
      host.removeEventListener("scroll", onScroll);
      header.removeEventListener("focusin", reveal);
      apply(false);
    };
  }, []);

  return <span ref={marker} hidden data-header-scroll="" />;
}
