import {
  mediaBoundsLookup,
  sectionBackdrop,
} from "@/lib/presentation/background-media";
import type { StorefrontPresentationConfig } from "@/lib/presentation/config";
import {
  type HeaderOverlay,
  resolveHeaderOverlay,
} from "@/lib/presentation/header-overlay";
import type { ResolvedMediaMap } from "@/lib/presentation/media-ref";
import {
  type DesignContext,
  resolveSectionDesign,
} from "@/lib/presentation/section-design-resolve";

/**
 * CUST-HV V7c-2 — the published Home page's overlay-on-hero decision. The proof itself is
 * `resolveHeaderOverlay` (shared with the Canvas); this adds what only the server knows: the picture
 * must really be rendered (the resolver emitted its `mbg` token and the server resolved the media),
 * otherwise the header stays solid. `null` ⇒ solid.
 */
export function publishedHeaderOverlay(
  presentation: StorefrontPresentationConfig | null,
  media: ResolvedMediaMap,
  context: DesignContext | undefined,
): HeaderOverlay | null {
  if (!presentation || !context) return null;
  const sections = presentation.homepage.sections;
  const design: DesignContext = {
    ...context,
    mediaBounds: mediaBoundsLookup(sections, media),
  };
  const decision = resolveHeaderOverlay(
    presentation.header.design,
    sections,
    design,
  );
  if (!decision || !("overlay" in decision)) return null;
  const index = sections.findIndex(
    (section) => section.id === decision.overlay.sectionId,
  );
  const section = sections[index];
  if (!section) return null;
  const rendered =
    resolveSectionDesign(section.type, section.design, design)
      ?.attrs["data-sd"]?.split(" ")
      .includes("mbg") === true && sectionBackdrop(section, index, media);
  return rendered ? decision.overlay : null;
}
