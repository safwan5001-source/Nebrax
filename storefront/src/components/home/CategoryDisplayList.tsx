import type { CSSProperties, ElementType, ReactNode } from "react";
import {
  categoryInitial,
  categorySwatch,
  type ResolvedCategoryDisplay,
} from "@/lib/presentation/categories-display";
import type { DisplayDevice } from "@/lib/presentation/section-design";
import "./categories-display.css";

/** One category as the view draws it — already shaped by the caller (storefront: `getCategories`; Canvas: workspace read). */
export interface CategoryDisplayItem {
  id: string;
  name: string;
  href: string;
  /** The merchant's category picture; `null` ⇒ the fallback frame. The view never invents one. */
  image: { src: string } | null;
  /** The merchant's category colour (free text in the catalogue; validated before it reaches a style). */
  color: string | null;
}

export interface CategoryDisplayLinkProps {
  href: string;
  className: string;
  "aria-label"?: string;
  title?: string;
  "data-cd-align": string;
  "data-cd-placement": string;
  children: ReactNode;
}

export interface CategoryDisplayImgProps {
  src: string;
  className: string;
  sizes: string;
}

function DefaultLink({ href, children, ...rest }: CategoryDisplayLinkProps) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}

/**
 * AWJ-STORE-CAT-DESIGN-01 — the categories section's five display layouts, drawn from a resolved display model.
 *
 * One component for the published storefront and the builder's Canvas (byte-identical twins, test-enforced from this
 * signature down): the storefront passes `next/link` and `next/image`, the Canvas passes a non-navigating tile; markup,
 * classes and the shared stylesheet are the same, so the preview is the storefront's own output.
 *
 * Accessibility contract: every tile is ONE link. The visible name is its accessible name; when the name is hidden the
 * link carries the same name as `aria-label` (and `title`), so assistive technology never loses it. Pictures are
 * decorative (`alt=""`) because the name is always present; the fallback frame is `aria-hidden`.
 */
export function CategoryDisplayList({
  display,
  items,
  sizes,
  device,
  List = "ul",
  Link = DefaultLink,
  Img,
}: {
  display: ResolvedCategoryDisplay;
  items: readonly CategoryDisplayItem[];
  sizes: string;
  /** Canvas only: pins the responsive values of one simulated device (media queries would read the host window). */
  device?: DisplayDevice;
  List?: ElementType;
  Link?: ElementType<CategoryDisplayLinkProps>;
  /** The renderer's image element: the storefront passes `next/image` (fill), the Canvas a plain `<img>`. */
  Img: ElementType<CategoryDisplayImgProps>;
}) {
  const { image, name, card } = display;
  // Without a picture frame there is nothing to overlay on, sit beside or stack above: only the name remains.
  const placement = image.show ? name.placement : "below";
  const overlay = placement === "overlay";
  const initialInFrame =
    display.layout === "circles" || display.layout === "compact_list";

  return (
    <List
      className="awj-cd"
      style={display.vars as CSSProperties}
      data-cd-layout={display.layout}
      data-cd-hover={card.hover ? "subtle" : undefined}
      data-cd-device={device}
    >
      {items.map((item) => {
        // The padded, backed element is the outer span; the line clamp lives on an inner span. `line-clamp` on an element
        // that also has vertical padding lets the hidden lines show through the padding (found at 390px, image tiles).
        const nameEl = name.show ? (
          <span
            className="awj-cd__name"
            data-cd-nbg={
              name.background === "none" ? undefined : name.background
            }
            data-cd-over={overlay ? "" : undefined}
          >
            <span
              className="awj-cd__name-text"
              data-cd-clamp={name.lines ?? undefined}
            >
              {item.name}
            </span>
          </span>
        ) : null;

        const swatch = categorySwatch(item.color);
        const mediaEl = image.show ? (
          <span className="awj-cd__media" data-cd-shape={image.shape}>
            {item.image ? (
              <Img src={item.image.src} className="awj-cd__img" sizes={sizes} />
            ) : (
              <span
                aria-hidden="true"
                className="awj-cd__fallback"
                style={
                  swatch
                    ? {
                        backgroundColor: swatch.background,
                        color: swatch.foreground,
                      }
                    : undefined
                }
              >
                {initialInFrame ? categoryInitial(item.name) : null}
              </span>
            )}
            {overlay ? nameEl : null}
          </span>
        ) : null;

        return (
          <li key={item.id} className="awj-cd__item">
            <Link
              href={item.href}
              className="awj-cd__card"
              aria-label={name.show ? undefined : item.name}
              title={name.show ? undefined : item.name}
              data-cd-align={name.align}
              data-cd-placement={placement}
            >
              {placement === "above" ? nameEl : null}
              {mediaEl}
              {placement === "below" || placement === "beside" ? nameEl : null}
            </Link>
          </li>
        );
      })}
    </List>
  );
}
