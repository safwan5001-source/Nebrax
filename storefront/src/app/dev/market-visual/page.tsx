import type { Product } from "@spree/sdk";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { CartLine, type CartLineView } from "@/components/cart/CartLine";
import { CategoryTile } from "@/components/home/CategoriesSection";
import { PublishedCardStyleProvider } from "@/components/layout/PublishedCardStyle";
import { PublishedThemeMarkerProvider } from "@/components/layout/PublishedThemeMarker";
import { StoreContainer } from "@/components/layout/StoreContainer";
import { ProductGrid } from "@/components/products/ProductGrid";
import type { StoreCategory } from "@/lib/commerce/types";
import { publishedHomeStackClass } from "@/lib/presentation/public-rhythm";
import type { ThemePresetId } from "@/lib/presentation/tokens";
import ar from "../../../../messages/ar.json";
import en from "../../../../messages/en.json";
import { MarketVisualFrame } from "./frame";

/**
 * Development-only visual fixture for the AWJ Market theme marker and its
 * compact starting bundle (density/productCard). Mounts the real shared
 * `ProductGrid`/`ProductCard`/`CategoryTile`/`CartLine` used by the public
 * storefront with fixture data — no backend required. Not linked from the
 * storefront, not found in production. `?preset=awj-market|awj-modern&locale=ar|en`.
 *
 * Covers the AWJ Market Full Theme Completion surfaces that have no other
 * backend-free way to verify real component output: the homepage category
 * grid's Market density and a cart line's Market row spacing. The PDP mobile
 * purchase bar is verified by `ProductDetails.test.tsx` instead — mounting
 * the real `ProductDetails` here would additionally require faking
 * `CartContext`/`StoreContext`/`HiddenPricingContext`/`MediaGallery`, which
 * risks the fixture drifting from what those contexts actually do; the
 * sticky-bar change here is a pure CSS repositioning of the existing,
 * already-tested purchase controls, not new layout structure like the grids
 * below.
 */

function fixtureCategories(locale: "ar" | "en") {
  const names: Array<[string, string]> = [
    ["ألبان وبيض", "Dairy & Eggs"],
    ["خضار وفواكه", "Produce"],
    ["مخبوزات", "Bakery"],
    ["مشروبات", "Beverages"],
    ["منظفات", "Cleaning"],
    ["عناية شخصية", "Personal Care"],
  ];
  return names.map(
    ([ar_, en_], i) =>
      ({
        id: `cat-${i}`,
        name: locale === "ar" ? ar_ : en_,
        permalink: `cat-${i}`,
        color: i === 0 ? "#0f766e" : null,
        children: undefined,
      }) as unknown as StoreCategory,
  );
}

/**
 * Built directly as a `CartLineView` (the display-ready shape `CartLine`
 * renders) rather than via `awjCartLineView()`: that adapter is exported from
 * a `"use client"` module, and Next.js forbids calling a Client Component
 * module's plain functions from server code, even a pure one with no hooks —
 * only rendering it as JSX is allowed across that boundary.
 */
function fixtureCartLine(locale: "ar" | "en", basePath: string): CartLineView {
  return {
    id: "line-fixture",
    name:
      locale === "ar" ? "حليب طازج كامل الدسم ١ لتر" : "Fresh Whole Milk 1L",
    href: `${basePath}/products/p-fixture`,
    imageUrl: null,
    meta: [locale === "ar" ? "قطعة" : "unit"],
    quantity: 2,
    available: true,
    unitPriceLabel: locale === "ar" ? "١٢٫٥٠ ر.س" : "SAR 12.50",
    lineTotalLabel: locale === "ar" ? "٢٥٫٠٠ ر.س" : "SAR 25.00",
  };
}

const LONG_AR =
  "عبوة أرز بسمتي فاخر طويل الحبة درجة أولى مستورد ومعبأ محلياً بوزن خمسة كيلوجرام";
const LONG_EN =
  "Premium Extra-Long Basmati Rice Grade-A Imported and Locally Packed 5kg Bag";

