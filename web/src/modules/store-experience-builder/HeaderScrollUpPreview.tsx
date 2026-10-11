"use client";

import { useEffect, useRef } from "react";
import { watchScroll } from "./canvas-scroll";
import { stepScrollUp } from "./presentation/header-design";

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
    let state = { hidden: false, lastY: 0 };
    const apply = (hidden: boolean) => {
      if (hidden) header.setAttribute("data-header-hidden", "");
      else header.removeAttribute("data-header-hidden");
    };
    const onScroll = (y: number) => {
      state = stepScrollUp(
        state,
        y,
        header.offsetHeight,
        header.contains(document.activeElement),
      );
      apply(state.hidden);
    };
    const reveal = () => {
      state = { hidden: false, lastY: state.lastY };
      apply(false);
    };
    const unwatch = watchScroll(header, onScroll);
    header.addEventListener("focusin", reveal);
    return () => {
      unwatch();
      header.removeEventListener("focusin", reveal);
      apply(false);
    };
  }, []);

  return <span ref={marker} hidden data-header-scroll="" />;
}
