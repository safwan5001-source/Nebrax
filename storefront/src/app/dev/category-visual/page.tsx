import type { Category, ProductFiltersResponse } from "@spree/sdk";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { StoreContainer } from "@/components/layout/StoreContainer";
import { ProductListing } from "@/components/products/ProductListing";
import type { PagePresentation } from "@/lib/presentation/page-regions";
import ar from "../../../../messages/ar.json";
import en from "../../../../messages/en.json";
import { CategoryBanner } from "../../[country]/[locale]/(storefront)/c/[...permalink]/CategoryBanner";
import { DevStorefrontProviders } from "../_fixtures/providers";
import { DirectionLock } from "./direction";
import { fetchFixtureProducts } from "./fetch-products";

/**
 * CUST-H2-5 — development-only fixture for public Category page presentation
 * parity. Mounts the real, unmodified `CategoryBanner` and `ProductListing`
 * components (the exact pair `c/[...permalink]/page.tsx` renders) with
 * fixture Category/Product data and an optional `pagePresentation.category`
 * override, so region order/visibility can be verified with a real browser
 * without a live backend. Fixture/mocked-backend evidence, explicitly not
 * the authenticated Customizer → Publish → public-route path — see the
 * CUST-H2-5 implementation report's "Playwright / Real Browser QA" section.
 * Production requests 404, matching every other `/dev/*` fixture.
 */

type Scenario =
  | "default"
  | "hidden-description"
  | "hidden-subcategories"
  | "reordered"
  | "many-children"
  | "empty";

function scenarioOf(value: string | undefined): Scenario {
  if (
    value === "hidden-description" ||
    value === "hidden-subcategories" ||
    value === "reordered" ||
    value === "many-children" ||
    value === "empty"
  ) {
    return value;
  }
  return "default";
}

function fixtureCategory(locale: "ar" | "en", scenario: Scenario): Category {
  const copy =
    locale === "ar"
      ? { name: "إلكترونيات", description: "كل ما يخص الأجهزة الإلكترونية." }
      : { name: "Electronics", description: "Everything electronic." };

  const childNames =
    locale === "ar"
      ? [
          "هواتف",
          "حواسيب",
          "سماعات",
          "شواحن",
          "كاميرات",
          "ساعات",
          "ألعاب",
          "شاشات",
          "طابعات",
        ]
      : [
          "Phones",
          "Laptops",
          "Headphones",
          "Chargers",
          "Cameras",
          "Watches",
          "Gaming",
          "Monitors",
          "Printers",
        ];

  const childCount =
    scenario === "many-children"
      ? childNames.length
      : scenario === "empty"
        ? 0
        : 2;
  const children = childNames.slice(0, childCount).map((name, index) => ({
    id: `child-${index}`,
    name,
    permalink: `child-${index}`,
  }));

  return {
    id: "category-fixture-1",
    name: copy.name,
    permalink: "electronics",
    description: scenario === "empty" ? null : copy.description,
    color: null,
    image: null,
    children,
    ancestors: [],
  } as unknown as Category;
}

async function fetchFixtureFilters(): Promise<ProductFiltersResponse> {
  return {
    filters: [],
    sort_options: [],
    default_sort: "name",
    total_count: 0,
  };
}

function pagePresentationFor(scenario: Scenario): PagePresentation | undefined {
  if (scenario === "hidden-description") {
    return {
      category: {
        version: 1,
        regions: [
          { id: "breadcrumbs", key: "breadcrumbs", visible: true },
          { id: "identity_title", key: "identity_title", visible: true },
          { id: "description", key: "description", visible: false },
          {
            id: "subcategories_rail",
            key: "subcategories_rail",
            visible: true,
          },
          { id: "filter_sort_bar", key: "filter_sort_bar", visible: true },
          { id: "product_grid", key: "product_grid", visible: true },
        ],
      },
    };
  }
  if (scenario === "hidden-subcategories") {
    return {
      category: {
        version: 1,
        regions: [
          { id: "breadcrumbs", key: "breadcrumbs", visible: true },
          { id: "identity_title", key: "identity_title", visible: true },
          { id: "description", key: "description", visible: true },
          {
            id: "subcategories_rail",
            key: "subcategories_rail",
            visible: false,
          },
          { id: "filter_sort_bar", key: "filter_sort_bar", visible: true },
          { id: "product_grid", key: "product_grid", visible: true },
        ],
      },
    };
  }
  if (scenario === "reordered") {
    return {
      category: {
        version: 1,
        regions: [
          { id: "breadcrumbs", key: "breadcrumbs", visible: true },
          { id: "identity_title", key: "identity_title", visible: true },
          {
            id: "subcategories_rail",
            key: "subcategories_rail",
            visible: true,
          },
          { id: "description", key: "description", visible: true },
          { id: "filter_sort_bar", key: "filter_sort_bar", visible: true },
          { id: "product_grid", key: "product_grid", visible: true },
        ],
      },
    };
  }
  return undefined;
}

export default async function CategoryVisualPage({
  searchParams,
}: {
  searchParams: Promise<{ locale?: string; scenario?: string }>;
}) {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const params = await searchParams;
  const locale = params.locale === "en" ? "en" : "ar";
  const scenario = scenarioOf(params.scenario);
  setRequestLocale(locale);
  const messages = locale === "ar" ? ar : en;
  const basePath = `/sa/${locale}`;

  const category = fixtureCategory(locale, scenario);
  const pagePresentation = pagePresentationFor(scenario);
  const productCount = scenario === "empty" ? 0 : 4;
  const fetchProducts = fetchFixtureProducts.bind(null, locale, productCount);

  return (
    <NextIntlClientProvider messages={messages} locale={locale}>
      <DirectionLock locale={locale} />
      <DevStorefrontProviders locale={locale}>
        <div>
          <CategoryBanner
            category={category}
            basePath={basePath}
            locale={locale}
            pagePresentation={pagePresentation}
          />
          <StoreContainer className="py-5 md:py-6">
            <ProductListing
              state={{ filters: { optionValues: [] }, query: undefined }}
              basePath={basePath}
              currency="SAR"
              locale={locale}
              listId={`category-${category.id}`}
              listName={`Category: ${category.name}`}
              categoryId={category.id}
              fetchProducts={fetchProducts}
              fetchFilters={fetchFixtureFilters}
            />
          </StoreContainer>
        </div>
      </DevStorefrontProviders>
    </NextIntlClientProvider>
  );
}
