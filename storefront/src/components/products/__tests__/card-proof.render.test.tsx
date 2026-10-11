/**
 * CUST-HV V9d-1 — renders the REAL product card and offer card (production components, static HTML) inside a wrapper that carries exactly what
 * the production resolver (`resolveGlobalTokens`) returns for each card-token variant, for the browser proof in
 * `scripts/card-proof/measure.mjs`. Inert unless CARD_PROOF_DIR is set (CI never runs it); the directory must already hold `storefront.css`,
 * `pics/` and `bounds.json` (`node scripts/pixel-proof/build-css.mjs <dir>`, `node scripts/slider-proof/make-pictures.mjs <dir>`).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DevStorefrontProviders } from "@/app/dev/_fixtures/providers";
import { OfferCard } from "@/components/products/OfferCard";
import { ProductCard } from "@/components/products/ProductCard";
import type { GlobalTokensDoc } from "@/lib/presentation/global-tokens";
import { resolveGlobalTokens } from "@/lib/presentation/global-tokens";
import ar from "../../../../messages/ar.json";
import en from "../../../../messages/en.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, replace() {}, prefetch() {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

const DIR = process.env.CARD_PROOF_DIR ?? "";

const VARIANTS: Record<string, GlobalTokensDoc> = {
  base: {},
  center: { cards: { align: "center" } },
  ratio11: { cards: { imageRatio: "1:1" } },
  ratio43: { cards: { imageRatio: "4:3" } },
  ratio34: { cards: { imageRatio: "3:4" } },
  contain: { cards: { imageFit: "contain" } },
  hovernone: { cards: { hover: "none" } },
  hoverlift: { cards: { hover: "lift" } },
  hoverzoom: { cards: { hover: "zoom" } },
  all: {
    cards: {
      align: "center",
      imageRatio: "4:3",
      imageFit: "contain",
      hover: "lift",
    },
  },
};

describe("card proof", () => {
  it.skipIf(!DIR)("renders every variant × direction", () => {
    mkdirSync(join(DIR, "pages"), { recursive: true });
    const css = readFileSync(join(DIR, "storefront.css"), "utf8");
    const bounds = JSON.parse(
      readFileSync(join(DIR, "bounds.json"), "utf8"),
    ) as Record<string, { width: number; height: number }>;
    for (const [name, doc] of Object.entries(VARIANTS)) {
      for (const dir of ["ltr", "rtl"] as const) {
        const l = dir === "rtl" ? "ar" : "en";
        const resolved = resolveGlobalTokens(doc);
        const attrs = Object.entries(resolved?.attrs ?? {})
          .map(([k, v]) => `${k}="${v}"`)
          .join(" ");
        const style = Object.entries(resolved?.style ?? {})
          .map(([k, v]) => `${k}:${v}`)
          .join(";");
        const pic = (n: string) => `../pics/${n}.png`;
        const products = ["dark", "light", "phone"].map((p, i) => ({
          id: `p${i}`,
          slug: `p${i}`,
          name:
            l === "ar"
              ? `منتج رقم ${i + 1} باسم طويل جداً يتجاوز سطرين في البطاقة`
              : `Product number ${i + 1} with a very long name that wraps past two lines`,
          purchasable: true,
          thumbnail_url: pic(p),
          card_url: pic(p),
          price: {
            display_amount: l === "ar" ? "١٢٠٫٠٠ ر.س" : "SAR 120.00",
            amount_in_cents: 12000,
          },
          categories: [{ name: l === "ar" ? "ورود" : "Roses" }],
        }));
        const offer = {
          id: "o1",
          productId: "prod-1",
          name: l === "ar" ? "عرض الورد الفاخر" : "Premium roses offer",
          thumbnailUrl: pic("light"),
          referencePrice: {
            amountMinor: 25000,
            currency: "SAR",
            display: l === "ar" ? "٢٥٠ ر.س" : "SAR 250",
          },
          offerPrice: {
            amountMinor: 19000,
            currency: "SAR",
            display: l === "ar" ? "١٩٠ ر.س" : "SAR 190",
          },
          discountPercent: 24,
        };
        void bounds;
        const body = renderToStaticMarkup(
          <NextIntlClientProvider
            locale={l}
            messages={(l === "ar" ? ar : en) as never}
          >
            <DevStorefrontProviders locale={l}>
              <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {products.map((product) => (
                  <li key={product.id} className="min-w-0">
                    <ProductCard product={product as never} basePath="/sa/en" />
                  </li>
                ))}
                <li className="min-w-0">
                  <OfferCard offer={offer} basePath="/sa/en" />
                </li>
              </ul>
            </DevStorefrontProviders>
          </NextIntlClientProvider>,
        );
        const html = `<!doctype html><html lang="${l}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><style>:root{--store-primary:#12372a;--store-primary-foreground:#ffffff;--store-accent:#ffd166;--store-foreground:#111827;--store-muted-foreground:#4b5563;--store-border:#d1d5db;--store-surface:#ffffff;--store-radius:14px}body{background:#f8f9fa;margin:0;font-family:system-ui,sans-serif}#stack{max-width:85rem;margin-inline:auto;padding:16px}</style></head><body><div id="stack"><div id="scope" ${attrs} style="${style}">${body}</div></div></body></html>`;
        writeFileSync(join(DIR, "pages", `${name}.${dir}.html`), html);
      }
    }
    expect(true).toBe(true);
  });
});