function fixtureProducts(locale: "ar" | "en"): Product[] {
  const base = {
    price: {
      display_amount: locale === "ar" ? "١٢٫٥٠ ر.س" : "SAR 12.50",
      amount_in_cents: 1250,
      compare_at_amount_in_cents: null,
      display_compare_at_amount: null,
    },
    original_price: { display_amount: null, amount_in_cents: null },
  };

  return [
    {
      ...base,
      id: "p-simple",
      name:
        locale === "ar" ? "حليب طازج كامل الدسم ١ لتر" : "Fresh Whole Milk 1L",
      slug: "fresh-milk",
      purchasable: true,
      thumbnail_url: null,
      categories: [{ id: "c1", name: locale === "ar" ? "ألبان" : "Dairy" }],
    },
    {
      ...base,
      id: "p-long-name",
      name: locale === "ar" ? LONG_AR : LONG_EN,
      slug: "long-name-rice",
      purchasable: true,
      thumbnail_url: null,
      categories: [{ id: "c2", name: locale === "ar" ? "بقالة" : "Grocery" }],
    },
    {
      ...base,
      id: "p-no-image",
      name: locale === "ar" ? "زيت زيتون بكر ممتاز" : "Extra Virgin Olive Oil",
      slug: "olive-oil",
      purchasable: true,
      thumbnail_url: null,
      categories: [],
    },
    {
      ...base,
      id: "p-out-of-stock",
      name: locale === "ar" ? "عصير برتقال طبيعي" : "Fresh Orange Juice",
      slug: "orange-juice",
      purchasable: false,
      thumbnail_url: null,
      categories: [
        { id: "c3", name: locale === "ar" ? "مشروبات" : "Beverages" },
      ],
    },
    {
      id: "p-variant",
      name:
        locale === "ar"
          ? "جبن شرائح متعدد الأنواع"
          : "Sliced Cheese Assortment",
      slug: "sliced-cheese",
      purchasable: true,
      thumbnail_url: null,
      categories: [{ id: "c1", name: locale === "ar" ? "ألبان" : "Dairy" }],
      price: {
        display_amount: null,
        amount_in_cents: null,
        compare_at_amount_in_cents: null,
        display_compare_at_amount: null,
      },
      original_price: { display_amount: null, amount_in_cents: null },
      isVariantManaged: true,
    },
    {
      ...base,
      id: "p-sale",
      name: locale === "ar" ? "تفاح أحمر مستورد" : "Imported Red Apples",
      slug: "red-apples",
      purchasable: true,
      thumbnail_url: null,
      categories: [
        { id: "c4", name: locale === "ar" ? "خضار وفواكه" : "Produce" },
      ],
      price: {
        display_amount: locale === "ar" ? "٨٫٠٠ ر.س" : "SAR 8.00",
        amount_in_cents: 800,
        compare_at_amount_in_cents: 1200,
        display_compare_at_amount: locale === "ar" ? "١٢٫٠٠ ر.س" : "SAR 12.00",
      },
      original_price: {
        display_amount: locale === "ar" ? "١٢٫٠٠ ر.س" : "SAR 12.00",
        amount_in_cents: 1200,
      },
    },
  ] as unknown as Product[];
}

function presetOf(value: string | undefined): ThemePresetId {
  return value === "awj-market" ? "awj-market" : "awj-modern";
}

export default async function MarketVisualPage({
  searchParams,
}: {
  searchParams: Promise<{ locale?: string; preset?: string; empty?: string }>;
}) {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const params = await searchParams;
  const locale = params.locale === "en" ? "en" : "ar";
  const preset = presetOf(params.preset);
  const empty = params.empty === "1";
  setRequestLocale(locale);

  const density = preset === "awj-market" ? "compact" : "comfortable";
  const productCard = preset === "awj-market" ? "compact" : "standard";
  const products = empty ? [] : fixtureProducts(locale);
  const basePath = locale === "ar" ? "/sa/ar" : "/sa/en";
  const isMarket = preset === "awj-market";
  const categoryLabel = (count: number) =>
    locale === "ar" ? `${count} أقسام فرعية` : `${count} subcategories`;

  return (
    <div
      dir={locale === "ar" ? "rtl" : "ltr"}
      lang={locale}
      data-visual-root=""
      data-surface="market-visual"
      data-preset={preset}
    >
      <MarketVisualFrame locale={locale} messages={locale === "ar" ? ar : en}>
        <PublishedThemeMarkerProvider themePreset={preset}>
          <PublishedCardStyleProvider productCard={productCard}>
            <StoreContainer className={publishedHomeStackClass(density)}>
              <section data-testid="fixture-categories">
                <ul
                  className={`grid ${isMarket ? "gap-2" : "gap-3"} ${
                    isMarket
                      ? "grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8"
                      : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6"
                  }`}
                >
                  {fixtureCategories(locale).map((category) => (
                    <CategoryTile
                      key={category.id}
                      category={category}
                      basePath={basePath}
                      compact={isMarket}
                      subcategoriesLabel={categoryLabel}
                    />
                  ))}
                </ul>
              </section>

              <ProductGrid
                products={products}
                basePath={basePath}
                emptyMessage={
                  locale === "ar" ? "لا توجد منتجات" : "No products"
                }
              />

              <section
                data-testid="fixture-cart-line"
                className="max-w-md rounded-store border border-store-border"
              >
                <ul className="divide-y divide-store-border px-4">
                  <li>
                    <CartLine
                      view={fixtureCartLine(locale, basePath)}
                      density="page"
                    />
                  </li>
                </ul>
              </section>
            </StoreContainer>
          </PublishedCardStyleProvider>
        </PublishedThemeMarkerProvider>
      </MarketVisualFrame>
    </div>
  );
}
