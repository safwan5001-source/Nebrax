/**
 * AWJ-STORE-CAT-DESIGN-01 — pure edit helpers for the categories section's `design.display`.
 *
 * Every helper routes its result through the contract's own `normalizeDisplay` (the byte-identical twin of the PHP and
 * storefront normalizers), so what the editor stores is exactly what the server would keep: defaults never stored where
 * the contract omits them, fixed key order, out-of-range integers clamped, invalid values dropped, empty groups omitted.
 * Nothing mutates its input, and nothing here touches the section's content (source, order, links): a display is
 * presentation only.
 */

import {
  LAYOUT_PLACEMENTS,
  LAYOUT_SHAPES,
  isScrollLayout,
  usesColumns,
} from "./presentation/categories-display";
import {
  type CategoryDisplay,
  DISPLAY_DEVICES,
  type DisplayCard,
  type DisplayDevice,
  type DisplayImage,
  type DisplayLayout,
  type DisplayName,
  type PerDevice,
  normalizeDisplay,
} from "./presentation/section-design";

export type DisplayGroup = "card" | "image" | "name";
export type ResponsiveKey = "columns" | "gap" | "itemWidth";

type GroupShape = { card: DisplayCard; image: DisplayImage; name: DisplayName };

function clone(display: CategoryDisplay): CategoryDisplay {
  return structuredClone(display);
}

/** Normalize, or `undefined` when nothing survives (a display without a layout is no display). */
function commit(next: Record<string, unknown>): CategoryDisplay | undefined {
  return normalizeDisplay(next);
}

/**
 * Choose the layout. Creating a display from the classic look starts from the layout alone (every other value is the
 * layout's default and is not stored). Switching layout prunes what the new layout cannot draw — an unsupported name
 * placement or picture shape, and the responsive axis it does not use (columns vs item width) — so no inert metadata
 * lingers and the preview never shows a combination the storefront would coerce.
 */
export function setLayout(
  display: CategoryDisplay | undefined,
  layout: DisplayLayout,
): CategoryDisplay | undefined {
  if (!display) return commit({ layout });
  const next = clone(display) as unknown as Record<string, unknown> & CategoryDisplay;
  next.layout = layout;
  if (next.name?.placement && !LAYOUT_PLACEMENTS[layout].includes(next.name.placement)) {
    delete next.name.placement;
  }
  if (next.image?.shape && !LAYOUT_SHAPES[layout].includes(next.image.shape)) {
    delete next.image.shape;
  }
  if (isScrollLayout(layout)) delete next.columns;
  if (usesColumns(layout)) delete next.itemWidth;
  return commit(next);
}

/** The classic look: no display at all. */
export function resetToClassic(): undefined {
  return undefined;
}

/** Set (or, with `undefined`, delete) one field of a group. A group that empties out disappears. */
export function setField<G extends DisplayGroup, K extends keyof GroupShape[G]>(
  display: CategoryDisplay | undefined,
  group: G,
  key: K,
  value: GroupShape[G][K] | undefined,
): CategoryDisplay | undefined {
  if (!display) return undefined;
  const next = clone(display) as unknown as Record<string, Record<string, unknown> | undefined> & CategoryDisplay;
  const bucket: Record<string, unknown> = { ...((next[group] as Record<string, unknown> | undefined) ?? {}) };
  if (value === undefined) delete bucket[key as string];
  else bucket[key as string] = value;
  if (Object.keys(bucket).length === 0) delete next[group];
  else (next as Record<string, unknown>)[group] = bucket;
  return commit(next);
}

/** Set (or delete) one device's value of a responsive axis (`columns`, `gap`, `itemWidth`). */
export function setDevice(
  display: CategoryDisplay | undefined,
  key: ResponsiveKey,
  device: DisplayDevice,
  value: number | undefined,
): CategoryDisplay | undefined {
  if (!display) return undefined;
  const next = clone(display) as unknown as Record<string, unknown> & CategoryDisplay;
  const bucket: PerDevice = { ...((next[key] as PerDevice | undefined) ?? {}) };
  if (value === undefined) delete bucket[device];
  else bucket[device] = value;
  if (Object.keys(bucket).length === 0) delete next[key];
  else (next as Record<string, unknown>)[key] = bucket;
  return commit(next);
}

/** Set (or delete) one device's custom picture height. No device left ⇒ automatic height again. */
export function setImageHeight(
  display: CategoryDisplay | undefined,
  device: DisplayDevice,
  value: number | undefined,
): CategoryDisplay | undefined {
  if (!display) return undefined;
  const next = clone(display) as unknown as Record<string, unknown> & CategoryDisplay;
  const image: DisplayImage = { ...(next.image ?? {}) };
  const height: PerDevice = { ...(image.height ?? {}) };
  if (value === undefined) delete height[device];
  else height[device] = value;
  if (Object.keys(height).length === 0) delete image.height;
  else image.height = height;
  if (Object.keys(image).length === 0) delete next.image;
  else next.image = image;
  return commit(next);
}

/** Drop every device override of a responsive axis at once. */
export function resetResponsive(
  display: CategoryDisplay | undefined,
  key: ResponsiveKey,
): CategoryDisplay | undefined {
  if (!display) return undefined;
  const next = clone(display) as unknown as Record<string, unknown> & CategoryDisplay;
  delete next[key];
  return commit(next);
}

/** Drop a whole group (card / image / name) back to the layout's defaults. */
export function resetGroup(
  display: CategoryDisplay | undefined,
  group: DisplayGroup,
): CategoryDisplay | undefined {
  if (!display) return undefined;
  const next = clone(display) as unknown as Record<string, unknown> & CategoryDisplay;
  delete next[group];
  return commit(next);
}

/** Replace the whole display with a preset's (design fields only — the section's content is never in a display). */
export function applyPreset(presetDisplay: CategoryDisplay): CategoryDisplay | undefined {
  return commit(structuredClone(presetDisplay) as unknown as Record<string, unknown>);
}

/** Structural equality of two normalized displays (key order is canonical, so JSON is a faithful comparison). */
export function sameDisplay(
  a: CategoryDisplay | undefined,
  b: CategoryDisplay | undefined,
): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** How many settings the merchant has set explicitly in a group (for the group's badge). */
export function explicitCount(display: CategoryDisplay | undefined, group: DisplayGroup | "responsive"): number {
  if (!display) return 0;
  if (group === "responsive") {
    return (["columns", "gap", "itemWidth"] as const).reduce(
      (total, key) => total + Object.keys(display[key] ?? {}).length,
      0,
    );
  }
  const bucket = display[group] as Record<string, unknown> | undefined;
  if (!bucket) return 0;
  // A custom height counts once per device so the badge reflects what is overridden.
  return Object.entries(bucket).reduce(
    (total, [key, value]) =>
      total +
      (key === "height" && value && typeof value === "object" ? Object.keys(value).length : 1),
    0,
  );
}

export { DISPLAY_DEVICES };
