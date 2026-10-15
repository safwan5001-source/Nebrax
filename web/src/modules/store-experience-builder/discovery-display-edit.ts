/**
 * AWJ-VD-H1 / VD-4c — pure edit helpers for the optional display settings of a `discovery` section (VD-4a contract).
 *
 * The rules this module exists to keep:
 *  - **Inheritance (D-08 / VD-4a).** A key is written only when the merchant sets it explicitly. Choosing a template
 *    writes the template id and nothing else; resetting a control deletes its key. Nothing a template or the system
 *    default supplies is ever copied into the document.
 *  - **One normalizer.** Every edit is passed through the builder's section normalizer (`section-content.ts`, the
 *    byte-identical twin of the PHP/storefront normalizers), so the saved document is exactly what PHP would store:
 *    canonical key order, out-of-range integers clamped, anything unusable dropped. These helpers add no validation of
 *    their own — saving never rejects content.
 *  - **Pure.** No React, no I/O; every function returns a new options object and never mutates its input.
 */

import {
  DISCOVERY_TEMPLATES,
  discoveryTemplateOf,
  resolveDiscoveryDisplay,
} from "./presentation/discovery-templates";
import {
  type DiscoveryColumns,
  type DiscoveryContent,
  normalizeOptionalSectionContent,
} from "./presentation/section-content";

/** The four keys the discovery panel itself edits; everything else is a display setting. */
export type DiscoveryBaseKey = "title" | "axis" | "dimension" | "display";

/** The optional display settings (VD-4a), exactly the keys of the contract. */
export type DiscoveryDisplayOptions = Omit<DiscoveryContent, DiscoveryBaseKey>;

export type DiscoveryOptionKey = keyof DiscoveryDisplayOptions;

export type DiscoveryDevice = keyof DiscoveryColumns;

export const DISCOVERY_DEVICES = ["mobile", "tablet", "desktop"] as const satisfies readonly DiscoveryDevice[];

/** Canonical key order of the contract (after `title, axis, dimension?, display`). */
export const DISCOVERY_OPTION_KEYS = [
  "layout",
  "template",
  "columns",
  "rows",
  "gap",
  "textPosition",
  "contentSequence",
  "valueSort",
  "shape",
  "size",
  "showLabel",
  "cardStyle",
  "align",
  "showCounts",
  "maxItems",
] as const satisfies readonly DiscoveryOptionKey[];

/** The keys that, when explicit, override every value's own look in the section (D-08 section level). */
export const DISCOVERY_VISUAL_OVERRIDE_KEYS = ["shape", "size", "showLabel"] as const;

/** Everything in a discovery content except the four keys the panel edits. */
export function discoveryDisplayOptionsOf(content: DiscoveryContent): DiscoveryDisplayOptions {
  const { title: _title, axis: _axis, dimension: _dimension, display: _display, ...options } = content;
  return options;
}

/**
 * Runs `options` through the builder normalizer. A stand-in base (`brand` axis, so no dimension is needed) carries
 * them through and is stripped again, leaving only the canonical, clamped, valid options.
 */
export function normalizeDiscoveryOptions(options: DiscoveryDisplayOptions): DiscoveryDisplayOptions {
  const normalized = normalizeOptionalSectionContent("discovery", {
    title: "",
    axis: "brand",
    display: "tiles",
    ...options,
  }) as DiscoveryContent | undefined;
  return normalized ? discoveryDisplayOptionsOf(normalized) : {};
}

function withoutKey(options: DiscoveryDisplayOptions, key: DiscoveryOptionKey): DiscoveryDisplayOptions {
  const { [key]: _removed, ...rest } = options;
  return rest;
}

function resolvedLayoutOf(options: DiscoveryDisplayOptions) {
  return resolveDiscoveryDisplay({ title: "", axis: "brand", display: "tiles", ...options }).layout;
}

/** Whether the second `rows` value can mean anything: only a carousel is allowed more than one row. */
export function discoveryRowsApply(options: DiscoveryDisplayOptions): boolean {
  return resolvedLayoutOf(options) === "carousel";
}

/**
 * Sets one explicit option and normalizes. `columns` goes through {@link setDiscoveryColumn}; `rows` is refused
 * (returns the options unchanged) while the resolved layout is not a carousel, because it would be meaningless.
 */
