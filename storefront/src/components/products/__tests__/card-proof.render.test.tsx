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
import { shelfGridClass } from "@/lib/home/shelf-layout";
import type { GlobalTokensDoc } from "@/lib/presentation/global-tokens";
import { resolveGlobalTokens } from "@/lib/presentation/global-tokens";
import { resolveSectionDesign } from "@/lib/presentation/section-design-resolve";
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

    // V9d-2 — a shelf's own columns (the production grid class) and a section's own card tokens winning over the document's
    const shelfPage = (
      name: string,
      dir: "ltr" | "rtl",
      scope: string,
      inner: string,
      l: "ar" | "en",
    ) => {
      const html = `<!doctype html><html lang="${l}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><style>:root{--store-primary:#12372a;--store-primary-foreground:#ffffff;--store-accent:#ffd166;--store-foreground:#111827;--store-muted-foreground:#4b5563;--store-border:#d1d5db;--store-surface:#ffffff;--store-radius:14px}body{background:#f8f9fa;margin:0;font-family:system-ui,sans-serif}#stack{max-width:85rem;margin-inline:auto;padding:16px}</style></head><body><div id="stack"><div id="scope" ${scope}>${inner}</div></div></body></html>`;
      writeFileSync(join(DIR, "pages", `${name}.${dir}.html`), html);
    };
    const cardsOf = (l: "ar" | "en", n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `s${i}`,
        slug: `s${i}`,
        name: l === "ar" ? `منتج ${i + 1}` : `Product ${i + 1}`,
        purchasable: true,
        thumbnail_url: "../pics/light.png",
        card_url: "../pics/light.png",
        price: {
          display_amount: l === "ar" ? "٩٩٫٠٠ ر.س" : "SAR 99.00",
          amount_in_cents: 9900,
        },
        categories: [],
      }));
    for (const dir of ["ltr", "rtl"] as const) {
      const l = dir === "rtl" ? "ar" : "en";
      const wrap = (children: React.ReactNode) =>
        renderToStaticMarkup(
          <NextIntlClientProvider
            locale={l}
            messages={(l === "ar" ? ar : en) as never}
          >
            <DevStorefrontProviders locale={l}>
              {children}
            </DevStorefrontProviders>
          </NextIntlClientProvider>,
        );
      for (const columns of [undefined, 2, 3, 4] as const) {
        const list = (
          <ul className={`grid gap-3 md:gap-5 ${shelfGridClass(columns)}`}>
            {cardsOf(l, 8).map((p) => (
              <li key={p.id} className="min-w-0">
                <ProductCard product={p as never} basePath="/sa/en" />
              </li>
            ))}
          </ul>
        );
        shelfPage(`shelf${columns ?? "auto"}`, dir, "", wrap(list), l);
      }
      // the document says: centred, no hover motion — the first section keeps that; the second section's own tokens add a picture fit and shape and say the opposite of the rest
      const doc = resolveGlobalTokens({
        cards: { align: "center", hover: "none" },
      });
      const own = resolveSectionDesign(
        "featured",
        {
          cards: {
            align: "start",
            imageFit: "contain",
            imageRatio: "1:1",
            hover: "lift",
          },
        },
        { primaryColor: "#12372a", accentColor: null, dir },
      );
      const attrs = (a?: Record<string, string>) =>
        Object.entries(a ?? {})
          .map(([k, v]) => `${k}="${v}"`)
          .join(" ");
      const style = (st?: Record<string, string>) =>
        Object.entries(st ?? {})
          .map(([k, v]) => `${k}:${v}`)
          .join(";");
      const row = (
        id: string,
        a?: Record<string, string>,
        st?: Record<string, string>,
      ) =>
        `<section id="${id}" ${attrs(a)} style="${style(st)}">${wrap(
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {cardsOf(l, 4).map((p) => (
              <li key={p.id} className="min-w-0">
                <ProductCard product={p as never} basePath="/sa/en" />
              </li>
            ))}
          </ul>,
        )}</section>`;
      shelfPage(
        "override",
        dir,
        `${attrs(doc?.attrs)} style="${style(doc?.style)}"`,
        `${row("plain")}${row("own", own?.attrs, own?.style)}`,
        l,
      );
    }
    expect(true).toBe(true);
  });
});
