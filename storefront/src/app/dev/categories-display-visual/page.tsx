import { notFound } from "next/navigation";
import { CategoriesDisplayBlock } from "@/components/home/CategoriesSection";
import { SectionHeading } from "@/components/home/SectionHeading";
import { StoreContainer } from "@/components/layout/StoreContainer";
import type { StoreCategory } from "@/lib/commerce/types";
import {
  type CategoryDisplay,
  normalizeDisplay,
} from "@/lib/presentation/section-design";
import { fixtureCategories } from "./fixtures";

/**
 * AWJ-STORE-CAT-DESIGN-01 — development-only visual fixture for the categories section's card displays. Mounts the
 * storefront's real `CategoriesDisplayBlock` (shared `CategoryDisplayList`, `next/link`, `next/image`, the scroll rail
 * and the shared stylesheet) against hand-built categories — no backend required. Not linked from the storefront and
 * 404 in production. Pictures are local SVG data URIs.
 *
 * `?display=<url-encoded JSON of design.display>` (normalized exactly like a saved document) · `&locale=ar|en` ·
 * `&count=0..8` · `&noimage=5,6` (indexes drawn without a picture) · `&dark=1` is intentionally absent: the storefront
 * has no dark mode (D-13).
 */

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export default async function CategoriesDisplayVisualPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  if (process.env.NODE_ENV === "production") notFound();

  const params = await searchParams;
  const locale = first(params.locale) === "en" ? "en" : "ar";
  const dir = locale === "ar" ? "rtl" : "ltr";
  const count = Math.max(0, Math.min(8, Number(first(params.count) ?? 8) || 0));
  const noImage = (first(params.noimage) ?? "5,6")
    .split(",")
    .map((n) => Number.parseInt(n, 10))
    .filter((n) => Number.isInteger(n));

  let display: CategoryDisplay | undefined;
  const raw = first(params.display);
  if (raw) {
    try {
      display = normalizeDisplay(JSON.parse(raw));
    } catch {
      display = undefined;
    }
  }

  const categories = fixtureCategories(
    locale,
    count,
    noImage,
  ) as unknown as StoreCategory[];

  return (
    <div dir={dir} lang={locale} data-visual-root="">
      <StoreContainer>
        <section aria-labelledby="home-categories" className="py-6">
          <SectionHeading
            id="home-categories"
            title={locale === "ar" ? "تسوّق حسب القسم" : "Shop by category"}
            action={null}
          />
          <div className="mt-3" data-visual-list="">
            {display ? (
              <CategoriesDisplayBlock
                display={display}
                categories={categories}
                basePath={`/sa/${locale}`}
                dir={dir}
              />
            ) : (
              <p data-classic="">classic</p>
            )}
          </div>
        </section>
      </StoreContainer>
    </div>
  );
}
