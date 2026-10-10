/**
 * CUST-HV V6c-7 — renders the REAL published hero (the production `HeroSection`) and banner (`BannerBand`) through
 * `publishedNodes` for every layout variant, on the default surface and (hero) on a proven picture background, for the
 * browser proof in `scripts/layout-proof/measure.mjs`. Inert unless LAYOUT_PROOF_DIR is set (CI never runs it).
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

const DIR = process.env.LAYOUT_PROOF_DIR ?? "";
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
const HERO_LAYOUTS = [undefined, "centered", "minimal", "split"] as const;
const BANNER_LAYOUTS = [undefined, "split", "text-band"] as const;

describe("layout proof", () => {
  it.skipIf(!DIR)(
    "renders hero and banner × kind × layout × direction",
    async () => {
      mkdirSync(join(DIR, "pages"), { recursive: true });
      const css = readFileSync(join(DIR, "storefront.css"), "utf8");
      writeFileSync(
        join(DIR, "bg.svg"),
        '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900"><rect width="1600" height="900" fill="#2a3a4a"/><circle cx="800" cy="450" r="320" fill="#3d5266"/></svg>',
      );
      const jobs: Array<{
        type: "hero" | "banner";
        kind: string;
        layout: string | undefined;
      }> = [];
      for (const kind of ["plain", "picture"])
        for (const layout of HERO_LAYOUTS)
          jobs.push({ type: "hero", kind, layout });
      // a picture hero whose explicit inline position (the 3×3 grid's inline half) points away from the text half
      for (const kind of ["picture-center", "picture-end"])
        for (const layout of [undefined, "split"] as const)
          jobs.push({ type: "hero", kind, layout });
      // banner kinds: plain (picture + copy) · noimage (copy only) · imageonly (a picture and nothing else) ·
      // inner (explicit inner spacing `none`) · nocta (title and subtitle, no button) · lone (a single button)
      for (const kind of [
        "plain",
        "noimage",
        "imageonly",
        "inner",
        "nocta",
        "lone",
      ])
        for (const layout of BANNER_LAYOUTS)
          jobs.push({ type: "banner", kind, layout });
      for (const { type, kind, layout } of jobs) {
        const design: Record<string, unknown> = {};
        if (kind.startsWith("picture")) {
          design.background = {
            kind: "media",
            media: { mediaId: MEDIA_ID, decorative: true },
            overlay: { color: { hex: "#000000" }, alpha: 40 },
          };
        }
        if (layout) design.layout = layout;
        if (kind === "picture-center") design.align = "center";
        if (kind === "picture-end") design.align = "end";
        if (kind === "inner") design.spacing = { inner: "none" };
        const ctas = [
          { label: "Shop now", href: "/products" },
          { label: "Learn more", href: "/about" },
        ];
        const section = {
          id: type,
          type,
          visible: true,
          content:
            type === "hero"
              ? {
                  headline: "Layout proof headline",
                  subheadline: "A supporting line that explains the offer",
                  ctas,
                }
              : {
                  title: kind === "imageonly" ? "" : "Layout proof banner",
                  subtitle:
                    kind === "imageonly"
                      ? ""
                      : "A supporting line that explains the offer",
                  ctas:
                    kind === "imageonly" || kind === "nocta"
                      ? []
                      : kind === "lone"
                        ? ctas.slice(0, 1)
                        : ctas,
                  ctaLabel: "",
                  ctaHref: "",
                  imageUrl:
                    kind === "noimage"
                      ? null
                      : "https://example.invalid/banner.svg",
                  imageAlt: "Banner picture",
                },
          ...(Object.keys(design).length ? { design } : {}),
        } as unknown as PresentationHomeSection;
        for (const dir of ["ltr", "rtl"] as const) {
          const designCtx = { primaryColor: "#12372a", accentColor: null, dir };
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
            design: designCtx,
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
                designCtx,
              }),
            );
          }
          const nodes = await publishedNodes([section], {
            ...base,
            renderHero: (a: Record<string, any>) => resolved.get(a.section.id),
          } as never);
          const html = `<!doctype html><html lang="${dir === "rtl" ? "ar" : "en"}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><style>:root{--store-primary:#12372a;--store-primary-foreground:#ffffff;--store-foreground:#111827;--store-muted-foreground:#4b5563;--store-border:#e5e7eb;--store-surface:#ffffff;--store-radius:14px}body{background:#f8f9fa;margin:0;font-family:system-ui,sans-serif}</style></head><body>${renderToStaticMarkup(
            <main id="main-content">
              <StoreContainer className={publishedHomeStackClass(undefined)}>
                {nodes}
              </StoreContainer>
            </main>,
          )}</body></html>`;
          writeFileSync(
            join(
              DIR,
              "pages",
              `${type}.${kind}.${layout ?? "none"}.${dir}.html`,
            ),
            html,
          );
        }
      }
      expect(true).toBe(true);
    },
  );
});
