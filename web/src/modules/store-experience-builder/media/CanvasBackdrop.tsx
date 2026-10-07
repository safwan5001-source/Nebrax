"use client";

import type { SectionBackground } from "../presentation/section-design";
import { useMediaRefPreview } from "./use-media-ref-preview";

/**
 * CUST-HV V6b-4a — the Canvas's twin of the storefront's `SectionBackdrop`: the SAME
 * `data-sd-backdrop` / `data-sd-overlay` structure, so the one CSS block (kept identical in both
 * stylesheets) styles both. The picture URL is the editor-only signed workspace URL
 * (`useMediaRefPreview`); the Canvas simulates the device, so the phone picture is chosen from the
 * `viewport` prop rather than a media query against the host window. Decorative and inert.
 */
export function CanvasBackdrop({
  background,
  viewport,
}: {
  background: Extract<SectionBackground, { kind: "media" }>;
  viewport: "desktop" | "tablet" | "mobile";
}) {
  const defaultUrl = useMediaRefPreview(background.media);
  const phoneUrl = useMediaRefPreview(background.mobile ?? null);
  const src = viewport === "mobile" && phoneUrl ? phoneUrl : defaultUrl;
  if (!src) return null;
  const focal = background.media.focal;
  return (
    <div data-sd-backdrop="" aria-hidden="true">
      <picture>
        {/* biome-ignore lint/performance/noImgElement: editor-only signed preview URL, not a static import */}
        <img
          src={src}
          alt=""
          decoding="async"
          style={focal ? { objectPosition: `${focal.x}% ${focal.y}%` } : undefined}
        />
      </picture>
      {background.overlay ? <div data-sd-overlay="" /> : null}
    </div>
  );
}
