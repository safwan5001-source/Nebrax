/**
 * AWJ-VD-H1 / VD-4a — code-owned display templates of the `discovery` section (§3.7) and the resolver that turns a
 * section's content into its effective display.
 *
 * Twin of `web/.../presentation/discovery-templates.ts` (byte-identical, test-enforced). The PHP authority is
 * `App\Support\Commerce\DiscoveryTemplateRegistry`; all three are pinned to
 * `tests/Fixtures/presentation/discovery-templates.json`. Append-only: a shipped id is never removed or renamed.
 *
 * Precedence for every layout key: the section's explicit value → the template → the system default. Shape, size and
 * label are not resolved here: they belong to the facet-visual chain (D-08), which takes the section's explicit values
 * as its `section` context and the template's as its `template` context — below the value's own visual.
 */

import type { FacetVisualShape, FacetVisualSize } from "./facet-visual";
import type {
  DiscoveryAlign,
  DiscoveryCardStyle,
  DiscoveryColumns,
  DiscoveryContent,
  DiscoveryContentSequence,
  DiscoveryGap,
  DiscoveryLayout,
  DiscoveryTextPosition,
  DiscoveryValueSort,
} from "./section-content";

export interface DiscoveryTemplate {
  layout: DiscoveryLayout;
  columns?: DiscoveryColumns;
  rows?: number;
  textPosition: DiscoveryTextPosition;
  shape?: FacetVisualShape;
  size?: FacetVisualSize;
  cardStyle: DiscoveryCardStyle;
}

export const DISCOVERY_TEMPLATES = {
  "gift-circles": {
    layout: "image-grid",
    columns: { mobile: 3, tablet: 4, desktop: 6 },
    textPosition: "below",
    shape: "circle",
    size: "md",
    cardStyle: "plain",
  },
  "boutique-arches": {
    layout: "image-cards",
    columns: { mobile: 2, tablet: 3, desktop: 4 },
    textPosition: "below",
    shape: "arch",
    size: "lg",
    cardStyle: "plain",
  },
  "editorial-portrait": {
    layout: "image-cards",
    columns: { mobile: 2, tablet: 3, desktop: 4 },
    textPosition: "overlay",
    shape: "portrait",
    size: "lg",
    cardStyle: "plain",
  },
  "market-icons": {
    layout: "icon-grid",
    columns: { mobile: 4, tablet: 6, desktop: 8 },
    textPosition: "below",
    shape: "rounded",
    size: "sm",
    cardStyle: "filled",
  },
  "swipe-rail": {
    layout: "carousel",
    rows: 2,
    textPosition: "below",
    shape: "circle",
    size: "md",
    cardStyle: "plain",
  },
  "minimal-text": {
    layout: "text-list",
    columns: { mobile: 1, tablet: 2, desktop: 3 },
    textPosition: "beside",
    cardStyle: "outlined",
  },
  "catalog-rounded": {
    layout: "image-grid",
    columns: { mobile: 3, tablet: 4, desktop: 6 },
    textPosition: "below",
    shape: "rounded",
    size: "md",
    cardStyle: "outlined",
  },
} as const satisfies Record<string, DiscoveryTemplate>;

export type DiscoveryTemplateId = keyof typeof DISCOVERY_TEMPLATES;

export const DISCOVERY_TEMPLATE_IDS = Object.keys(
  DISCOVERY_TEMPLATES,
) as DiscoveryTemplateId[];

/** System defaults when neither the section nor its template sets a key (§3.7). */
export const DISCOVERY_DISPLAY_DEFAULTS = {
  columns: { mobile: 2, tablet: 3, desktop: 4 },
  rows: 1,
  gap: "normal",
  textPosition: "below",
  contentSequence: "media-first",
  valueSort: "merchant",
  cardStyle: "plain",
  align: "center",
  showCounts: false,
  maxItems: 12,
} as const;

export interface ResolvedDiscoveryDisplay {
  /** `null`: no layout chosen anywhere — the renderer keeps the legacy `display` (tiles/chips) behaviour. */
  layout: DiscoveryLayout | null;
  columns: Required<DiscoveryColumns>;
  rows: number;
  gap: DiscoveryGap;
  textPosition: DiscoveryTextPosition;
  contentSequence: DiscoveryContentSequence;
  valueSort: DiscoveryValueSort;
  cardStyle: DiscoveryCardStyle;
  align: DiscoveryAlign;
  showCounts: boolean;
  maxItems: number;
  /** The facet-visual resolver's `section` context: only what the section set explicitly. */
  visualSection: {
    shape?: FacetVisualShape;
    size?: FacetVisualSize;
    showLabel?: boolean;
  };
  /** The facet-visual resolver's `template` context. */
  visualTemplate: { shape?: FacetVisualShape; size?: FacetVisualSize };
}

export function discoveryTemplateOf(
  id: string | undefined,
): DiscoveryTemplate | undefined {
  // An explicit id list, not a property lookup: no prototype keys (`constructor`) and no newer built-ins.
  return id !== undefined &&
    (DISCOVERY_TEMPLATE_IDS as readonly string[]).includes(id)
    ? (DISCOVERY_TEMPLATES as Record<string, DiscoveryTemplate>)[id]
    : undefined;
}

export function resolveDiscoveryDisplay(
  content: DiscoveryContent,
): ResolvedDiscoveryDisplay {
  const template = discoveryTemplateOf(content.template);
  const defaults = DISCOVERY_DISPLAY_DEFAULTS;
  const column = (device: keyof DiscoveryColumns): number =>
    content.columns?.[device] ??
    template?.columns?.[device] ??
    defaults.columns[device];

  const visualSection: ResolvedDiscoveryDisplay["visualSection"] = {};
  if (content.shape !== undefined) visualSection.shape = content.shape;
  if (content.size !== undefined) visualSection.size = content.size;
  if (content.showLabel !== undefined)
    visualSection.showLabel = content.showLabel;
  const visualTemplate: ResolvedDiscoveryDisplay["visualTemplate"] = {};
  if (template?.shape !== undefined) visualTemplate.shape = template.shape;
  if (template?.size !== undefined) visualTemplate.size = template.size;

  const layout = content.layout ?? template?.layout ?? null;
  return {
    layout,
    columns: {
      mobile: column("mobile"),
      tablet: column("tablet"),
      desktop: column("desktop"),
    },
    // §3.7 — a second row exists only for the carousel (mobile); any other layout is a single flow.
    rows:
      layout === "carousel"
        ? (content.rows ?? template?.rows ?? defaults.rows)
        : defaults.rows,
    gap: content.gap ?? defaults.gap,
    textPosition:
      content.textPosition ?? template?.textPosition ?? defaults.textPosition,
    contentSequence: content.contentSequence ?? defaults.contentSequence,
    valueSort: content.valueSort ?? defaults.valueSort,
    cardStyle: content.cardStyle ?? template?.cardStyle ?? defaults.cardStyle,
    align: content.align ?? defaults.align,
    showCounts: content.showCounts ?? defaults.showCounts,
    maxItems: content.maxItems ?? defaults.maxItems,
    visualSection,
    visualTemplate,
  };
}
