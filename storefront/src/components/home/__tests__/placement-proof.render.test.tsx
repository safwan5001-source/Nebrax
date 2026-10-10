/**
 * CUST-HV V6c-3 — renders the REAL published hero (the production `HeroSection`) and banner (`BannerBand`) through
 * `publishedNodes` with a height preset × a 3×3 content position, for the browser proof in
 * `scripts/placement-proof/measure.mjs`. Inert unless PLACEMENT_PROOF_DIR is set (CI never runs it).
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

const DIR = process.env.PLACEMENT_PROOF_DIR ?? "";

const HEIGHTS = [undefined, "compact", "standard", "tall", "screen"] as const;
// [id, align (inline), valign (block)] — the three corners that tell the axes apart, the centre, and "unset"
const PLACEMENTS = [
  ["auto", undefined, undefined],
  ["top-start", "start", "start"],
  ["mid-center", "center", "center"],
  ["bottom-end", "end", "end"],
] as const;

describe("placement proof", () => {
  it.skipIf(!DIR)("renders hero and banner × height × position", async () => {
    mkdirSync(join(DIR, "pages"), { recursive: true });
    const css = readFileSync(join(DIR, "storefront.css"), "utf8");
    for (const type of ["hero", "banner"] as const) {
      for (const height of HEIGHTS) {
        for (const [pid, align, valign] of PLACEMENTS) {
          const design: Record<string, unknown> = {};
          if (align) design.align = align;
          if (valign) design.valign = valign;
          if (height) design.mediaTreatment = { height };
          const section = {
            id: type,
            type,
            visible: true,
            content:
              type === "hero"
                ? {
                    headline: "Placement proof headline",
                    subheadline: "A supporting line",
                    ctas: [{ label: "Shop now", href: "/products" }],
                  }
                : {
                    title: "Placement proof banner",
                    subtitle: "A supporting line",
                    ctas: [
                      { label: "Shop now", href: "/products" },
                      { label: "Learn more", href: "/about" },
                    ],
                    ctaLabel: "",
                    ctaHref: "",
                    imageUrl: null,
                  },
            ...(Object.keys(design).length ? { design } : {}),
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
                <StoreContainer className={publishedHomeStackClass(undefined)}>
                  {nodes}
                </StoreContainer>
              </main>,
            )}</body></html>`;
            writeFileSync(
              join(
                DIR,
                "pages",
                `${type}.${height ?? "none"}.${pid}.${dir}.html`,
              ),
              html,
            );
          }
        }
      }
    }
    expect(true).toBe(true);
  });
});
