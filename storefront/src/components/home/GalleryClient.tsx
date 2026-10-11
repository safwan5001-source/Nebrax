"use client";

import dynamic from "next/dynamic";
import {
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/** The viewer is loaded the first time a picture is opened — its focus handling and navigation never ship with the page. */
const GalleryLightbox = dynamic(
  () => import("./GalleryLightbox").then((module) => module.GalleryLightbox),
  { ssr: false },
);

export interface GalleryViewerItem {
  webp: string;
  jpg: string;
  src: string;
  width: number;
  height: number;
  alt: string;
  caption: string;
}

export interface GalleryLabels {
  label: string;
  /** `Picture {number}` — the name of a linked picture that has neither alt text nor a caption. */
  item: string;
  previous: string;
  next: string;
  /** `View picture {number} larger` */
  open: string;
  viewer: string;
  close: string;
  viewerPrevious: string;
  viewerNext: string;
  /** `{current} of {total}` */
  counter: string;
}

/**
 * CUST-HV V8e — the progressive layer of the published gallery. Everything it adds is an enhancement of markup the server
 * already rendered completely:
 *
 *  - the modal viewer (opened from the anchors the server pointed at the large picture file; a modified click — new tab,
 *    download — is left to the browser);
 *  - the carousel's previous / next buttons (`scrollBy` in the document's direction — in RTL "next" travels toward the
 *    left), rendered only after hydration and only when the strip actually overflows, and `aria-disabled` at the ends.
 */
export function GalleryClient({
  labels,
  items,
  layout,
  viewer,
  dir,
  sectionId,
  children,
}: {
  labels: GalleryLabels;
  items: GalleryViewerItem[];
  layout: "grid" | "carousel";
  viewer: boolean;
  dir: "ltr" | "rtl";
  sectionId: string;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);
  const wasOpen = useRef(false);

  const listOf = useCallback(
    () => rootRef.current?.querySelector<HTMLElement>("[data-gallery-list]"),
    [],
  );

  // carousel: the strip's overflow and its end positions
  useEffect(() => {
    if (layout !== "carousel") return;
    const list = listOf();
    if (!list) return;
    const measure = () => {
      const max = list.scrollWidth - list.clientWidth;
      const position = Math.abs(list.scrollLeft);
      setOverflowing(max > 2);
      setAtStart(position < 2);
      setAtEnd(position > max - 2);
    };
    measure();
    list.addEventListener("scroll", measure, { passive: true });
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    observer?.observe(list);
    return () => {
      list.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, [layout, listOf]);

  // restore focus to the picture that opened the viewer
  useEffect(() => {
    if (open === null && wasOpen.current) {
      openerRef.current?.focus({ preventScroll: true });
    }
    wasOpen.current = open !== null;
  }, [open]);

  const scrollStrip = (forward: boolean) => {
    const list = listOf();
    if (!list) return;
    const physical = (dir === "rtl" ? -1 : 1) * (forward ? 1 : -1);
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    list.scrollBy({
      left: physical * list.clientWidth * 0.9,
      behavior: reduced ? "auto" : "smooth",
    });
  };

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    if (
      !viewer ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    const target = (event.target as Element).closest<HTMLElement>(
      "[data-gallery-open]",
    );
    if (!target || !rootRef.current?.contains(target)) return;
    const index = Number(target.dataset.galleryOpen);
    if (!Number.isInteger(index) || index < 0 || index >= items.length) return;
    event.preventDefault();
    openerRef.current = target;
    setOpen(index);
  };

  const showControls = layout === "carousel" && overflowing;

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: click delegation only — the keyboard-operable elements are the anchors inside; Enter on one dispatches this same click
    <div ref={rootRef} data-gallery-root="" onClick={onClick}>
      {children}
      {showControls ? (
        <>
          <button
            type="button"
            data-gallery-arrow="previous"
            aria-label={labels.previous}
            aria-disabled={atStart}
            onClick={() => !atStart && scrollStrip(false)}
          >
            <Chevron />
          </button>
          <button
            type="button"
            data-gallery-arrow="next"
            aria-label={labels.next}
            aria-disabled={atEnd}
            onClick={() => !atEnd && scrollStrip(true)}
          >
            <Chevron />
          </button>
        </>
      ) : null}
      {open !== null ? (
        <GalleryLightbox
          key={sectionId}
          items={items}
          index={open}
          onIndex={setOpen}
          onClose={() => setOpen(null)}
          labels={labels}
          dir={dir}
        />
      ) : null}
    </div>
  );
}

function Chevron() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth={2.5}
      className="size-5 stroke-current"
    >
      <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
