/**
 * CUST-HV V6b-5 — renders the REAL published hero (`publishedNodes`, the production `HeroSection`, `SectionBackdrop`,
 * the validated design tokens; only `next-intl/server` is answered from the real `messages/*.json`) for every configuration the PHP exporter wrote (`StorefrontMediaPixelProofExportTest`), pointing
 * the picture at the files the server actually produced and carrying the server's own widened bounds.
 * Output: `<dir>/pages/<case>.<ltr|rtl>.html`, measured by `scripts/pixel-proof/measure.mjs` in Chromium.
 *
 * Inert unless PIXEL_PROOF_DIR is set (CI never runs it).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HeroSection } from "@/components/home/HeroSection";
import { publishedNodes } from "@/components/home/published-nodes";
import { StoreContainer } from "@/components/layout/StoreContainer";
import { backgroundMediaPath } from "@/lib/presentation/background-media";
import type { PresentationHomeSection } from "@/lib/presentation/config";
import type { ResolvedMedia } from "@/lib/presentation/media-ref";
import { publishedHomeStackClass } from "@/lib/presentation/public-rhythm";
import { heroContentOf } from "@/lib/presentation/section-content";
import ar from "../../../messages/ar.json";
import en from "../../../messages/en.json";

// `getTranslations` needs Next's request scope; answer it from the real message files so the production
// component renders its real copy (no test-local strings, no test-local markup).
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
    return (key: string, values?: Record<string, string>) =>
      (table[key] ?? key).replace(
        /\{(\w+)\}/g,
        (_, k: string) => values?.[k] ?? "",
      );
  },
}));

const DIR = process.env.PIXEL_PROOF_DIR ?? "";

type Bounds = {
  min: [number, number, number];
  max: [number, number, number];
} | null;
type FileRow = { width: number; height: number; format: string; path: string };
type Case = {
  id: string;
  /** what the publish gate judged and what the storefront stores: the NORMALIZED background */
  normalized: Record<string, unknown>;
  provable: boolean;
  bounds: { media: Bounds; mobile: Bounds };
  files: { media: FileRow[]; mobile: FileRow[] | null };
};

const resolvedOf = (files: FileRow[], bounds: Bounds): ResolvedMedia => {
  const natural = files.reduce((a, f) => (f.width > a.width ? f : a), files[0]);
  return {
    width: natural.width,
    height: natural.height,
    decorative: true,
    alt: { ar: null, en: null },
    sources: files.map((f) => ({
      kind: "w" as const,
      width: f.width,
      height: f.height,
      format: (f.format === "jpeg" ? "jpg" : f.format) as "webp" | "jpg",
      src: `../${f.path}`,
    })),
    ...(bounds ? { contrast: bounds } : {}),
  };
};

describe.skipIf(!DIR)("V6b-5 pixel-proof pages", () => {
  it("renders one page per case and direction", async () => {
    const css = readFileSync(join(DIR, "storefront.css"), "utf8");
    const cases = (
      JSON.parse(readFileSync(join(DIR, "manifest.json"), "utf8")) as {
        cases: Case[];
      }
    ).cases;
    mkdirSync(join(DIR, "pages"), { recursive: true });
    // Negative control: the configurations the gate REJECTED, rendered with deliberately false (too dark) bounds. The
    // storefront trusts the evidence it is given, so it paints them — and the browser measurement must then see the
    // readability failure. This proves the measurement can fail (it is not vacuous).
    const LIE = { min: [0, 0, 0], max: [20, 20, 20] } as Bounds;
    const jobs = [
      ...cases.map((c) => ({ c, lie: false })),
      ...cases
        .filter((c) => !c.provable && c.files.mobile === null)
        .map((c) => ({ c, lie: true })),
    ];
    for (const { c, lie } of jobs) {
      const sections = [
        {
          id: "hero",
          type: "hero",
          visible: true,
          content: {
            headline: "Picture hero headline for the proof",
            subheadline: "A supporting line that sits over the photograph",
            ctas: [{ label: "Shop now", href: "/products" }],
          },
          design: { background: c.normalized },
        },
      ] as unknown as PresentationHomeSection[];
      const media: Record<string, ResolvedMedia> = {
        [backgroundMediaPath(0, "media")]: resolvedOf(
          c.files.media,
          lie ? LIE : c.bounds.media,
        ),
      };
      if (c.files.mobile)
        media[backgroundMediaPath(0, "mobile")] = resolvedOf(
          c.files.mobile,
          c.bounds.mobile,
        );
      for (const dir of ["ltr", "rtl"] as const) {
        // The page's own prop mapping (`app/[country]/[locale]/(storefront)/page.tsx`) feeds the PRODUCTION hero.
        // `HeroSection` is an async server component, so pass 1 collects the arguments `publishedNodes` hands the
        // renderer, the component is awaited, and pass 2 renders the very same tree with the resolved elements.
        const base = {
          implemented: {} as never,
          media,
          basePath: "/sa/en",
          locale: dir === "rtl" ? "ar" : "en",
          apps: { iosUrl: "", androidUrl: "", appName: "" },
          benefitsTitle: "",
          featuredTitle: "",
          offersTitle: "",
          appTitle: "",
          appStoreLabel: "",
          playStoreLabel: "",
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
              headingId:
                a.section.id === "hero"
                  ? "home-hero"
                  : `home-hero-${a.section.id}`,
              headingLevel: a.headingLevel,
              themePreset: "awj-market",
              designed: a.designed,
              backdrop: a.backdrop,
            }),
          );
        }
        const nodes = await publishedNodes(sections, {
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
            `${c.id.replace(/[^a-z0-9+-]+/gi, "_")}${lie ? ".lie" : ""}.${dir}.html`,
          ),
          html,
        );
      }
    }
    expect(cases.length).toBeGreaterThan(0);
  });
});
