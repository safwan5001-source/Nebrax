import { normalizeIconKey } from "./presentation/icon-registry";
import type { ResolvedFacetVisual } from "./presentation/facet-visual";

/** Matches the storefront tile's visible-name rule for count placement. */
export function facetLabelHidden(
  visual: ResolvedFacetVisual | null,
  image: { src?: string } | null,
): boolean {
  if (visual === null || visual.showLabel) return false;
  const imageUsable = visual.content === "image" && visual.image !== undefined && !!image?.src;
  const iconKey = normalizeIconKey(
    visual.content === "icon"
      ? visual.icon
      : visual.content === "image" && !imageUsable
        ? visual.fallbackIcon
        : undefined,
  );
  return imageUsable || iconKey !== undefined;
}
