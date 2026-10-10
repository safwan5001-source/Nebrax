/**
 * CUST-HV V6c-5 — renders the REAL published hero (the production `HeroSection`) and banner (`BannerBand`) through
 * `publishedNodes` with every per-CTA `style` combination, on the default surface and on a proven picture background,
 * for the browser proof in `scripts/cta-style-proof/measure.mjs`. Inert unless CTA_STYLE_PROOF_DIR is set.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { StoreContainer } from "@/components/layout/StoreContainer";
import type { PresentationHomeSection } from "@/lib/presentation/config";
import { publishedHomeStackClass } from "@/lib/presentation/public-rhythm";
import { heroContentOf } from "@/lib/presentation/section-content";
import ar from "../../../../messages/ar.json";
import en from "../../../../messages/en.json";
import { HeroSection } from "../HeroSection";
import { publishedNodes } from "../published-nodes";

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

const DIR = process.env.CTA_STYLE_PROOF_DIR ?? "";
const MEDIA_ID = "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e";
const RESOLVED = {
  "homepage.sections.0.design.background.media": {
    width: 1600,
    height: 900,
    decorative: true,
    alt: { ar: null, en: null },
    sources: [
      { kind: "w", width: 1600, height: 900, format: "jpg", src: "../bg.svg" },
    ],
    contrast: { min: [0, 0, 0], max: [40, 50, 60] },
  },
};
// [id, first style, second style]
const COMBOS = [
  ["auto", undefined, undefined],
  ["explicit-default", "solid", "outline"],
  ["solid-solid", "solid", "solid"],
  ["outline-outline", "outline", "outline"],
  ["link-link", "link", "link"],
  ["link-solid", "link", "solid"],
] as const;

describe("cta style proof", () => {
  it.skipIf(!DIR)(
    "renders hero and banner × kind × style combination × direction",
    async () => {
      mkdirSync(join(DIR, "pages"), { recursive: true });
      const css = readFileSync(join(DIR, "storefront.css"), "utf8");
      writeFileSync(
        join(DIR, "bg.svg"),
        '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b1d2a"/><stop offset="1" stop-color="#28323c"/></linearGradient></defs><rect width="1600" height="900" fill="url(#g)"/></svg>',
      );
      for (const type of ["hero", "banner"] as const) {
        for (const kind of ["plain", "picture"] as const) {
          for (const [cid, first, second] of COMBOS) {
            const ctas = [
              {
                label: "Shop now",
                href: "/products",
                ...(first ? { style: first } : {}),
              },
              {
                label: "Learn more",
                href: "/about",
                ...(second ? { style: second } : {}),
              },
            ];
            const design =
              kind === "picture"
                ? {
                    background: {
                      kind: "media",
                      media: { mediaId: MEDIA_ID, decorative: true },
                      overlay: { color: { hex: "#000000" }, alpha: 40 },
                    },
                  }
                : undefined;
            const section = {
              id: type,
              type,
              visible: true,
              content:
                type === "hero"
                  ? {
                      headline: "Style proof headline",
                      subheadline: "A supporting line",
                      ctas,
                    }
                  : {
                      title: "Style proof banner",
                      subtitle: "A supporting line",
                      ctas,
                      ctaLabel: "",
                      ctaHref: "",
                      imageUrl: null,
                    },
              ...(design ? { design } : {}),
            } as unknown as PresentationHomeSection;
            for (const dir of ["ltr", "rtl"] as const) {
              const base = {
                implemented: {} as never,
                basePath: "/sa/en",
                locale: dir === "rtl" ? "ar" : "en",
                apps: { iosUrl: "", androidUrl: "", appName: "" },
                benefitsTitle: "",
                featuredTitle: "",
                offersTitle: "",
                appTitle: "",
                appStoreLabel: "",
                playStoreLabel: "",
                media: RESOLVED,
                design: { primaryColor: "#12372a", accentColor: null, dir },
              };
              const calls: Record<string, any>[] = [];
              await publishedNodes([section], {
                ...base,
                renderHero: (a: Record<string, any>) => {
                  calls.push(a);
                  return null;
                },
              } as never);
              const resolved = new Map<string, unknown>();
              for (const a of calls) {
                const own = heroContentOf(a.section);
                resolved.set(
                  a.section.id,
                  await HeroSection({
                    basePath: "/sa/en",
                    locale: dir === "rtl" ? "ar" : "en",
                    storeName: "Daisy Shop",
                    headline: own ? own.headline : "",
                    subheadline: own ? (own.subheadline ?? null) : "",
                    ctas: own?.ctas ?? null,
                    headingId: "home-hero",
                    headingLevel: a.headingLevel,
                    themePreset: "awj-market",
                    designed: a.designed,
                    backdrop: a.backdrop,
                  }),
                );
              }
              const nodes = await publishedNodes([section], {
                ...base,
                renderHero: (a: Record<string, any>) =>
                  resolved.get(a.section.id),
              } as never);
              const html = `<!doctype html><html lang="${dir === "rtl" ? "ar" : "en"}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><style>:root{--store-primary:#12372a;--store-primary-foreground:#ffffff;--store-foreground:#111827;--store-muted-foreground:#4b5563;--store-border:#e5e7eb;--store-surface:#ffffff;--store-radius:14px}body{background:#f8f9fa;margin:0;font-family:system-ui,sans-serif}</style></head><body>${renderToStaticMarkup(
                <main id="main-content">
                  <StoreContainer
                    className={publishedHomeStackClass(undefined)}
                  >
                    {nodes}
                  </StoreContainer>
                </main>,
              )}</body></html>`;
              writeFileSync(
                join(DIR, "pages", `${type}.${kind}.${cid}.${dir}.html`),
                html,
              );
            }
          }
        }
      }
      expect(true).toBe(true);
    },
  );
});
