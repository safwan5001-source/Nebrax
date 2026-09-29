import Image from "next/image";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { SectionHeading } from "@/components/home/SectionHeading";
import type { StoreCategory } from "@/lib/commerce/types";
import { getCategories } from "@/lib/data/categories";
import { categoryAccent } from "@/lib/home/category-accent";
import type { ThemePresetId } from "@/lib/presentation/tokens";
import { cn } from "@/lib/utils";

interface CategoriesSectionProps {
  basePath: string;
  locale: string;
  country: string;
  /**
   * Passed explicitly rather than read from `usePublishedThemeMarker()`
   * because this is a server component — the marker context is a client-only
   * seam. `page.tsx` already has the published `themePreset` in scope from
   * the same `fetchStorefrontConfig()` call it uses for everything else here.
   */
  themePreset?: ThemePresetId;
}

/**
 * How many categories the homepage shows before deferring to the catalogue.
 * A merchant with forty root categories would otherwise turn the homepage into
 * a sitemap; the rail and the drawer already carry the full set.
 *
 * AWJ Market's benchmark (dense grocery/FMCG category discovery — see the
 * Full Theme Completion coverage matrix) shows considerably more tiles above
 * the fold than a general storefront; Market raises the ceiling rather than
 * changing what a tile is or where the categories come from.
 */
const HOME_CATEGORY_LIMIT = 12;
const HOME_CATEGORY_LIMIT_MARKET = 18;

/** Exported only for the `/dev/market-visual` fixture, which renders the
 * exact tile markup against hand-built categories rather than duplicating
 * it — `CategoriesSection` itself always fetches from `getCategories()`,
 * which that backend-free fixture cannot call. */
export function CategoryTile({
  category,
  basePath,
  compact = false,
  subcategoriesLabel,
}: {
  category: StoreCategory;
  basePath: string;
  compact?: boolean;
  subcategoriesLabel: (count: number) => string;
}) {
  const accent = categoryAccent(category.color);
  const childCount = category.children?.length ?? 0;
  const image = category.image?.url ? category.image : null;

  return (
    <li>
      <Link
        href={`${basePath}/c/${category.permalink}`}
        className={cn(
          "group flex h-full flex-col gap-2 rounded-store border border-store-border border-s-[3px] bg-store-surface transition-colors hover:border-store-border-strong hover:bg-store-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-store-primary",
          compact ? "px-3 py-2.5" : "px-4 py-3.5",
        )}
        style={{ borderInlineStartColor: accent.rule }}
      >
        {image ? (
          <Image
            src={image.url}
            alt={image.alt || category.name}
            className={cn(
              "w-full rounded-store object-cover",
              compact ? "h-14" : "h-20",
            )}
            width={320}
            height={160}
            unoptimized
          />
        ) : category.color && accent.isMerchantColor ? (
          <span
            aria-hidden="true"
            className={cn(
              "w-full rounded-store",
              compact ? "h-7" : "h-10",
            )}
            style={{ backgroundColor: accent.rule }}
          />
        ) : null}
        <span
          className={cn(
            "font-bold leading-snug text-store-foreground group-hover:text-store-primary",
            compact ? "line-clamp-2 text-xs" : "line-clamp-2 text-sm",
          )}
        >
          {category.name}
        </span>
        {childCount > 0 && !compact && (
          <span className="text-xs text-store-muted-foreground tabular-nums">
            {subcategoriesLabel(childCount)}
          </span>
        )}
      </Link>
    </li>
  );
}

/**
 * Homepage category browsing.
 *
 * Every tile is an authoritative root category rendered straight from
 * `store/v1/categories` — no second taxonomy, no curated list, and no invented
 * imagery. The merchant's category image is authoritative when present; a
 * validated merchant color is the visual fallback, then the neutral surface.
 */
export async function CategoriesSection({
  basePath,
  locale,
  country,
  themePreset,
}: CategoriesSectionProps) {
  const t = await getTranslations({
    locale: locale as Locale,
    namespace: "home",
  });
  const isMarket = themePreset === "awj-market";

  const categories = await getCategories({ depth_eq: 0 }, { country, locale })
    .then((res) => res.data ?? [])
    .catch((error) => {
      console.error("CategoriesSection: failed to load categories", error);
      return [];
    });

  // Nothing to browse yet: the homepage drops the section rather than showing
  // an empty shelf that implies a catalogue which has not been built.
  if (categories.length === 0) return null;

  const limit = isMarket ? HOME_CATEGORY_LIMIT_MARKET : HOME_CATEGORY_LIMIT;
  const shown = categories.slice(0, limit);
  const hasMore = categories.length > shown.length;

  return (
    <section aria-labelledby="home-categories">
      <SectionHeading
        id="home-categories"
        title={t("browseCategories")}
        action={
          hasMore ? { href: `${basePath}/products`, label: t("viewAll") } : null
        }
      />
      <ul
        className={cn(
          "mt-3 grid",
          isMarket ? "gap-2" : "gap-3",
          // A short list keeps its tiles at a sane width instead of stretching
          // two of them across the whole measure.
          shown.length <= 2
            ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"
            : isMarket
              ? "grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8"
              : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6",
        )}
      >
        {shown.map((category) => (
          <CategoryTile
            key={category.id}
            category={category}
            basePath={basePath}
            compact={isMarket}
            subcategoriesLabel={(count) => t("subcategories", { count })}
          />
        ))}
      </ul>
    </section>
  );
}
