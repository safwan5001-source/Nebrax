import type { Product } from "@spree/sdk";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import type { PagePresentation } from "@/lib/presentation/page-regions";
import ar from "../../../../messages/ar.json";
import en from "../../../../messages/en.json";
import { ProductDetails } from "../../[country]/[locale]/(storefront)/products/[slug]/ProductDetails";
import { DevStorefrontProviders } from "../_fixtures/providers";
import { DirectionLock } from "./direction";

/**
 * CUST-H2-5 — development-only fixture for public Product page presentation
 * parity. Mounts the real, unmodified `ProductDetails` component (the exact
 * same component `products/[slug]/page.tsx` renders) with fixture Product
 * data and an optional `pagePresentation.product` override, so region
 * order/visibility can be verified with a real browser without a live
 * backend (`AWJ_COMMERCE_API_URL` is not available in every environment this
 * repository runs in). This is fixture/mocked-backend evidence, explicitly
 * not the authenticated Customizer → Publish → public-route path — see the
 * CUST-H2-5 implementation report's "Playwright / Real Browser QA" section
 * for what this does and does not prove. Production requests 404, matching
 * every other `/dev/*` fixture in this package.
 */

type Scenario =
  | "default"
  | "variant"
  | "hidden-description"
  | "reordered"
  | "no-image"
  | "no-description"
  | "no-sku";

function scenarioOf(value: string | undefined): Scenario {
  if (
    value === "variant" ||
    value === "hidden-description" ||
    value === "reordered" ||
    value === "no-image" ||
    value === "no-description" ||
    value === "no-sku"
  ) {
    return value;
  }
  return "default";
}

function baseProduct(locale: "ar" | "en", scenario: Scenario): Product {
  const copy =
    locale === "ar"
      ? {
          name: "سماعة لاسلكية عازلة للضوضاء",
          description:
            "صوت نقي بعزل ضوضاء فعّال حتى ثماني ساعات على شحنة واحدة.",
          category: "إلكترونيات",
        }
      : {
          name: "Wireless Noise-Cancelling Headphones",
          description:
            "Crisp sound with effective noise cancellation, up to eight hours per charge.",
          category: "Electronics",
        };

  return {
    id: "product-fixture-1",
    name: copy.name,
    slug: "wireless-headphones",
    categories: [{ id: "cat-electronics", name: copy.category }],
    default_variant_id: "variant-master",
    default_variant: {
      id: "variant-master",
      product_id: "product-fixture-1",
      sku: scenario === "no-sku" ? "" : "AWJ-HP-001",
      options_text: "",
      purchasable: true,
      in_stock: true,
      price: {
        display_amount: "١٢٥ ر.س",
        amount_in_cents: 12500,
        compare_at_amount_in_cents: null,
        display_compare_at_amount: null,
      },
      original_price: null,
    },
    variants: [],
    option_types: [],
    // Real remote product images would need a `next.config` `remotePatterns`
    // entry this fixture must not add; every scenario here is therefore an
    // honest "no image" state, exercising `MediaGallery`'s own placeholder —
    // region order/visibility never depends on whether an image is present.
    media: [],
    purchasable: true,
    in_stock: true,
    price: {
      display_amount: "١٢٥ ر.س",
      amount_in_cents: 12500,
      compare_at_amount_in_cents: null,
      display_compare_at_amount: null,
    },
    original_price: null,
    description: scenario === "no-description" ? null : copy.description,
    description_html: null,
    custom_fields: [],
  } as unknown as Product;
}

function variantProduct(locale: "ar" | "en"): Product {
  const optionType = {
    id: "opt-color",
    name: locale === "ar" ? "اللون" : "Color",
    label: locale === "ar" ? "اللون" : "Color",
    position: 0,
    kind: "awj_generic",
  };
  const values =
    locale === "ar"
      ? [
          { name: "أسود", id: "val-black" },
          { name: "أبيض", id: "val-white" },
        ]
      : [
          { name: "Black", id: "val-black" },
          { name: "White", id: "val-white" },
        ];
  const optionValues = values.map((v, index) => ({
    id: v.id,
    option_type_id: "opt-color",
    name: v.name,
    label: v.name,
    position: index,
    color_code: null,
    option_type_name: optionType.name,
    option_type_label: optionType.label,
    image_url: null,
  }));

  const variants = optionValues.map((value, index) => ({
    id: `variant-${value.id}`,
    product_id: "product-fixture-2",
    sku: `AWJ-HP-00${index + 2}`,
    options_text: value.name,
    purchasable: true,
    in_stock: true,
    media: [],
    option_values: [value],
    price: {
      display_amount: "١٤٠ ر.س",
      amount_in_cents: 14000,
      compare_at_amount_in_cents: null,
      display_compare_at_amount: null,
    },
    original_price: null,
  }));

  return {
    id: "product-fixture-2",
    name:
      locale === "ar"
        ? "سماعة لاسلكية — بخيارات لونية"
        : "Wireless Headphones — Color Options",
    slug: "wireless-headphones-variants",
    categories: [],
    default_variant_id: variants[0].id,
    default_variant: variants[0],
    variants,
    option_types: [optionType],
    media: [],
    purchasable: true,
    in_stock: true,
    price: variants[0].price,
    original_price: null,
    description:
      locale === "ar"
        ? "اختر اللون المناسب لك."
        : "Choose the color that suits you.",
    description_html: null,
    custom_fields: [],
  } as unknown as Product;
}

function pagePresentationFor(scenario: Scenario): PagePresentation | undefined {
  if (scenario === "hidden-description") {
    return {
      product: {
        version: 1,
        regions: [
          { id: "media_gallery", key: "media_gallery", visible: true },
          { id: "identity", key: "identity", visible: true },
          { id: "price", key: "price", visible: true },
          { id: "availability", key: "availability", visible: true },
          { id: "quantity_cta", key: "quantity_cta", visible: true },
          { id: "description", key: "description", visible: false },
          { id: "custom_fields", key: "custom_fields", visible: true },
          {
            id: "sku_options_details",
            key: "sku_options_details",
            visible: true,
          },
        ],
      },
    };
  }
  if (scenario === "reordered") {
    return {
      product: {
        version: 1,
        regions: [
          { id: "media_gallery", key: "media_gallery", visible: true },
          { id: "identity", key: "identity", visible: true },
          { id: "price", key: "price", visible: true },
          { id: "availability", key: "availability", visible: true },
          { id: "quantity_cta", key: "quantity_cta", visible: true },
          {
            id: "sku_options_details",
            key: "sku_options_details",
            visible: true,
          },
          { id: "description", key: "description", visible: true },
          { id: "custom_fields", key: "custom_fields", visible: true },
        ],
      },
    };
  }
  return undefined;
}

export default async function ProductVisualPage({
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

  const product =
    scenario === "variant"
      ? variantProduct(locale)
      : baseProduct(locale, scenario);
  const pagePresentation = pagePresentationFor(scenario);

  return (
    <NextIntlClientProvider messages={messages} locale={locale}>
      <DirectionLock locale={locale} />
      <DevStorefrontProviders locale={locale}>
        <ProductDetails
          product={product}
          basePath={`/sa/${locale}`}
          pagePresentation={pagePresentation}
        />
      </DevStorefrontProviders>
    </NextIntlClientProvider>
  );
}
