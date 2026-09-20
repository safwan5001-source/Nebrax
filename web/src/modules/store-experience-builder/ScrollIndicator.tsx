"use client";

import { useEffect, useState, type RefObject } from "react";

interface ScrollMetrics {
  top: number;
  height: number;
  visible: boolean;
}

/**
 * AWJ editor-only visible scroll indicator.
 *
 * Native CSS scrollbar styling (`::-webkit-scrollbar` / `scrollbar-width`)
 * does not render reliably on production Safari/iPad, so the customizer
 * renders its own track + thumb driven by real scroll metrics
 * (scrollTop / scrollHeight / clientHeight). It re-syncs on scroll, on
 * viewport resize, and on content size changes (ResizeObserver).
 *
 * Scoped to editor chrome via [data-scroll-indicator] and rendered as a
 * sibling of the scroll region (never inside merchant storefront content),
 * with pointer-events disabled so it can never block interaction.
 */
export function ScrollIndicator({
  targetRef,
}: {
  targetRef: RefObject<HTMLElement | null>;
}) {
  const [metrics, setMetrics] = useState<ScrollMetrics>({
    top: 0,
    height: 0,
    visible: false,
  });

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;

    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const { scrollTop, scrollHeight, clientHeight } = el;
        if (scrollHeight <= clientHeight || clientHeight === 0) {
          setMetrics((m) =>
            m.visible ? { top: 0, height: 0, visible: false } : m,
          );
          return;
        }
        const thumbHeight = Math.max(
          28,
          (clientHeight / scrollHeight) * clientHeight,
        );
        const top =
          (scrollTop / (scrollHeight - clientHeight)) *
          (clientHeight - thumbHeight);
        setMetrics({ top, height: thumbHeight, visible: true });
      });
    };

    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);

    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(update);
      observer.observe(el);
      Array.from(el.children).forEach((child) => observer!.observe(child));
    }

    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      observer?.disconnect();
    };
  }, [targetRef]);

  return (
    <div
      data-scroll-indicator=""
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 left-0 z-20 w-2"
    >
      <div className="absolute inset-y-0 left-0 w-full rounded-full bg-border" />
      {metrics.visible ? (
        <div
          data-scroll-indicator-thumb=""
          className="absolute left-0 w-full rounded-full bg-primary"
          style={{
            height: metrics.height,
            transform: `translateY(${metrics.top}px)`,
          }}
        />
      ) : null}
    </div>
  );
}
