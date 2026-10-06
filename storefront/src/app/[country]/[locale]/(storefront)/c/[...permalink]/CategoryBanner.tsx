import type { Category } from "@spree/sdk";
import { cacheLife, cacheTag } from "next/cache";
import Link from "next/link";
import type { ReactNode } from "react";
import { StoreContainer } from "@/components/layout/StoreContainer";
import { Breadcrumbs } from "@/components/navigation/Breadcrumbs";
import type { PagePresentation } from "@/lib/presentation/page-regions";
import { resolvePublicCategoryRegions } from "@/lib/presentation/page-runtime";

interface CategoryBannerProps {
  category: Category;
  basePath: string;
  locale: string;
  /**
   * CUST-H2-5 — the Published Version's `pagePresentation.category`, or
   * `undefined` when nothing has been published/customized yet. Only the
   * four regions this component owns
   * (`breadcrumbs`/`identity_title`/`description`/`subcategories_rail`) are
   * read here — `filter_sort_bar`/`product_grid` live in `ProductListing`, a
   * separate component the category page route renders as this banner's
   * sibling, and are both FIXED_REQUIRED with no reorder possible relative
   * to each other (see the category page route for why nothing about them
   * needs wiring at all).
   */
  pagePresentation?: PagePresentation;
}

const BANNER_REGION_KEYS = [
  "breadcrumbs",
  "identity_title",
  "description",
  "subcategories_rail",
] as const;

/**
 * The category header.
 *
 * It used to reserve a 350px cover band keyed on `category.image_url` for
 * every category. Back then the category resource exposed no image, so the band
 * was an empty grey rectangle above every category on the store — a third of
 * the first viewport spent saying nothing — and it was removed rather than
 * filled with an invented photograph.
 *
 * The category resource carries the merchant's image now (since #1110; the
 * Home categories section already renders it), but this header deliberately
 * still renders none: a cover must appear only when the category actually has
 * an image, never as a reserved band or a placeholder. That optional `cover`
 * region is CUST-HV V9 (DEF-3b). Until then the header is breadcrumbs, the
 * name, the merchant's own description when there is one, and the real
 * subcategories.
 */
export async function CategoryBanner({
  category,
  basePath,
  locale,
  pagePresentation,
}: CategoryBannerProps) {
  "use cache: remote";
  cacheLife("minutes");
  cacheTag("category-banner");

  const children = category.children ?? [];

  const regionOrder = resolvePublicCategoryRegions(pagePresentation).filter(
    (key): key is (typeof BANNER_REGION_KEYS)[number] =>
      (BANNER_REGION_KEYS as readonly string[]).includes(key),
  );

  /*
   * CUST-H2-5 — one named node per region this component owns. Every node
   * below is byte-identical to what this file always rendered; only the
   * assembly moved from a fixed JSX sequence to `regionOrder.map(...)`.
   * `identity_title`/`description` are split into two independent nodes
   * (they were one combined block before) because the locked contract treats
   * them as two separate regions — FIXED_REQUIRED title vs. OPTIONAL_TOGGLE
   * description — exactly like the Customizer's own `CategoryPagePreview`
   * already does.
   */
  const regionNodes: Record<(typeof BANNER_REGION_KEYS)[number], ReactNode> = {
    breadcrumbs: (
      <Breadcrumbs category={category} basePath={basePath} locale={locale} />
    ),
    identity_title: (
      <div className="mt-2 flex items-start gap-2">
        <span
          aria-hidden="true"
          className="mt-1 h-4 w-1.5 shrink-0 rounded-full bg-store-primary md:mt-1.5 md:h-5"
        />
        <h1 className="min-w-0 text-base font-extrabold leading-tight text-store-foreground md:text-lg">
          {category.name}
        </h1>
      </div>
    ),
    description: category.description ? (
      // `ps-3.5` (0.375rem accent-bar width + 0.5rem gap, the exact offset
      // `identity_title`'s own flex row uses) keeps the description aligned
      // under the title now that the two are independent regions, matching
      // this file's original combined-block layout exactly when both render
      // in their default adjacent order.
      <p className="mt-0.5 ps-3.5 text-xs text-store-muted-foreground md:text-sm">
        {category.description}
      </p>
    ) : null,
    subcategories_rail:
      children.length > 0 ? (
        <nav aria-label={category.name} className="mt-3">
          <ul className="store-rail flex gap-1.5 overflow-x-auto pb-1">
            {children.map((child) => (
              <li key={child.id} className="shrink-0">
                <Link
                  href={`${basePath}/c/${child.permalink}`}
                  className="block rounded-store border border-store-border bg-store-surface px-3 py-1.5 text-xs font-medium text-store-foreground transition-colors hover:border-store-border-strong hover:text-store-primary"
                >
                  {child.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null,
  };

  return (
    <StoreContainer className="pt-4">
      {regionOrder
        .filter((key) => regionNodes[key] !== null)
        .map((key) => (
          <div data-region={key} key={key}>
            {regionNodes[key]}
          </div>
        ))}
    </StoreContainer>
  );
}
