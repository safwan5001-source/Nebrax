/**
 * AWJ-HERO-FULLBLEED — renders the REAL published hero (the production `HeroSection`, its picture backdrop and
 * `SectionDesignFrame`) through `publishedNodes` inside the real page stack (`StoreContainer` + the published rhythm class),
 * under a stand-in header, for the browser proof in `scripts/hero-bleed-proof/measure.mjs`. Each kind is one hero treatment
 * (`mediaTreatment.bleed` / `ratio: natural` / `height` + `mobileHeight`) × direction. The "pictures" are SVGs beside the pages
 * (a 16:9 desktop one and a 4:5 phone one) and the server's resolved-media map is fabricated with proven-dark contrast bounds
 * (the shape the publish gate produces). Inert unless HERO_BLEED_PROOF_DIR is set (CI never runs it).
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

const DIR = process.env.HERO_BLEED_PROOF_DIR ?? "";
const MEDIA_ID = "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e";
const MOBILE_ID = "1c9a7d3f-4e4b-4b64-8d8f-9a2b3c4d5e6f";

const LONG =
  "A long supporting paragraph that makes the copy taller than a short picture so the hero must grow, never clip it. ".repeat(
    6,
  );

type Kind = {
  design: Record<string, unknown>;
  content?: Record<string, unknown>;
  picture?: boolean;
  mobilePicture?: boolean;
};

const KINDS: Record<string, Kind> = {
  // the legacy look: a contained card
  control: { design: {} },
  // edge to edge, directly below the header, with copy
  bleed: { design: { mediaTreatment: { bleed: true } } },
  // the reference look: picture only, edge to edge, as tall as the picture
  bleedimg: {
    design: { mediaTreatment: { bleed: true, ratio: "natural" } },
    content: { showTitle: false, showSubheadline: false, showCtas: false },
  },
  // natural proportions inside the page container
  natural: { design: { mediaTreatment: { ratio: "natural" } } },
  // natural + a different phone picture (4:5)
  naturalmob: {
    design: { mediaTreatment: { ratio: "natural" } },
    mobilePicture: true,
  },
  // copy taller than the picture: the hero grows, nothing is clipped
  bleedlong: {
    design: { mediaTreatment: { bleed: true, ratio: "natural" } },
    content: { subheadline: LONG },
  },
  // preset heights: tall on desktop, compact on phones
  heights: {
    design: { mediaTreatment: { height: "tall", mobileHeight: "compact" } },
  },
  // inert: a split hero's picture covers half the box
  splitbleed: {
    design: {
      layout: "split",
      mediaTreatment: { bleed: true, ratio: "natural" },
    },
  },
  // inert: no picture to prove
  nomedia: {
    design: { mediaTreatment: { bleed: true, ratio: "natural" } },
    picture: false,
  },
};

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
  "homepage.sections.0.design.background.mobile": {
    width: 800,
    height: 1000,
    decorative: true,
    alt: { ar: null, en: null },
    sources: [
      {
        kind: "w",
        width: 800,
        height: 1000,
        format: "jpg",
        src: "../bg-m.svg",
      },
    ],
    contrast: { min: [0, 0, 0], max: [40, 50, 60] },
  },
};

describe("hero bleed proof", () => {
  it.skipIf(!DIR)(
    "renders each hero treatment × direction under a stand-in header",
    async () => {
      mkdirSync(join(DIR, "pages"), { recursive: true });
      const css = readFileSync(join(DIR, "storefront.css"), "utf8");
      writeFileSync(
        join(DIR, "bg.svg"),
        '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b2a33"/><stop offset="1" stop-color="#2a1b3d"/></linearGradient></defs><rect width="1600" height="900" fill="url(#g)"/><circle cx="800" cy="450" r="260" fill="#14532d"/></svg>',
      );
      writeFileSync(
        join(DIR, "bg-m.svg"),
        '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000" viewBox="0 0 800 1000"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1e1b4b"/><stop offset="1" stop-color="#312e81"/></linearGradient></defs><rect width="800" height="1000" fill="url(#g)"/><circle cx="400" cy="500" r="220" fill="#064e3b"/></svg>',
      );
      for (const [name, kind] of Object.entries(KINDS)) {
        const design: Record<string, unknown> = { ...kind.design };
        if (kind.picture !== false) {
          design.background = {
            kind: "media",
            media: { mediaId: MEDIA_ID, decorative: true },
            ...(kind.mobilePicture
              ? { mobile: { mediaId: MOBILE_ID, decorative: true } }
              : {}),
          };
        }
        const hero = {
          id: "hero",
          type: "hero",
          visible: true,
          content: {
            headline: "Hero bleed proof headline",
            subheadline: "A supporting line over the picture",
            ctas: [
              { label: "Shop now", href: "/products" },
              { label: "Learn more", href: "/about" },
            ],
            ...(kind.content ?? {}),
          },
          design,
        } as unknown as PresentationHomeSection;
        const next = {
          id: "next",
          type: "banner",
          visible: true,
          content: {
            title: "The next section",
            subtitle: "It follows the hero",
            ctas: [{ label: "Browse", href: "/products" }],
            ctaLabel: "",
            ctaHref: "",
            imageUrl: null,
          },
        } as unknown as PresentationHomeSection;
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
          const sections = [hero, next];
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
                showTitle: own?.showTitle !== false,
                showSubheadline: own?.showSubheadline !== false,
                showCtas: own?.showCtas !== false,
                imageHref: own?.imageHref ?? null,
                headingId: "home-hero",
                headingLevel: a.headingLevel,
                themePreset: "awj-modern",
                designed: a.designed,
                backdrop: a.backdrop,
              }),
            );
          }
          const nodes = await publishedNodes(sections, {
            ...base,
            renderHero: (a: Record<string, any>) => resolved.get(a.section.id),
          } as never);
          const html = `<!doctype html><html lang="${dir === "rtl" ? "ar" : "en"}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><style>:root{--store-primary:#12372a;--store-primary-foreground:#ffffff;--store-foreground:#111827;--store-muted-foreground:#4b5563;--store-border:#e5e7eb;--store-surface:#ffffff;--store-radius:14px}body{background:#f8f9fa;margin:0;font-family:system-ui,sans-serif}</style></head><body><header id="stand-in-header" style="height:64px;background:#ffffff;border-bottom:1px solid #e5e7eb"></header>${renderToStaticMarkup(
            <main id="main-content">
              <StoreContainer className={publishedHomeStackClass(undefined)}>
                {nodes}
              </StoreContainer>
            </main>,
          )}<footer id="page-footer" style="height:1800px;background:#12372a"></footer></body></html>`;
          writeFileSync(join(DIR, "pages", `${name}.${dir}.html`), html);
        }
      }
      expect(true).toBe(true);
    },
  );
});
