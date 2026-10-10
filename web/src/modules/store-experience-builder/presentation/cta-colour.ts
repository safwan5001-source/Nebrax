/**
 * CUST-HV V6c-6 (V0 §6.1 "label contrast follows §4.5") — a Hero / Banner button's per-CTA `colour`: the paint it
 * resolves to, and the publish gate that proves it.
 *
 * `solid` / `soft` compute their label over their own opaque fill (`buttonColours`), so they pass by construction.
 * `outline` / `link` label with the role colour itself, directly on what the section draws behind the button, so
 * that colour is proven against the luminance interval of that backdrop: the design background (solid, gradient, or a
 * picture's proven bounds under its overlay); with no design background the hero's brand gradient, or the banner's
 * own surface (white, and the palette surface when set). Unproven = non-compliant. A button without a `colour`
 * follows the section's own colours, which the section already proves.
 *
 * Twin of PHP `App\Support\Commerce\CtaColourContrast` (the authority) and of `web/.../presentation/cta-colour.ts`
 * (byte-identical, test-enforced); all are pinned by `tests/Fixtures/presentation/cta-colour.json`.
 */
import {
  gradientInterval,
  type LuminanceInterval,
  parseHex,
  passes,
  type Rgb,
  solidInterval,
  worstRatioForHex,
} from "./contrast-engine";
import { buttonColours } from "./global-tokens";
import { resolveRoleHex } from "./palette";
import type { CtaColour, CtaStyle, HeroCta } from "./section-content";
import type { SectionDesign } from "./section-design";
import { type DesignContext, effectiveText } from "./section-design-resolve";
import { mixHex } from "./tokens";

/** Absent style ⇒ by position: the first button solid, the second outline (what both sections always did). */
export function effectiveCtaStyle(
  style: CtaStyle | undefined,
  index: number,
): CtaStyle {
  return style ?? (index === 0 ? "solid" : "outline");
}

export interface CtaPaint {
  fill: string;
  label: string;
  border: string;
}

/** The fill / label / border a coloured button is drawn with (concrete `#rrggbb`, or `transparent`). */
export function ctaPaint(
  style: CtaStyle,
  colour: CtaColour,
  ctx: DesignContext,
): CtaPaint {
  const { fill, label, border } = buttonColours(
    style,
    resolveRoleHex(colour, ctx),
    "none",
  );
  return { fill, label, border };
}

export const BANNER_SURFACE = "#ffffff";

/** The brand gradient a hero paints without a design background: primary 700 → 600 → 500. */
export function heroGradientInterval(brand: string): LuminanceInterval | null {
  const c = parseHex(brand);
  const dark = parseHex(mixHex(brand, "#000000", 0.18));
  const light = parseHex(mixHex(brand, "#ffffff", 0.18));
  if (!c || !dark || !light) return null;
  const a = gradientInterval(dark as Rgb, c as Rgb);
  const b = gradientInterval(c as Rgb, light as Rgb);
  return { min: Math.min(a.min, b.min), max: Math.max(a.max, b.max) };
}

/** What is behind a button: the intervals to judge against (the worst counts), or `null` = unprovable. */
export function ctaBackdrops(
  type: "hero" | "banner",
  design: SectionDesign | undefined,
  ctx: DesignContext,
): LuminanceInterval[] | null {
  if (design?.background) {
    const background = effectiveText(design, ctx, type).background;
    return background ? [background] : null;
  }
  if (type === "hero") {
    const gradient = heroGradientInterval(ctx.primaryColor);
    return gradient ? [gradient] : null;
  }
  const hexes = [BANNER_SURFACE];
  const surface = ctx.palette?.surface;
  if (surface && parseHex(surface)) hexes.push(surface);
  return hexes.map((hex) => solidInterval(parseHex(hex) as Rgb));
}

export interface CtaColourIssue {
  /** Index of the button in the section's `ctas`. */
  index: number;
  code: "contrast_insufficient" | "contrast_unprovable";
  ratio: number;
}

/**
 * Twin of PHP `CtaColourContrast::issues` — the verdict the publish gate returns as a 422, shown live in the editor.
 * Judged: a button that will be drawn (label and link), with an explicit `colour`, whose effective style is
 * `outline` or `link`.
 */
export function ctaColourIssues(
  type: string,
  ctas: readonly HeroCta[] | undefined,
  design: SectionDesign | undefined,
  ctx: DesignContext,
): CtaColourIssue[] {
  if ((type !== "hero" && type !== "banner") || !ctas) return [];
  const out: CtaColourIssue[] = [];
  let backdrops: LuminanceInterval[] | null | undefined;
  // the position of a button among the DRAWN ones decides its default style (the renderers' own rule)
  let position = -1;
  ctas.forEach((cta, index) => {
    if (cta.label.trim() === "" || cta.href === "") return; // an incomplete draft is not drawn, nor positioned
    position++;
    if (!cta.colour) return;
    const style = effectiveCtaStyle(cta.style, position);
    if (style !== "outline" && style !== "link") return;
    if (backdrops === undefined) backdrops = ctaBackdrops(type, design, ctx);
    if (backdrops === null) {
      out.push({ index, code: "contrast_unprovable", ratio: 1 });
      return;
    }
    const hex = resolveRoleHex(cta.colour, ctx);
    let worst = Number.POSITIVE_INFINITY;
    for (const interval of backdrops)
      worst = Math.min(worst, worstRatioForHex(hex, interval));
    if (!passes(worst)) {
      out.push({
        index,
        code: "contrast_insufficient",
        ratio: Math.round(worst * 10000) / 10000,
      });
    }
  });
  return out;
}