export function setDiscoveryOption<K extends Exclude<DiscoveryOptionKey, "columns">>(
  options: DiscoveryDisplayOptions,
  key: K,
  value: DiscoveryDisplayOptions[K] | undefined,
): DiscoveryDisplayOptions {
  if (value === undefined) return normalizeDiscoveryOptions(withoutKey(options, key));
  if (key === "rows" && !discoveryRowsApply(options)) return options;
  return normalizeDiscoveryOptions({ ...options, [key]: value });
}

/** Deletes one option so it inherits again (template, then system default). */
export function resetDiscoveryOption(
  options: DiscoveryDisplayOptions,
  key: DiscoveryOptionKey,
): DiscoveryDisplayOptions {
  return normalizeDiscoveryOptions(withoutKey(options, key));
}

/** Sets (or, with `undefined`, clears) one device's column count; the other devices are untouched. */
export function setDiscoveryColumn(
  options: DiscoveryDisplayOptions,
  device: DiscoveryDevice,
  count: number | undefined,
): DiscoveryDisplayOptions {
  const columns: DiscoveryColumns = { ...(options.columns ?? {}) };
  if (count === undefined) delete columns[device];
  else columns[device] = count;
  const rest = withoutKey(options, "columns");
  return normalizeDiscoveryOptions(Object.keys(columns).length > 0 ? { ...rest, columns } : rest);
}

/**
 * Chooses a template. Writes **only** the template id: none of its layout, columns, shape, … are copied, so a later
 * change to the template's values (it is append-only, but defaults may be refined) still reaches the section, and
 * every explicit setting keeps winning over it. `undefined` (or an unknown id) removes the template.
 */
export function selectDiscoveryTemplate(
  options: DiscoveryDisplayOptions,
  id: string | undefined,
): DiscoveryDisplayOptions {
  if (discoveryTemplateOf(id) === undefined) return resetDiscoveryOption(options, "template");
  return normalizeDiscoveryOptions({ ...options, template: id as DiscoveryContent["template"] });
}

/** Removes every optional display setting at once (back to the legacy tiles/chips look). */
export function resetAllDiscoveryOptions(): DiscoveryDisplayOptions {
  return {};
}

/** Number of explicit settings; `columns` counts one per device set. */
export function explicitDiscoveryOptionCount(options: DiscoveryDisplayOptions): number {
  let count = 0;
  for (const key of DISCOVERY_OPTION_KEYS) {
    if (options[key] === undefined) continue;
    count += key === "columns" ? Object.keys(options.columns ?? {}).length : 1;
  }
  return count;
}

/** The shape / size / label keys the merchant has forced on every value of the section. */
export function explicitVisualOverrides(
  options: DiscoveryDisplayOptions,
): Array<(typeof DISCOVERY_VISUAL_OVERRIDE_KEYS)[number]> {
  return DISCOVERY_VISUAL_OVERRIDE_KEYS.filter((key) => options[key] !== undefined);
}

export type DiscoverySource =
  | { kind: "explicit" }
  | { kind: "template"; templateId: string }
  | { kind: "system" }
  /** Layout only: nothing chose one, so the renderer keeps the legacy tiles/chips (`display`). */
  | { kind: "legacy" };

/**
 * Where a control's effective value comes from — the same precedence as `resolveDiscoveryDisplay`:
 * explicit section value → template → system default. `device` selects the column entry.
 */
export function discoverySource(
  options: DiscoveryDisplayOptions,
  key: DiscoveryOptionKey,
  device?: DiscoveryDevice,
): DiscoverySource {
  const explicit =
    key === "columns" && device !== undefined ? options.columns?.[device] !== undefined : options[key] !== undefined;
  if (explicit) return { kind: "explicit" };
  const templateId = options.template;
  const template = discoveryTemplateOf(templateId) as Record<string, unknown> | undefined;
  if (templateId !== undefined && template !== undefined) {
    const fromTemplate =
      key === "columns" && device !== undefined
        ? (template.columns as DiscoveryColumns | undefined)?.[device] !== undefined
        : template[key] !== undefined;
    // `rows` is defined by the template for the carousel only.
    if (fromTemplate && (key !== "rows" || resolvedLayoutOf(options) === "carousel")) {
      return { kind: "template", templateId };
    }
  }
  return key === "layout" ? { kind: "legacy" } : { kind: "system" };
}

/** Template ids in registry order (append-only), for the picker. */
export const DISCOVERY_TEMPLATE_ORDER = Object.keys(DISCOVERY_TEMPLATES) as ReadonlyArray<
  keyof typeof DISCOVERY_TEMPLATES
>;
