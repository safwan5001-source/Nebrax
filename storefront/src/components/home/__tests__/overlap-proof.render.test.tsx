/**
 * CUST-HV V6c-4 — renders the REAL published hero (the production `HeroSection`, its picture backdrop and
 * `SectionDesignFrame`) followed by a second section, through `publishedNodes`, with the hero `overlap` preset ×
 * hero height × direction, for the browser proof in `scripts/overlap-proof/measure.mjs`. The "picture" is an SVG
 * beside the pages and the server's resolved-media map is fabricated with proven-dark contrast bounds (the shape the
 * publish gate produces). Inert unless OVERLAP_PROOF_DIR is set (CI never runs it).
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

const DIR = process.env.OVERLAP_PROOF_DIR ?? "";
const MEDIA_ID = "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e";

const OVERLAPS = [undefined, "sm", "md"] as const;
const HEIGHTS = [undefined, "tall"] as const;
// picture: the proven picture hero · separator: same + a bottom separator · nomedia: no picture to prove
// last: the hero is the only section (nothing follows but the footer) · emptynext: only an empty wrapper (a section that
// rendered nothing, e.g. an empty catalogue) sits between the hero and the next section
const KINDS = ["picture", "separator", "nomedia", "last", "emptynext"] as const;

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

describe("overlap proof", () => {
  it.skipIf(!DIR)(
    "renders a hero + the next section × overlap × height × kind × direction",
    async () => {
      mkdirSync(join(DIR, "pages"), { recursive: true });
      const css = readFileSync(join(DIR, "storefront.css"), "utf8");
      writeFileSync(
        join(DIR, "bg.svg"),
        '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b1d2a"/><stop offset="1" stop-color="#28323c"/></linearGradient></defs><rect width="1600" height="900" fill="url(#g)"/><circle cx="1200" cy="300" r="260" fill="#1b3a4b"/></svg>',
      );
      for (const kind of KINDS) {
        for (const height of HEIGHTS) {
          for (const overlap of OVERLAPS) {
            const design: Record<string, unknown> = {};
            if (kind !== "nomedia") {
              design.background = {
                kind: "media",
                media: { mediaId: MEDIA_ID, decorative: true },
                overlay: { color: { hex: "#000000" }, alpha: 40 },
              };
            }
            if (overlap) design.overlap = overlap;
            if (height) design.mediaTreatment = { height };
            if (kind === "separator") design.separator = { bottom: "wave" };
            const hero = {
              id: "hero",
              type: "hero",
              visible: true,
              content: {
                headline: "Overlap proof headline",
                subheadline: "A supporting line that sits above the sheet",
                ctas: [
                  { label: "Shop now", href: "/products" },
                  { label: "Learn more", href: "/about" },
                ],
              },
              design,
            } as unknown as PresentationHomeSection;
            const empty = {
              id: "empty",
              type: "categories",
              visible: true,
            } as unknown as PresentationHomeSection;
            const next = {
              id: "next",
              type: "banner",
              visible: true,
              content: {
                title: "The next section",
                subtitle: "It rises over the hero's lower edge",
                ctas: [{ label: "Browse", href: "/products" }],
                ctaLabel: "",
                ctaHref: "",
                imageUrl: null,
              },
            } as unknown as PresentationHomeSection;
            const sections =
              kind === "last"
                ? [hero]
                : kind === "emptynext"
                  ? [hero, empty, next]
                  : [hero, next];
            for (const dir of ["ltr", "rtl"] as const) {
              const base = {
                implemented: { categories: null } as never,
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
              await publishedNodes(sections, {
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
              const nodes = await publishedNodes(sections, {
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
              )}<footer id="page-footer" style="height:80px;background:#12372a"></footer></body></html>`;
              writeFileSync(
                join(
                  DIR,
                  "pages",
                  `${kind}.${height ?? "none"}.${overlap ?? "none"}.${dir}.html`,
                ),
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
