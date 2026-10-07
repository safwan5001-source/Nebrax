/**
 * CUST-HV V5c — the one pure resolver from a section's `design` to what a renderer
 * puts on the DOM (V0 §3.5). Twin of `web/.../presentation/section-design-resolve.ts`
 * (byte-identical, checked by a test) so the Canvas and the published storefront
 * cannot drift.
 *
 * Output is *only*:
 *  - `attrs`: `data-sd` (a space-separated list of the groups in effect) plus
 *    `data-design-type` — structure that parity tests compare instead of pixels;
 *  - `style`: CSS custom properties (`--sec-*`) whose values come from validated
 *    tokens / hex colours — never a string from the document.
 * The stylesheet (`[data-sd~="…"]` rules) turns those into layout. `null` = no
 * design ⇒ the caller renders the section exactly as before (no wrapper at all).
 *
 * What this slice renders: background (solid / gradient), text colours + align,
 * width (`mode: full` solid bleed, `max`), spacing, align, border, radius, shadow.
 * `typography` is accepted by the contract but rendered by V5e; `wide` is treated
 * as `contained` until the page container is restructured (V5d / V1B).
 */
import {
  autoForeground,
  gradientInterval,
  type LuminanceInterval,
  parseHex,
  type Rgb,
  solidInterval,
  TEXT_NORMAL,
  worstRatioForHex,
} from "./contrast-engine";
import { type PresentationPalette, resolveRoleHex } from "./palette";
import type {
  ColorRef,
  Direction,
  SectionDesign,
  Step,
} from "./section-design";

export interface DesignContext {
  primaryColor: string;
  accentColor: string | null;
  palette?: PresentationPalette;
  /** Page direction: logical gradient directions mirror under RTL. */
  dir: "ltr" | "rtl";
}

export interface ResolvedDesign {
  attrs: Record<string, string>;
  style: Record<string, string>;
}

/** Spacing steps — fluid on phones, fixed on desktop; never a pixel input. */
export const STEP_SPACE: Record<Step, string> = {
  none: "0px",
  xs: "0.5rem",
  sm: "1rem",
  md: "clamp(1.25rem, 3vw, 2rem)",
  lg: "clamp(2rem, 5vw, 3.5rem)",
  xl: "clamp(3rem, 8vw, 5rem)",
};
const RADIUS: Record<string, string> = {
  none: "0px",
  sm: "0.375rem",
  md: "0.75rem",
  lg: "1.25rem",
  pill: "9999px",
};
const SHADOW: Record<string, string> = {
  none: "none",
  soft: "0 1px 3px rgba(17, 24, 39, 0.10), 0 1px 2px rgba(17, 24, 39, 0.06)",
  medium: "0 6px 16px rgba(17, 24, 39, 0.12), 0 2px 4px rgba(17, 24, 39, 0.08)",
  strong:
    "0 18px 40px rgba(17, 24, 39, 0.20), 0 4px 8px rgba(17, 24, 39, 0.10)",
};
const BORDER_WIDTH: Record<string, string> = {
  none: "0px",
  hairline: "1px",
  medium: "2px",
};
const MAX_WIDTH: Record<string, string> = {
  narrow: "64rem",
  standard: "85rem",
  wide: "100rem",
};
const ALIGN: Record<string, string> = {
  start: "start",
  center: "center",
  end: "end",
};

/** `to-end` etc. are logical: they mirror under RTL. */
export function cssGradientDirection(
  direction: Direction,
  dir: "ltr" | "rtl",
): string {
  const end = dir === "rtl" ? "left" : "right";
  const start = dir === "rtl" ? "right" : "left";
  switch (direction) {
    case "to-end":
      return `to ${end}`;
    case "to-start":
      return `to ${start}`;
    case "to-bottom":
      return "to bottom";
    case "to-top":
      return "to top";
    case "to-bottom-end":
      return `to bottom ${end}`;
    case "to-bottom-start":
      return `to bottom ${start}`;
    case "to-top-end":
      return `to top ${end}`;
    case "to-top-start":
      return `to top ${start}`;
  }
}

function colour(ref: ColorRef, ctx: DesignContext): string {
  return "role" in ref ? resolveRoleHex(ref.role, ctx) : ref.hex;
}

