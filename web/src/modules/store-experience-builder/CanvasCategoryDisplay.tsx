import type { CSSProperties } from "react";
import {
  CategoryDisplayList,
  type CategoryDisplayImgProps,
  type CategoryDisplayLinkProps,
} from "./CategoryDisplayList";
import { imageSizes, resolveCategoryDisplay } from "./presentation/categories-display";
import type { CategoryDisplay, DisplayDevice } from "./presentation/section-design";

/** A real root category as the Canvas reads it from the workspace categories endpoint. */
export interface CanvasCategory {
  id: string;
  name: string;
  /** A short-lived signed workspace URL of the merchant's category picture; `null`/absent ⇒ the fallback frame. */
  imageUrl?: string | null;
  color?: string | null;
}

/** The Canvas never navigates: the tile is the storefront's own markup with the link swapped for a static element. */
function CanvasTile({ href: _href, children, ...rest }: CategoryDisplayLinkProps) {
  return <div {...rest}>{children}</div>;
}

function CanvasImg({ src, className, sizes }: CategoryDisplayImgProps) {
  // The preview draws the picture exactly as the storefront does, minus `next/image`; the URL is a signed same-origin-API URL.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" className={className} sizes={sizes} loading="lazy" decoding="async" />;
}

/**
 * AWJ-STORE-CAT-DESIGN-01 — the Canvas's categories section when the merchant has chosen a display: the SAME resolver and
 * the SAME `CategoryDisplayList` view (and stylesheet) the published storefront uses, pinned to the simulated device so
 * the responsive values read the preview width rather than the host window.
 */
export function CanvasCategoryDisplay({
  display,
  categories,
  viewport,
  dir,
}: {
  display: CategoryDisplay;
  categories: readonly CanvasCategory[];
  viewport: DisplayDevice;
  dir: "ltr" | "rtl";
}) {
  const resolved = resolveCategoryDisplay(display, dir);
  return (
    <div className="mt-4" style={{ minWidth: 0 } as CSSProperties} data-canvas-category-display={display.layout}>
      <CategoryDisplayList
        display={resolved}
        sizes={imageSizes(resolved)}
        device={viewport}
        Link={CanvasTile}
        Img={CanvasImg}
        items={categories.map((category) => ({
          id: category.id,
          name: category.name,
          href: "#",
          image: category.imageUrl ? { src: category.imageUrl } : null,
          color: category.color ?? null,
        }))}
      />
    </div>
  );
}
