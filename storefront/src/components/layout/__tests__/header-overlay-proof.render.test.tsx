/**
 * CUST-HV V7c-2 — renders the REAL published Home (production `Header` + production `HeroSection` through
 * `publishedNodes`, the production `publishedHeaderOverlay` decision and the production theme-wrapper attributes)
 * for every overlay-on-hero scenario, for the browser proof in `scripts/header-proof/measure-overlay.mjs`.
 * Inert unless HEADER_OVERLAY_PROOF_DIR is set (CI never runs it).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HeroSection } from "@/components/home/HeroSection";
import { publishedNodes } from "@/components/home/published-nodes";
import { StoreContainer } from "@/components/layout/StoreContainer";
import { normalizePresentationConfig } from "@/lib/presentation/config";
import { headerIsCompact } from "@/lib/presentation/header-design";
import {
  publishedThemeAttrs,
  publishedThemeStyle,
} from "@/lib/presentation/public";
import { publishedHeaderOverlay } from "@/lib/presentation/public-overlay";
import { publishedHomeStackClass } from "@/lib/presentation/public-rhythm";
import { heroContentOf } from "@/lib/presentation/section-content";
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
vi.mock("@/lib/spree", () => ({ isWholesaleEnabled: () => false }));
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
        placeholder="Search"
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

const DIR = process.env.HEADER_OVERLAY_PROOF_DIR ?? "";
const MEDIA_ID = "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e";

type Rgb = [number, number, number];
/** A vertical two-stop gradient picture whose exact channel range is known. */
const PICTURES: Record<string, { top: Rgb; bottom: Rgb }> = {
  dark: { top: [26, 37, 48], bottom: [52, 73, 94] },
  bright: { top: [221, 228, 234], bottom: [244, 247, 249] },
  mid: { top: [100, 100, 100], bottom: [160, 160, 160] },
  wide: { top: [0, 0, 0], bottom: [255, 255, 255] },
  // evidence says "dark", the picture is bright at the top: the pixel proof MUST catch it (negative control)
  lie: { top: [235, 235, 235], bottom: [30, 40, 50] },
};
const svg = ({ top, bottom }: { top: Rgb; bottom: Rgb }) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgb(${top.join(",")})"/><stop offset="1" stop-color="rgb(${bottom.join(",")})"/></linearGradient></defs><rect width="1600" height="900" fill="url(#g)"/></svg>`;
const bounds = (name: string): { min: Rgb; max: Rgb } => {
  // `lie` declares the DARK picture's bounds
  const { top, bottom } = PICTURES[name === "lie" ? "dark" : name];
  const margin = 3;
  const min = [0, 1, 2].map((i) =>
    Math.max(0, Math.min(top[i], bottom[i]) - margin),
  ) as Rgb;
  const max = [0, 1, 2].map((i) =>
    Math.min(255, Math.max(top[i], bottom[i]) + margin),
  ) as Rgb;
  return { min, max };
};

interface Scenario {
  picture?: keyof typeof PICTURES;
  /** overlay colour/alpha of the hero's own picture overlay */
  heroOverlay?: { hex: string; alpha: number };
  heroLayout?: string;
  /** no contrast evidence published for the picture */
  noEvidence?: boolean;
  /** a plain (non-picture) hero */
  plainHero?: boolean;
  /** a banner before the hero */
  bannerFirst?: boolean;
  header: Record<string, unknown>;
  /** the proof pages also mount the controllers (hydration stand-in) */
  expectOverlay: boolean;
  expectFg?: "#ffffff" | "#000000";
}
const OV = { mode: "overlay-hero" };
const SCENARIOS: Record<string, Scenario> = {
  ovDark: {
    picture: "dark",
    header: OV,
    expectOverlay: true,
    expectFg: "#ffffff",
  },
  ovDarkWash: {
    picture: "dark",
    heroOverlay: { hex: "#000000", alpha: 40 },
    header: OV,
    expectOverlay: true,
    expectFg: "#ffffff",
  },
  ovBright: {
    picture: "bright",
    header: OV,
    expectOverlay: true,
    expectFg: "#000000",
  },
  ovWide: { picture: "wide", header: OV, expectOverlay: false },
  ovMidTone: { picture: "mid", header: OV, expectOverlay: false },
  ovNoEvidence: {
    picture: "dark",
    noEvidence: true,
    header: OV,
    expectOverlay: false,
  },
  ovSplit: {
    picture: "dark",
    heroLayout: "split",
    header: OV,
    expectOverlay: false,
  },
  ovPlainHero: { plainHero: true, header: OV, expectOverlay: false },
  ovBannerFirst: {
    picture: "dark",
    bannerFirst: true,
    header: OV,
    expectOverlay: false,
  },
  ovOptedOut: {
    picture: "dark",
    header: { layout: "standard" },
    expectOverlay: false,
  },
  ovSolidMode: {
    picture: "dark",
    header: { mode: "solid" },
    expectOverlay: false,
  },
  ovColours: {
    picture: "dark",
    header: { ...OV, surface: { background: { hex: "#12372a" } } },
    expectOverlay: true,
    expectFg: "#ffffff",
  },
  ovStickyOff: {
    picture: "dark",
    header: { ...OV, sticky: "off" },
    expectOverlay: true,
    expectFg: "#ffffff",
  },
  ovStickyUp: {
    picture: "dark",
    header: { ...OV, sticky: "on-scroll-up" },
    expectOverlay: true,
    expectFg: "#ffffff",
  },
  ovCentered: {
    picture: "dark",
    header: { ...OV, layout: "centered", mobileLayout: "logo-start" },
    expectOverlay: true,
    expectFg: "#ffffff",
  },
  ovTwoRow: {
    picture: "dark",
    header: { ...OV, layout: "two-row", height: "tall" },
    expectOverlay: true,
    expectFg: "#ffffff",
  },
  ovShadow: {
    picture: "dark",
    header: { ...OV, shadow: "medium", border: { width: "medium" } },
    expectOverlay: true,
    expectFg: "#ffffff",
  },
  ovLie: {
    picture: "lie",
    header: OV,
    expectOverlay: true,
    expectFg: "#ffffff",
  },
};

describe("header overlay proof", () => {
  it.skipIf(!DIR)("renders every scenario × direction", async () => {
    mkdirSync(join(DIR, "pages"), { recursive: true });
    const css = readFileSync(join(DIR, "storefront.css"), "utf8");
    for (const [name, picture] of Object.entries(PICTURES))
      writeFileSync(join(DIR, `pic-${name}.svg`), svg(picture));
    writeFileSync(join(DIR, "scenarios.json"), JSON.stringify(SCENARIOS));

    for (const [name, sc] of Object.entries(SCENARIOS)) {
      for (const dir of ["ltr", "rtl"] as const) {
        const locale = dir === "rtl" ? "ar" : "en";
        const heroIndex = sc.bannerFirst ? 1 : 0;
        const heroDesign: Record<string, unknown> = sc.plainHero
          ? {}
          : {
              background: {
                kind: "media",
                media: { mediaId: MEDIA_ID, decorative: true },
                ...(sc.heroOverlay
                  ? {
                      overlay: {
                        color: { hex: sc.heroOverlay.hex },
                        alpha: sc.heroOverlay.alpha,
                      },
                    }
                  : {}),
              },
              ...(sc.heroLayout ? { layout: sc.heroLayout } : {}),
            };
        const sections: Record<string, unknown>[] = [
          ...(sc.bannerFirst
            ? [
                {
                  id: "banner",
                  type: "banner",
                  visible: true,
                  content: { title: "Banner", subtitle: "", ctas: [] },
                },
              ]
            : []),
          {
            id: "hero",
            type: "hero",
            visible: true,
            content: {
              headline: "Overlay proof headline",
              subheadline: "A supporting line that explains the offer",
              ctas: [
                { label: "Shop now", href: "/products" },
                { label: "Learn more", href: "/about" },
              ],
            },
            ...(Object.keys(heroDesign).length ? { design: heroDesign } : {}),
          },
        ];
        const presentation = normalizePresentationConfig({
          version: 3,
          header: { design: sc.header },
          homepage: { sections },
        });
        const designContext = {
          primaryColor: presentation.primaryColor,
          accentColor: presentation.accentColor,
          palette: presentation.palette,
          dir,
        };
        const picName = sc.picture ?? "dark";
        const media =
          sc.noEvidence || sc.plainHero
            ? {}
            : {
                [`homepage.sections.${heroIndex}.design.background.media`]: {
                  width: 1600,
                  height: 900,
                  decorative: true,
                  alt: { ar: null, en: null },
                  sources: [
                    {
                      kind: "w",
                      width: 1600,
                      height: 900,
                      format: "jpg",
                      src: `../pic-${picName}.svg`,
                    },
                  ],
                  contrast: bounds(picName),
                },
              };
        const headerOverlay = publishedHeaderOverlay(
          presentation,
          media as never,
          designContext,
        );
        const base = {
          implemented: {} as never,
          basePath: "/sa/en",
          locale,
          apps: { iosUrl: "", androidUrl: "", appName: "" },
          benefitsTitle: "",
          featuredTitle: "",
          offersTitle: "",
          appTitle: "",
          appStoreLabel: "",
          playStoreLabel: "",
          media: media as never,
          headerOverlay,
          design: designContext,
        };
        const calls: Record<string, any>[] = [];
        await publishedNodes(presentation.homepage.sections, {
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
              locale,
              storeName: "Daisy Shop",
              headline: own ? own.headline : "",
              subheadline: own ? (own.subheadline ?? null) : "",
              ctas: own?.ctas ?? null,
              headingId: "home-hero",
              headingLevel: a.headingLevel,
              themePreset: "awj-market",
              designed: a.designed,
              backdrop: a.backdrop,
              designCtx: designContext,
            }),
          );
        }
        const nodes = await publishedNodes(presentation.homepage.sections, {
          ...base,
          renderHero: (a: Record<string, any>) => resolved.get(a.section.id),
        } as never);
        const header = await Header({
          basePath: "/sa/en",
          locale: locale as never,
          storeName: "Daisy Shop Flowers",
          logoUrl: null,
          compact: headerIsCompact(presentation.header),
          design: presentation.header.design,
          extraLinks: [
            { id: "a", label: "Offers", href: "/sa/en/offers" },
            { id: "b", label: "About us", href: "/sa/en/about" },
          ],
          mobileNavigation: (
            <button
              type="button"
              data-menu=""
              className="inline-flex"
              style={{ width: "2.5rem", height: "2.5rem" }}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                aria-hidden="true"
              >
                <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" />
              </svg>
            </button>
          ),
          categoryNavigation: (
            <nav
              data-rail=""
              className="border-b border-store-border bg-store-surface-muted hidden md:block"
            >
              <div style={{ height: "2.375rem" }}>
                <span className="text-store-muted-foreground">Categories</span>
              </div>
            </nav>
          ),
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
            <main
              id="main-content"
              className="flex-1 scroll-mt-(--store-header-offset)"
            >
              <StoreContainer
                className={publishedHomeStackClass(presentation.density)}
              >
                {nodes}
                <div data-proof-rest="" style={{ height: "2600px" }}>
                  more page
                </div>
              </StoreContainer>
            </main>
          </div>,
        );
        const html = `<!doctype html><html lang="${locale}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><style>:root{--store-primary:#12372a;--store-primary-foreground:#ffffff;--store-foreground:#111827;--store-muted-foreground:#4b5563;--store-border:#d1d5db;--store-surface:#ffffff;--store-surface-muted:#f3f4f6;--store-radius:14px}body{background:#f8f9fa;margin:0;font-family:system-ui,sans-serif}</style></head><body>${wrapper}</body></html>`;
        writeFileSync(join(DIR, "pages", `${name}.${dir}.html`), html);
        // the server's own decision, for the proof to cross-check
        writeFileSync(
          join(DIR, "pages", `${name}.${dir}.decision.json`),
          JSON.stringify(headerOverlay),
        );
      }
    }
    expect(true).toBe(true);
  });
});