const intervalCache = new Map<string, LuminanceInterval>();
function backgroundInterval(
  from: string,
  to: string | null,
): LuminanceInterval | null {
  const a = parseHex(from);
  const b = to === null ? a : parseHex(to);
  if (!a || !b) return null;
  const key = `${from}|${to ?? ""}`;
  const hit = intervalCache.get(key);
  if (hit) return hit;
  const interval =
    to === null
      ? solidInterval(a as Rgb)
      : gradientInterval(a as Rgb, b as Rgb);
  if (intervalCache.size > 200) intervalCache.clear();
  intervalCache.set(key, interval);
  return interval;
}

/** Section types whose own markup paints an opaque dark surface of its own. */
export const SURFACE_OWNING_TYPES: ReadonlySet<string> = new Set([
  "hero",
  "appPromo",
  "wholesale",
]);

/** `--store-background` today: what is behind a section that paints no surface of its own. */
export const PAGE_BACKGROUND = "#f8f9fa";

/**
 * Light sections that paint a surface of their own (`bg-store-surface`): where a
 * text-only design (explicit colours, no design background) actually lands.
 */
const LEGACY_SURFACE_HEX: Readonly<Record<string, string>> = {
  banner: "#ffffff",
  deliveryPromise: "#ffffff",
};

export interface EffectiveText {
  /** Foreground applied to body copy (explicit, else automatic over a background). */
  body: string | null;
  /** Section-heading colour (explicit, else the body foreground over a background). */
  heading: string | null;
  link: string | null;
  /** Interval of the section background, when it has one. */
  background: LuminanceInterval | null;
  /**
   * What the text is proven against: the design background, else — for explicit
   * colours with no design background — the surface they will actually be drawn on
   * (the section's own legacy surface, or the page background).
   */
  judged: LuminanceInterval | null;
}

/**
 * The colours a section's text will actually be drawn in. Shared by the renderer
 * and (V5d) the publish gate, so they cannot disagree about what is on screen.
 */
export function effectiveText(
  design: SectionDesign,
  ctx: DesignContext,
  type?: string,
): EffectiveText {
  const bg = design.background;
  let background: LuminanceInterval | null = null;
  if (bg?.kind === "solid")
    background = backgroundInterval(colour(bg.color, ctx), null);
  if (bg?.kind === "gradient")
    background = backgroundInterval(colour(bg.from, ctx), colour(bg.to, ctx));

  // These sections paint their own dark surface (brand gradient, footer band). Without
  // a design background a text colour would land on that legacy surface — which the
  // contrast proof cannot see — so it is not applied at all (fail-closed).
  if (!background && type !== undefined && SURFACE_OWNING_TYPES.has(type)) {
    return {
      body: null,
      heading: null,
      link: null,
      background: null,
      judged: null,
    };
  }

  const auto = background ? autoForeground(background) : null;
  const explicitBody = design.text?.body ? colour(design.text.body, ctx) : null;
  const explicitHeading = design.text?.heading
    ? colour(design.text.heading, ctx)
    : null;
  const body = explicitBody ?? auto;
  const explicitLink = design.text?.link ? colour(design.text.link, ctx) : null;
  // Links default to the proven foreground over a design background — a shared
  // heading's "View all" action would otherwise keep `text-store-primary`, which no
  // contrast proof covers on an arbitrary background.
  const link = explicitLink ?? auto;
  const judged =
    background ??
    ((explicitBody ?? explicitHeading ?? explicitLink) !== null
      ? backgroundInterval(
          (type !== undefined && LEGACY_SURFACE_HEX[type]) || PAGE_BACKGROUND,
          null,
        )
      : null);
  return {
    body,
    heading: explicitHeading ?? body,
    link,
    background,
    judged,
  };
}

/** Worst contrast of a foreground against what it is drawn on; `null` = nothing to judge. */
export function worstTextRatio(
  foreground: string,
  text: EffectiveText,
): number | null {
  return text.judged ? worstRatioForHex(foreground, text.judged) : null;
}

export interface SectionContrastIssue {
  /** The field the merchant fixes: a text colour, or the background itself. */
  field: "body" | "heading" | "link" | "background";
  code: "contrast_insufficient" | "contrast_unprovable";
  ratio: number;
}

/**
 * Twin of PHP `SectionDesignContrast::issues` — the same verdict the publish gate
 * returns as a 422, shown live in the editor. An explicit colour that fails is
 * `contrast_insufficient`; an automatic foreground that cannot be proven on a
 * gradient is `contrast_unprovable` and the *background* is what to change.
 */
