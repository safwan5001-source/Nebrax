/**
 * CUST-HV V6c-6 — renders the REAL published hero (the production `HeroSection`) and banner (`BannerBand`) through
 * `publishedNodes` for every per-CTA `style` × `colour`, on the default surface, a solid design background and a proven
 * picture background (and, for the banner, under the global button tokens), for the browser proof in
 * `scripts/cta-colour-proof/measure.mjs`. Each page carries a sidecar with the paint the renderer should produce and the
 * publish gate's verdict, so the browser can check the verdict against the pixels. Inert unless CTA_COLOUR_PROOF_DIR is set.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { StoreContainer } from "@/components/layout/StoreContainer";
import type { PresentationHomeSection } from "@/lib/presentation/config";
import {
  ctaColourIssues,
  ctaPaint,
  effectiveCtaStyle,
} from "@/lib/presentation/cta-colour";
import { resolveGlobalTokens } from "@/lib/presentation/global-tokens";
import { publishedHomeStackClass } from "@/lib/presentation/public-rhythm";
import { heroContentOf } from "@/lib/presentation/section-content";
import { normalizeSectionDesign } from "@/lib/presentation/section-design";
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

const DIR = process.env.CTA_COLOUR_PROOF_DIR ?? "";
const MEDIA_ID = "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e";
const BOUNDS = { min: [0, 0, 0], max: [40, 50, 60] };
const RESOLVED = {
  "homepage.sections.0.design.background.media": {
    width: 1600,
    height: 900,
    decorative: true,
    alt: { ar: null, en: null },
    sources: [
      { kind: "w", width: 1600, height: 900, format: "jpg", src: "../bg.svg" },
    ],
    contrast: BOUNDS,
  },
};
const STYLES = ["solid", "soft", "outline", "link"] as const;
const COLOURS = ["brand", "accent", "text"] as const;
const DESIGNS: Record<
  string,
  (type: string) => Record<string, unknown> | undefined
> = {
  plain: () => undefined,
  solid: (type) => ({
    background: {
      kind: "solid",
      color: { hex: type === "hero" ? "#f3f4f6" : "#0b1d2a" },
    },
  }),
  picture: () => ({
    background: {
      kind: "media",
      media: { mediaId: MEDIA_ID, decorative: true },
      overlay: { color: { hex: "#000000" }, alpha: 40 },
    },
  }),
};
const DESIGN_CTX = {
  primaryColor: "#12372a",
  accentColor: "#ffd166",
  dir: "ltr" as const,
};

describe("cta colour proof", () => {
  it.skipIf(!DIR)(
    "renders hero and banner × surface × style × colour × direction",
    async () => {
      mkdirSync(join(DIR, "pages"), { recursive: true });
      const css = readFileSync(join(DIR, "storefront.css"), "utf8");
      writeFileSync(
        join(DIR, "bg.svg"),
        '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b1d2a"/><stop offset="1" stop-color="#28323c"/></linearGradient></defs><rect width="1600" height="900" fill="url(#g)"/></svg>',
      );
      for (const type of ["hero", "banner"] as const) {
        for (const kind of Object.keys(DESIGNS)) {
          for (const style of STYLES) {
            for (const colour of COLOURS) {
              for (const dir of ["ltr", "rtl"] as const) {
                for (const gt of [false, true]) {
                  // the global tokens only matter for the banner (its buttons are reached by them), and one direction is enough
                  if (gt && (type === "hero" || dir === "rtl")) continue;
                  const ctas = [
                    { label: "Shop now", href: "/products", style, colour },
                    { label: "Learn more", href: "/about", style, colour },
                  ];
                  const rawDesign = DESIGNS[kind](type);
                  const design = rawDesign
                    ? (normalizeSectionDesign(type, rawDesign) ?? undefined)
                    : undefined;
                  const section = {
                    id: type,
                    type,
                    visible: true,
                    content:
                      type === "hero"
                        ? {
                            headline: "Colour proof headline",
                            subheadline: "A supporting line",
                            ctas,
                          }
                        : {
                            title: "Colour proof banner",
                            subtitle: "A supporting line",
                            ctas,
                            ctaLabel: "",
                            ctaHref: "",
                            imageUrl: null,
                          },
                    ...(rawDesign ? { design: rawDesign } : {}),
                  } as unknown as PresentationHomeSection;
                  const designCtx = { ...DESIGN_CTX, dir };
                  const gate = ctaColourIssues(type, ctas, design, {
                    ...designCtx,
                    mediaBounds: () => ({
                      min: BOUNDS.min as [number, number, number],
                      max: BOUNDS.max as [number, number, number],
                    }),
                  });
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
                    renderHero: (a: Record<string, any>) =>
                      resolved.get(a.section.id),
                  } as never);
                  const tokens = gt
                    ? resolveGlobalTokens(
                        {
                          buttons: {
                            size: "lg",
                            radius: "pill",
                            style: "outline",
                            colour: "text",
                          },
                        } as never,
                        designCtx,
                      )
                    : null;
                  const wrapperStyle = tokens
                    ? Object.entries(tokens.style)
                        .map(([k, v]) => `${k}:${v}`)
                        .join(";")
                    : "";
                  const html = `<!doctype html><html lang="${dir === "rtl" ? "ar" : "en"}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><style>:root{--store-primary:#12372a;--store-primary-foreground:#ffffff;--store-accent:#ffd166;--store-foreground:#111827;--store-muted-foreground:#4b5563;--store-border:#e5e7eb;--store-surface:#ffffff;--store-radius:14px}body{background:#f8f9fa;margin:0;font-family:system-ui,sans-serif}</style></head><body><div ${tokens ? `data-gt="${tokens.attrs["data-gt"] ?? ""}" style="${wrapperStyle}"` : ""}>${renderToStaticMarkup(
                    <main id="main-content">
                      <StoreContainer
                        className={publishedHomeStackClass(undefined)}
                      >
                        {nodes}
                      </StoreContainer>
                    </main>,
                  )}</div></body></html>`;
                  const name = `${type}.${kind}.${style}.${colour}.${dir}${gt ? ".gt" : ""}`;
                  writeFileSync(join(DIR, "pages", `${name}.html`), html);
                  writeFileSync(
                    join(DIR, "pages", `${name}.json`),
                    JSON.stringify({
                      gate,
                      paint: ctas.map((c, i) => ({
                        style: effectiveCtaStyle(c.style, i),
                        ...ctaPaint(
                          effectiveCtaStyle(c.style, i),
                          c.colour,
                          designCtx,
                        ),
                      })),
                    }),
                  );
                }
              }
            }
          }
        }
      }
      expect(true).toBe(true);
    },
  );
});
