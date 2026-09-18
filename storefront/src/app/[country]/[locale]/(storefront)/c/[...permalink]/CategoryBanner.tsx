import type { Category } from "@spree/sdk";
import { cacheLife, cacheTag } from "next/cache";
import Link from "next/link";
import { StoreContainer } from "@/components/layout/StoreContainer";
import { Breadcrumbs } from "@/components/navigation/Breadcrumbs";

interface CategoryBannerProps {
  category: Category;
  basePath: string;
  locale: string;
}

/**
 * The category header.
 *
 * It used to reserve a 350px cover band keyed on `category.image_url`. AWJ's
 * category resource exposes no image at all, so that band was an empty grey
 * rectangle above every category on the store — a third of the first viewport
 * spent saying nothing. There is no photograph to put there and inventing one
 * is exactly what the storefront must not do, so the band is gone rather than
 * filled: breadcrumbs, the name, the merchant's own description when there is
 * one, and the real subcategories.
 */
export async function CategoryBanner({
  category,
  basePath,
  locale,
}: CategoryBannerProps) {
  "use cache: remote";
  cacheLife("minutes");
  cacheTag("category-banner");

  const children = category.children ?? [];

  return (
    <StoreContainer className="pt-4">
      <Breadcrumbs category={category} basePath={basePath} locale={locale} />

      <div className="mt-2 flex items-start gap-2">
        <span
          aria-hidden="true"
          className="mt-1 h-4 w-1.5 shrink-0 rounded-full bg-store-primary md:mt-1.5 md:h-5"
        />
        <div className="min-w-0">
          <h1 className="text-base font-extrabold leading-tight text-store-foreground md:text-lg">
            {category.name}
          </h1>
          {category.description && (
            <p className="mt-0.5 text-xs text-store-muted-foreground md:text-sm">
              {category.description}
            </p>
          )}
        </div>
      </div>

      {children.length > 0 && (
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
      )}
    </StoreContainer>
  );
}