export function sectionContrastIssues(
  design: SectionDesign,
  ctx: DesignContext,
  type?: string,
): SectionContrastIssue[] {
  const text = effectiveText(design, ctx, type);
  if (!text.judged) return [];
  const out = new Map<string, SectionContrastIssue>();
  for (const field of ["body", "heading", "link"] as const) {
    const colourHex = text[field];
    if (colourHex === null) continue;
    const worst = worstRatioForHex(colourHex, text.judged);
    if (worst >= TEXT_NORMAL) continue;
    const isExplicit = design.text?.[field] !== undefined;
    if (!isExplicit && field !== "body") continue;
    const code = isExplicit ? "contrast_insufficient" : "contrast_unprovable";
    const outField = isExplicit ? field : "background";
    out.set(`${outField}|${code}`, {
      field: outField,
      code,
      ratio: Math.round(worst * 10000) / 10000,
    });
  }
  return [...out.values()];
}

export function resolveSectionDesign(
  type: string,
  design: SectionDesign | undefined,
  ctx: DesignContext,
): ResolvedDesign | null {
  if (!design || Object.keys(design).length === 0) return null;
  const sd: string[] = [];
  const style: Record<string, string> = {};
  const text = effectiveText(design, ctx, type);

  const bg = design.background;
  let solidBg: string | null = null;
  if (bg?.kind === "solid") {
    solidBg = colour(bg.color, ctx);
    style["--sec-bg"] = solidBg;
    sd.push("bg");
  } else if (bg?.kind === "gradient") {
    style["--sec-bg"] =
      `linear-gradient(${cssGradientDirection(bg.direction, ctx.dir)}, ${colour(bg.from, ctx)}, ${colour(bg.to, ctx)})`;
    sd.push("bg");
  }

  if (text.body) {
    style["--sec-fg"] = text.body;
    sd.push("fg");
  }
  if (text.heading) {
    style["--sec-heading"] = text.heading;
    sd.push("heading");
  }
  if (text.link) {
    style["--sec-link"] = text.link;
    sd.push("link");
  }
  // Two independent controls (V0 §3.3): `text.align` aligns the copy; top-level `align`
  // positions the content *block* inside the section.
  if (design.text?.align) {
    style["--sec-align"] = ALIGN[design.text.align];
    sd.push("align");
  }
  if (design.align) {
    style["--sec-bms"] = design.align === "start" ? "0" : "auto";
    style["--sec-bme"] = design.align === "end" ? "0" : "auto";
    sd.push("balign");
  }

  const sp = design.spacing;
  if (sp?.top) {
    style["--sec-pt"] = STEP_SPACE[sp.top];
    sd.push("pt");
  }
  if (sp?.bottom) {
    style["--sec-pb"] = STEP_SPACE[sp.bottom];
    sd.push("pb");
  }
  if (sp?.inner) {
    style["--sec-pi"] = STEP_SPACE[sp.inner];
    sd.push("pi");
  }

  if (design.width?.max) {
    style["--sec-max"] = MAX_WIDTH[design.width.max];
    sd.push("max");
  }

  // The design *owns* the section's border: an explicit `none` removes a legacy
  // border (banner card, delivery band) just as a width replaces it — see the
  // `[data-sd~="border"] > *` rule.
  const border = design.border;
  if (border) {
    style["--sec-bw"] = BORDER_WIDTH[border.width];
    style["--sec-bc"] =
      border.width === "none"
        ? "transparent"
        : border.color
          ? colour(border.color, ctx)
          : resolveRoleHex("border", ctx);
    sd.push("border");
  }

  // A full-bleed band is a solid colour that extends past the page container; a
  // radius or a drop shadow on something that bleeds off the screen has no meaning,
  // so they apply to contained sections only (a gradient does not bleed — see header).
  const bleeds = design.width?.mode === "full" && solidBg !== null;
  if (bleeds) {
    style["--sec-bleed"] = `0 0 0 100vmax ${solidBg}`;
    sd.push("bleed");
  } else {
    if (design.radius) {
      style["--sec-radius"] = RADIUS[design.radius];
      sd.push("radius");
    }
    if (design.shadow && design.shadow !== "none") {
      style["--sec-shadow"] = SHADOW[design.shadow];
      sd.push("shadow");
    }
  }

  if (sd.length === 0) return null;
  return {
    attrs: { "data-sd": sd.join(" "), "data-design-type": type },
    style,
  };
}
