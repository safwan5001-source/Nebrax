/**
 * CUST-HV V7d-3 — renders the REAL published header (navigation proof: the real HeaderNavLinks / MobileNavItem are mounted client-side by scripts/nav-proof/mount.tsx) (the production `Header`, theme wrapper attributes from the production
 * `publishedThemeAttrs` / `publishedThemeStyle`) for every structural design, for the browser proof in
 * `scripts/nav-proof/measure.mjs`. Inert unless NAV_PROOF_DIR is set (CI never runs it).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { normalizePresentationConfig } from "@/lib/presentation/config";
import { headerIsCompact } from "@/lib/presentation/header-design";
import {
  publishedThemeAttrs,
  publishedThemeStyle,
} from "@/lib/presentation/public";
import ar from "../../../../messages/ar.json";
import en from "../../../../messages/en.json";

vi.mock("next-intl/server", () => ({
  getTranslations: async ({
    locale,
    namespace,
  }: {
    locale: string;
    namespace: string;
  }) => {
    const table =
      (
        (locale === "ar" ? ar : en) as unknown as Record<
          string,
          Record<string, string>
        >
      )[namespace] ?? {};
    return (key: string) => table[key] ?? key;
  },
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/components/layout/HeaderNavLinks", () => ({
  HeaderNavLinks: ({ items }: { items: unknown[] }) => (
    <div
      data-nav-mount=""
      data-items={JSON.stringify(items)}
      className="contents"
    />
  ),
}));
vi.mock("@/components/layout/StoreSearch", () => ({
  StoreSearch: ({ className }: { className?: string }) => (
    <div
      data-search=""
      className={className}
      style={{ height: "2.5rem", border: "1px solid #9ca3af", borderRadius: 8 }}
    >
      <input
        aria-label="search"
        data-search-input=""
        style={{
          width: "100%",
          height: "100%",
          border: 0,
          background: "transparent",
        }}
      />
    </div>
  ),
}));
vi.mock("@/components/layout/CartButton", () => ({
  // The real "action" variant paints its own soft surface; the icon variant is a bare ghost button.
  CartButton: ({
    className,
    variant,
  }: {
    className?: string;
    variant?: string;
  }) =>
    variant === "action" ? (
      <button
        type="button"
        data-cart=""
        data-cart-pill=""
        className={`bg-store-primary-soft text-store-primary ${className ?? ""}`}
        style={{ height: "2.5rem", minWidth: "2.5rem" }}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" />
        </svg>
        cart
      </button>
    ) : (
      <button
        type="button"
        data-cart=""
        data-cart-icon=""
        className={className}
        style={{ height: "2.5rem", minWidth: "2.5rem" }}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" />
        </svg>
      </button>
    ),
}));

import { Header } from "@/components/layout/Header";

const DIR = process.env.NAV_PROOF_DIR ?? "";
const ITEMS = [
  {
    id: "offers",
    label: "Offers",
    href: "/sa/en/c/offers",
    newTab: false,
    icon: "percent",
    badge: { text: "Sale", tone: "brand" },
    dropdown: false,
    children: [],
  },
  {
    id: "shop",
    label: "Shop",
    href: "/sa/en/products",
    newTab: false,
    icon: "tag",
    badge: { text: "New", tone: "accent" },
    dropdown: true,
    children: [
      {
        id: "k1",
        label: "Shoes",
        href: "/sa/en/c/shoes",
        newTab: false,
        icon: "package",
      },
      {
        id: "k2",
        label: "Bags and travel accessories",
        href: "/sa/en/c/bags",
        newTab: false,
      },
      {
        id: "k3",
        label: "Our blog",
        href: "https://example.com/blog",
        newTab: true,
        icon: "globe",
      },
    ],
  },
  {
    id: "privacy",
    label: "Privacy",
    href: "/sa/en/policies/privacy-policy",
    newTab: false,
    dropdown: false,
    children: [],
  },
];
const AR_LABELS: Record<string, string> = {
  k4: "LONG",
  offers: "العروض",
  shop: "المتجر",
  privacy: "الخصوصية",
  k1: "الأحذية",
  k2: "الحقائب ومستلزمات السفر",
  k3: "مدونتنا",
};

describe("navigation proof", () => {
  it.skipIf(!DIR)(
    "renders the published header with a dropdown × direction",
    async () => {
      mkdirSync(join(DIR, "pages"), { recursive: true });
      const css = readFileSync(join(DIR, "storefront.css"), "utf8");
      const LONG_EN =
        "Our complete collection of hand-tied seasonal bouquets and arrangements";
      const LONG_AR =
        "مجموعتنا الكاملة من باقات الورد الموسمية المنسقة يدوياً وتنسيقات الهدايا";
      const SHOP = ITEMS[1] as (typeof ITEMS)[number];
      for (const page of ["nav", "navlast"] as const)
        for (const dir of ["ltr", "rtl"] as const) {
          // `navlast`: the dropdown is the LAST item and carries a very long child, so its default alignment cannot fit
          const source =
            page === "nav"
              ? ITEMS
              : [
                  ITEMS[0] as (typeof ITEMS)[number],
                  ITEMS[2] as (typeof ITEMS)[number],
                  {
                    ...SHOP,
                    children: [
                      {
                        id: "k4",
                        label: "LONG",
                        href: "/sa/en/c/long",
                        newTab: false,
                      },
                      ...SHOP.children,
                    ],
                  },
                ];
          const items = source.map((item) => ({
            ...item,
            label: dir === "rtl" ? AR_LABELS[item.id] : item.label,
            children: item.children.map((c) => ({
              ...c,
              label:
                c.id === "k4"
                  ? dir === "rtl"
                    ? LONG_AR
                    : LONG_EN
                  : dir === "rtl"
                    ? AR_LABELS[c.id]
                    : c.label,
            })),
          }));
          const presentation = normalizePresentationConfig({});
          const header = await Header({
            basePath: "/sa/en",
            locale: dir === "rtl" ? "ar" : "en",
            storeName: "Daisy Shop Flowers",
            compact: headerIsCompact(presentation.header),
            design: presentation.header.design,
            extraLinks: items as never,
            mobileNavigation: (
              <button
                type="button"
                data-menu=""
                className="inline-flex"
                style={{ width: "2.5rem", height: "2.5rem" }}
              >
                menu
              </button>
            ),
            categoryNavigation: null,
          });
          const attrs = publishedThemeAttrs(presentation) ?? {};
          const style = publishedThemeStyle(presentation) ?? {};
          const wrapper = renderToStaticMarkup(
            <div
              data-published-theme=""
              {...attrs}
              className="flex min-h-screen flex-1 flex-col"
              style={style}
            >
              {header}
              <main id="main-content" className="flex-1">
                <div style={{ height: "600px", padding: "1rem" }}>
                  page content under the dropdown
                </div>
                <div
                  data-mobile-mount=""
                  data-items={JSON.stringify(items)}
                  style={{ maxWidth: "430px" }}
                />
              </main>
            </div>,
          );
          const html = `<!doctype html><html lang="${dir === "rtl" ? "ar" : "en"}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><style>:root{--store-primary:#12372a;--store-primary-foreground:#ffffff;--store-accent:#ffd166;--store-accent-foreground:#111827;--store-foreground:#111827;--store-muted-foreground:#4b5563;--store-border:#d1d5db;--store-surface:#ffffff;--store-surface-muted:#f3f4f6;--store-radius:14px}body{background:#f8f9fa;margin:0;font-family:system-ui,sans-serif}</style></head><body>${wrapper}</body></html>`;
          writeFileSync(join(DIR, "pages", `${page}.${dir}.html`), html);
        }
      expect(true).toBe(true);
    },
  );
});
