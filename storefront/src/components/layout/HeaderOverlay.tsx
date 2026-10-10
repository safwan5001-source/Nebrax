"use client";

import { useEffect, useRef } from "react";
import { overlayIsSolid } from "@/lib/presentation/header-design";

/**
 * CUST-HV V7c-2 — the overlay-on-hero controller (V0 §9.3). Renders nothing visible. Everything that
 * decides *whether* the header overlays the hero is server-side and CSS (`data-ho` marker + `:has()`), so
 * there is no flash and a page that is not the Home hero is untouched; this only does the dynamic part:
 *
 *  - marks the header `data-header-live` once hydrated (until then an overlay header is NOT sticky — it
 *    scrolls away with the hero, so with no JavaScript it can never sit transparent over later content);
 *  - toggles `data-header-solid` past a small scroll threshold, or at once while the shopper works inside
 *    the header (focus within, an expanded control, an open dialog locking the page);
 *  - publishes the header's measured height as `--hd-block` on the theme wrapper, which the hero uses to
 *    reserve exactly that much room (the stylesheet carries an over-estimating fallback until then).
 */
export function HeaderOverlay({ sticky }: { sticky: boolean }) {
  const marker = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const header = marker.current?.closest("header");
    const wrapper = header?.parentElement;
    if (!header || !wrapper) return;

    const bands = () =>
      Array.from(header.children).filter((el): el is HTMLElement =>
        el.matches("div, nav"),
      );
    const measure = () => {
      const height = bands().reduce(
        (sum, el) => sum + el.getBoundingClientRect().height,
        0,
      );
      wrapper.style.setProperty("--hd-block", `${Math.ceil(height)}px`);
    };
    const pinned = () =>
      header.contains(document.activeElement) ||
      header.querySelector('[aria-expanded="true"]') !== null ||
      document.body.hasAttribute("data-scroll-locked");
    const update = () =>
      header.toggleAttribute(
        "data-header-solid",
        overlayIsSolid(window.scrollY, pinned()),
      );

    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        update();
      });
    };

    if (sticky) header.setAttribute("data-header-live", "");
    measure();
    update();
    const resize = new ResizeObserver(measure);
    for (const band of bands()) resize.observe(band);
    const mutations = new MutationObserver(update);
    mutations.observe(header, {
      attributes: true,
      attributeFilter: ["aria-expanded"],
      subtree: true,
    });
    mutations.observe(document.body, {
      attributes: true,
      attributeFilter: ["data-scroll-locked"],
    });
    window.addEventListener("scroll", onScroll, { passive: true });
    header.addEventListener("focusin", update);
    header.addEventListener("focusout", onScroll);

    return () => {
      window.removeEventListener("scroll", onScroll);
      header.removeEventListener("focusin", update);
      header.removeEventListener("focusout", onScroll);
      resize.disconnect();
      mutations.disconnect();
      if (frame) cancelAnimationFrame(frame);
      header.removeAttribute("data-header-live");
      header.removeAttribute("data-header-solid");
      wrapper.style.removeProperty("--hd-block");
    };
  }, [sticky]);

  return <span ref={marker} hidden data-header-overlay-controller="" />;
}
