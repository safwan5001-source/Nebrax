/**
 * CUST-HV V6c-2 — renders the REAL published banner (`publishedNodes`, the production `BannerBand`, the compiled
 * storefront CSS) for the CTA configurations the browser proof measures. Inert unless BANNER_CTA_PROOF_DIR is set
 * (CI never runs it). Measured by `scripts/banner-cta-proof/measure.mjs`.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, vi } from "vitest";
import { StoreContainer } from "@/components/layout/StoreContainer";
import type { PresentationHomeSection } from "@/lib/presentation/config";
import { publishedHomeStackClass } from "@/lib/presentation/public-rhythm";
import { publishedNodes } from "../published-nodes";

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (k: string) => k,
}));
const DIR = process.env.BANNER_CTA_PROOF_DIR ?? "";
const long = (s: string) =>
  Array.from({ length: 80 }, (_, i) => s[i % s.length]).join("");
const cases: Record<string, Record<string, unknown>> = {
  legacy: { title: "Winter sale", ctaLabel: "Shop now", ctaHref: "/products" },
  two: {
    title: "Winter sale",
    ctas: [
      { label: "Shop now", href: "/products" },
      { label: "Learn more", href: "https://example.com/about" },
    ],
  },
  twoLong: {
    title: "Winter sale",
    subtitle: "Up to half off",
    ctas: [
      { label: long("abcdefghij "), href: "/a" },
      { label: long("klmnopqrst "), href: "/b" },
    ],
  },
  oneLong: {
    title: "Winter sale",
    ctaLabel: long("abcdefghij "),
    ctaHref: "/a",
  },
  twoAr: {
    title: "تخفيضات الشتاء",
    ctas: [
      { label: "تسوّق الآن", href: "/products" },
      { label: "اعرف المزيد عن العروض", href: "/about" },
    ],
  },
  twoImage: {
    title: "Winter sale",
    subtitle: "x",
    imageUrl: "data:,",
    ctas: [
      { label: "Shop now", href: "/products" },
      { label: "Learn more", href: "/about" },
    ],
  },
};
describe("banner cta proof", () => {
  it.skipIf(!DIR)("renders", async () => {
    mkdirSync(join(DIR, "pages"), { recursive: true });
    for (const [id, c] of Object.entries(cases)) {
      for (const dir of ["ltr", "rtl"] as const) {
        const section = {
          id: "ban",
          type: "banner",
          visible: true,
          content: {
            subtitle: "",
            ctaLabel: "",
            ctaHref: "",
            imageUrl: null,
            ...c,
          },
        } as PresentationHomeSection;
        const nodes = await publishedNodes([section], {
          implemented: {},
          basePath: "/sa/en",
          locale: dir === "rtl" ? "ar" : "en",
          themePreset: undefined,
          apps: { iosUrl: "", androidUrl: "", appName: "" },
          benefitsTitle: "b",
          featuredTitle: "f",
          offersTitle: "o",
          appTitle: "a",
          appStoreLabel: "as",
          playStoreLabel: "ps",
          design: { primaryColor: "#12372a", accentColor: null, dir },
        } as never);
        const body = renderToStaticMarkup(
          <main>
            <StoreContainer>
              <div className={publishedHomeStackClass}>{nodes}</div>
            </StoreContainer>
          </main>,
        );
        writeFileSync(
          join(DIR, "pages", `${id}.${dir}.html`),
          `<!doctype html><html lang="${dir === "rtl" ? "ar" : "en"}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${readFileSync(join(DIR, "storefront.css"), "utf8")}</style><style>:root{--store-primary:#12372a;--store-primary-foreground:#ffffff;--store-foreground:#111827;--store-muted-foreground:#4b5563;--store-border:#e5e7eb;--store-surface:#ffffff;--store-radius:14px}body{background:#f8f9fa;margin:0;font-family:system-ui,sans-serif}</style></head><body>${body}</body></html>`,
        );
      }
    }
  });
});
