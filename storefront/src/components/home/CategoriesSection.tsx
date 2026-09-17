import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { SectionHeading } from "@/components/home/SectionHeading";
import type { StoreCategory } from "@/lib/commerce/types";
import { getCategories } from "@/lib/data/categories";
import { categoryAccent } from "@/lib/home/category-accent";
import { cn } from "@/lib/utils";

interface CategoriesSectionProps {
  basePath: string;
  locale: string;
  country: string;
}

/**
 * How many categories the homepage shows before deferring to the catalogue.
 * A merchant with forty root categories would otherwise turn the homepage into
 * a sitemap; the rail and the drawer already carry the full set.
 */
const HOME_CATEGORY_LIMIT = 12;

function CategoryTile({
  category,
  basePath,
  subcategoriesLabel,
}: {
  category: StoreCategory;
  basePath: string;
  subcategoriesLabel: (count: number) => string;
}) {
  const accent = categoryAccent(category.color);
  const childCount = category.children?.length ?? 0;

  return (
    <li>
      <Link
        href={`${basePath}/c/${category.permalink}`}
        className="group flex h-full flex-col gap-2.5 rounded-store border border-store-border p-3 transition-colors hover:border-store-border-strong"
        style={{ backgroundColor: accent.background }}
      >
        {/*
          The mark is the category's own initial in its own colour. It is not a
          logo and not a stand-in for a photograph AWJ does not have — it gives
          the tile a fixed anchor so a grid of them reads as a system rather
          than as a list of empty boxes.
        */}
        <span
          aria-hidden="true"
          className="grid size-10 shrink-0 place-items-center rounded-[calc(var(--store-radius)-0.25rem)] bg-store-surface/70 text-lg font-black shadow-2xs"
          style={{ color: accent.foreground }}
        >
          {category.name.trim().slice(0, 1)}
        </span>
        <span className="min-w-0">
          <span className="block line-clamp-2 text-xs font-bold leading-snug text-store-foreground group-hover:text-store-primary sm:text-sm">
            {category.name}
          </span>
          {childCount > 0 && (
            <span className="mt-0.5 block text-[0.625rem] text-store-muted-foreground tabular-nums">
              {subcategoriesLabel(childCount)}
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}

/**
 * Homepage category browsing.
 *
 * Every tile is an authoritative root category rendered straight from
 * `store/v1/categories` — no second taxonomy, no curated list, and no invented
 * imagery. The only visual variable is the merchant's own `color`, and where
 * that is unset the tile falls back to the neutral surface rather than to a
 * generated picture.
 */
export async function CategoriesSection({
  basePath,
  locale,
  country,
}: CategoriesSectionProps) {
  const t = await getTranslations({
    locale: locale as Locale,
    namespace: "home",
  });

  const categories = await getCategories({ depth_eq: 0 }, { country, locale })
    .then((res) => res.data ?? [])
    .catch((error) => {
      console.error("CategoriesSection: failed to load categories", error);
      return [];
    });

  // Nothing to browse yet: the homepage drops the section rather than showing
  // an empty shelf that implies a catalogue which has not been built.
  if (categories.length === 0) return null;

  const shown = categories.slice(0, HOME_CATEGORY_LIMIT);
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
          "mt-3 grid gap-3",
          // A short list keeps its tiles at a sane width instead of stretching
          // two of them across the whole measure.
          shown.length <= 2
            ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"
            : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6",
        )}
      >
        {shown.map((category) => (
          <CategoryTile
            key={category.id}
            category={category}
            basePath={basePath}
            subcategoriesLabel={(count) => t("subcategories", { count })}
          />
        ))}
      </ul>
    </section>
  );
}
