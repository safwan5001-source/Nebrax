"use client";

import { useEffect, useRef } from "react";
import { watchScroll } from "./canvas-scroll";
import { overlayIsSolid } from "./presentation/header-design";

/**
 * CUST-HV V7c-2 — the Canvas's scroll-position simulator for overlay-on-hero (V0 §9.3 point 6): the same pure rule
 * (`overlayIsSolid`) as the storefront controller, fed by the preview pane's own scroll, toggling the same attributes
 * (`data-header-live`, `data-header-solid`) and publishing the bands' height as `--hd-block` on the Canvas root.
 */
export function HeaderOverlayPreview({ sticky }: { sticky: boolean }) {
  const marker = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const header = marker.current?.closest("header");
    const root = header?.parentElement;
    if (!header || !root) return;
    let y = 0;
    const bands = () =>
      Array.from(header.children).filter((el): el is HTMLElement => el.matches("div, nav"));
    const measure = () => {
      const height = bands().reduce((sum, el) => sum + el.getBoundingClientRect().height, 0);
      root.style.setProperty("--hd-block", `${Math.ceil(height)}px`);
    };
    const update = () =>
      header.toggleAttribute(
        "data-header-solid",
        overlayIsSolid(y, header.contains(document.activeElement) || header.querySelector('[aria-expanded="true"]') !== null),
      );

    if (sticky) header.setAttribute("data-header-live", "");
    measure();
    update();
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    for (const band of bands()) resize?.observe(band);
    const unwatch = watchScroll(header, (next) => {
      y = next;
      update();
    });
    header.addEventListener("focusin", update);
    header.addEventListener("focusout", update);
    return () => {
      unwatch();
      header.removeEventListener("focusin", update);
      header.removeEventListener("focusout", update);
      resize?.disconnect();
      header.removeAttribute("data-header-live");
      header.removeAttribute("data-header-solid");
      root.style.removeProperty("--hd-block");
    };
  }, [sticky]);

  return <span ref={marker} hidden data-header-overlay-controller="" />;
}
