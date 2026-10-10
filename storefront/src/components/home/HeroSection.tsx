import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { CSSProperties, ReactNode } from "react";
import { destination } from "@/lib/home/destination";
import { ctaPaint, effectiveCtaStyle } from "@/lib/presentation/cta-colour";
import type {
  CtaColour,
  CtaStyle,
  HeroCta,
} from "@/lib/presentation/section-content";
import type { DesignContext } from "@/lib/presentation/section-design-resolve";
import type { ThemePresetId } from "@/lib/presentation/tokens";
import { cn } from "@/lib/utils";

// CUST-HV V6c-5 — the three looks of a hero button, all painted with the section's own foreground (the colour its
// heading is proven in), so a style adds no contrast surface: solid = the inverse fill (the hero's primary button),
// outline = the inverse outline, link = text only. `link` drops the button padding but keeps the 36/44 px tap height.
const HERO_CTA_LOOK: Record<CtaStyle, string> = {
  solid: "bg-store-primary-foreground text-store-primary shadow-md",
  outline:
    "border-2 border-store-primary-foreground/70 text-store-primary-foreground",
  link: "px-1 text-store-primary-foreground underline decoration-2 underline-offset-4 md:px-2",
  // `soft` only exists with a colour (its tint is a role colour's); without one it keeps the section's primary look.
  soft: "bg-store-primary-foreground text-store-primary shadow-md",
};

// CUST-HV V6c-6 — a button with an explicit `colour` is painted from three validated custom properties (hex values
// computed from the palette role, never from the document); `outline` / `link` colours are proven by the publish gate.
const COLOURED_CTA =
  "border-2 border-(color:--cta-border) bg-(color:--cta-fill) text-(color:--cta-label)";
const COLOURED_LINK = "px-1 underline decoration-2 underline-offset-4 md:px-2";

interface HeroSectionProps {
  basePath: string;
  locale: string;
  storeName: string | null;
  /**
   * Merchant-configured hero copy from the published presentation
   * (`homepage.heroHeadline` / `homepage.heroSubheadline`); the Home page
   * passes both. An empty headline falls back to the store name; an empty
   * subheadline renders nothing. Only this copy is configurable today — image,
   * overlay, CTA and per-instance design belong to CUST-HV V6.
   */
  headline?: string | null;
  subheadline?: string | null;
  /** See `CategoriesSection`'s identical prop doc for why this is explicit. */
  themePreset?: ThemePresetId;
  /** A section design frame wraps the hero: expose the content-box marker its rules address. */
  designed?: boolean;
  /**
   * CUST-HV V6a — the hero instance's own calls to action (≤ 2). With none authored the hero keeps
   * its one default "shop now" CTA (V0 §8.2); the first authored CTA takes that CTA's look, a
   * second one is the quieter outline companion.
   */
  ctas?: readonly HeroCta[] | null;
  /**
   * CUST-HV V6a — the heading's id (also the section's `aria-labelledby`): one per instance, the
   * first/legacy hero keeps `home-hero`.
   */
  headingId?: string;
  /**
   * CUST-HV V6a (V0 §8.1.3) — exactly one `<h1>` per home page: the first visible hero renders
   * `1`, any further hero `2`.
   */
  headingLevel?: 1 | 2;
  /**
   * CUST-HV V6b-3 — the picture layer of a media background (`SectionBackdrop`), rendered first so
   * the hero's content paints above it. Absent ⇒ the hero is byte-identical to before.
   */
  backdrop?: ReactNode;
  /**
   * CUST-HV V6c-6 — the palette the per-CTA `colour` roles resolve in (primary / accent / palette). Absent ⇒ a `colour`
   * is not painted and the button keeps its style's look.
   */
  designCtx?: DesignContext;
}

/**
 * The storefront masthead.
 *
 * It states who the store is and offers one way into the catalogue, and that is
 * all it claims. The live storefront contract carries a name and a default
 * locale, and the merchant's published presentation adds a headline and a
 * subheadline — no banner image, no campaign — so there is nothing else here
 * that would be true.
 *
 * With no merchant image to place, the band is deliberately plain: the store's
 * name set large on the approved palette, one CTA, and nothing else. An earlier
 * pass filled the empty side with an oversized translucent initial; that read
 * as placeholder decoration and was removed rather than replaced, because
 * anything put there — a monogram, an illustration, a stock photograph — would
 * be storefront invention standing in for merchant content. The band is not
 * made taller to compensate for the space it no longer fills.
 *
 * AWJ Market shrinks it further still: the benchmark's high-SKU retail
 * composition puts category/product discovery first and treats the masthead
 * as a brief identity strip, not a destination — see the coverage matrix.
 * Nothing about *what* the band says changes, only how much vertical space it
 * claims before the categories/products below it appear.
 */
export async function HeroSection({
  basePath,
  locale,
  storeName,
  headline,
  subheadline,
  themePreset,
  designed = false,
  ctas,
  headingId = "home-hero",
  headingLevel = 1,
  backdrop,
  designCtx,
}: HeroSectionProps) {
  const t = await getTranslations({
    locale: locale as Locale,
    namespace: "home",
  });
  const footer = await getTranslations({
    locale: locale as Locale,
    namespace: "footer",
  });
  const displayName = storeName?.trim() || footer("shop");
  const title = headline?.trim() || displayName;
  const isMarket = themePreset === "awj-market";
  const Heading = headingLevel === 1 ? "h1" : "h2";
  // The default CTA is for a hero that authored NO buttons. Buttons that exist but are incomplete
  // (a draft with a cleared link) are not shown — and must not bring the default link back.
  const hasAuthoredCtas = (ctas?.length ?? 0) > 0;
  const authored = (ctas ?? [])
    .map((cta) => ({
      label: cta.label.trim(),
      href: destination(basePath, cta.href),
      style: cta.style,
      colour: cta.colour,
    }))
    .filter(
      (
        cta,
      ): cta is {
        label: string;
        href: string;
        style: CtaStyle | undefined;
        colour: CtaColour | undefined;
      } => cta.label !== "" && cta.href !== null,
    );

  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        "flex items-center rounded-store bg-linear-to-r rtl:bg-linear-to-l from-primary-700 via-primary-600 to-primary-500 text-store-primary-foreground",
        isMarket
          ? "min-h-[7rem] md:min-h-[9rem] lg:min-h-[10rem]"
          : "min-h-[11rem] md:min-h-[16rem] lg:min-h-[18rem]",
      )}
    >
      {backdrop}
      <div
        data-section-content={designed ? "" : undefined}
        className={cn(
          "max-w-2xl",
          isMarket ? "p-4 md:p-6 lg:p-8" : "p-5 md:p-10 lg:p-14",
        )}
      >
        <Heading
          id={headingId}
          className="text-xl font-black leading-tight sm:text-2xl lg:text-4xl"
        >
          <bdi>{title}</bdi>
        </Heading>
        {subheadline?.trim() && (
          <p className="mt-2 line-clamp-2 text-xs text-store-primary-foreground/80 md:mt-3 md:text-sm">
            {subheadline}
          </p>
        )}
        {!hasAuthoredCtas ? (
          <Link
            href={`${basePath}/products`}
            className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-store bg-store-primary-foreground px-4 text-xs font-bold text-store-primary shadow-md transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-store-primary-foreground md:mt-5 md:h-11 md:px-6 md:text-sm"
          >
            <span>{t("shopNow")}</span>
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              strokeWidth={2.5}
              className="size-3.5 stroke-current rtl:rotate-180 md:size-4"
            >
              <path
                d="M9 5l7 7-7 7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
        ) : authored.length === 0 ? null : (
          <div className="mt-4 flex flex-wrap items-center gap-2 md:mt-5 md:gap-3">
            {authored.map((cta, index) => {
              // CUST-HV V6c-5 — absent style ⇒ by position (first solid, second outline), exactly as before.
              const style = effectiveCtaStyle(cta.style, index);
              // CUST-HV V6c-6 — an explicit colour paints the button from validated custom properties.
              const paint =
                cta.colour && designCtx
                  ? ctaPaint(style, cta.colour, designCtx)
                  : null;
              return (
                <Link
                  key={`${index}-${cta.href}`}
                  href={cta.href}
                  data-hero-cta={index === 0 ? "primary" : "secondary"}
                  data-cta-style={style}
                  data-cta-colour={paint ? cta.colour : undefined}
                  style={
                    paint
                      ? ({
                          "--cta-fill": paint.fill,
                          "--cta-label": paint.label,
                          "--cta-border": paint.border,
                        } as CSSProperties)
                      : undefined
                  }
                  className={cn(
                    "inline-flex h-9 items-center gap-1.5 rounded-store px-4 text-xs font-bold transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-store-primary-foreground md:h-11 md:px-6 md:text-sm",
                    paint
                      ? [COLOURED_CTA, style === "link" && COLOURED_LINK]
                      : HERO_CTA_LOOK[style],
                  )}
                >
                  <span>{cta.label}</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
