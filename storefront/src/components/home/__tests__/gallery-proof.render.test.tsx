/**
 * CUST-HV V8e — renders the REAL published gallery (the production `publishedNodes` → `resolveGallery` → `HomeGallery`, as static HTML) for
 * every proof page × direction, for the browser proof in `scripts/gallery-proof/measure.mjs`. The page also carries the exact props the
 * production component received, so `scripts/gallery-proof/mount.tsx` can client-render the REAL component over the static markup. Inert
 * unless GALLERY_PROOF_DIR is set (CI never runs it); the directory must already hold `storefront.css`, `pics/` and `bounds.json`
 * (`node scripts/pixel-proof/build-css.mjs <dir>`, `node scripts/slider-proof/make-pictures.mjs <dir>`).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HomeGallery } from "@/components/home/HomeGallery";
import { galleryImagePath } from "@/lib/presentation/gallery-resolve";
import type { PresentationHomeSection } from "@/lib/presentation/config";
import type { ResolvedMedia } from "@/lib/presentation/media-ref";
import ar from "../../../../messages/ar.json";
import en from "../../../../messages/en.json";
import { publishedNodes } from "../published-nodes";

const DIR = process.env.GALLERY_PROOF_DIR ?? "";
const ID = (n: number) =>
  `0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d${String(n).padStart(2, "0")}`;

type Bounds = Record<string, { width: number; height: number }>;
interface PageSpec {
  count: number;
  pics: string[];
  options?: Record<string, unknown>;
  design?: PresentationHomeSection["design"];
  per?: (i: number) => Record<string, unknown>;
}

const CAPTIONS = {
  en: ["Spring in bloom", "Same-day delivery", "Gifts that last", "Weddings and events", "Subscriptions", "Corporate", "Care guides", "New arrivals", "Sympathy", "Plants", "Bouquets", "Boxes"],
  ar: ["الربيع في أبهى صوره", "توصيل في اليوم نفسه", "هدايا تدوم", "الأعراس والمناسبات", "الاشتراكات", "الشركات", "أدلة العناية", "وصل حديثاً", "المواساة", "النباتات", "الباقات", "الصناديق"],
};
const LONG = {
  en: "Supercalifragilisticexpialidocious-flowers-and-more-flowers-than-anybody-could-ever-possibly-need",
  ar: "ورودطازجةجداًتصلإلىبابككلصباحوتدومأطولبكثيرمماتتوقعهمنأيمتجرآخرفيالمدينةكلها",
};

const PAGES: Record<string, PageSpec> = {
  grid3: { count: 6, pics: ["dark", "light", "dark2"], options: { captions: true } },
  grid6: { count: 12, pics: ["dark", "light", "dark2", "phone"], options: { columns: 6, gap: "sm", aspect: "4:3", captions: true } },
  grid2: {
    count: 5,
    pics: ["dark", "phone", "light"],
    options: { columns: 2, gap: "xl", aspect: "4:5", captions: true },
    per: (i) => (i === 1 ? { caption: "LONG" } : {}),
  },
  contain: {
    count: 4,
    pics: ["phone", "dark", "light"],
    options: { aspect: "16:9", gap: "none" },
    per: (i) => ({ media: { fit: i % 2 === 0 ? "contain" : undefined, focal: { x: 20, y: 80 } } }),
  },
  strip: { count: 8, pics: ["dark", "light", "dark2"], options: { columns: 4, captions: true }, design: { layout: "carousel" } },
  viewer: {
    count: 6,
    pics: ["dark", "light", "dark2", "phone"],
    options: { columns: 3, captions: true, lightbox: true },
    per: (i) => (i === 3 ? { link: "/c/linked" } : {}),
  },
  viewerStrip: {
    count: 7,
    pics: ["dark", "phone", "light"],
    options: { columns: 4, captions: true, lightbox: true },
    design: { layout: "carousel" },
  },
  designed: {
    count: 6,
    pics: ["dark", "light", "dark2"],
    options: { captions: true },
    design: {
      background: { kind: "solid", color: { hex: "#12372a" } },
      spacing: { top: "md", bottom: "md" },
      radius: "lg",
    },
  },
};

function findGallery(node: ReactNode): ReactElement | null {
  if (!isValidElement(node)) return null;
  if (node.type === HomeGallery) return node;
  const children = (node.props as { children?: ReactNode }).children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const hit = findGallery(child);
    if (hit) return hit;
  }
  return null;
}

describe("gallery proof", () => {
  it.skipIf(!DIR)("renders every page × direction", async () => {
    mkdirSync(join(DIR, "pages"), { recursive: true });
    const css = readFileSync(join(DIR, "storefront.css"), "utf8");
    const bounds = JSON.parse(readFileSync(join(DIR, "bounds.json"), "utf8")) as Bounds;

    for (const [name, spec] of Object.entries(PAGES)) {
      for (const dir of ["ltr", "rtl"] as const) {
        const l = dir === "rtl" ? "ar" : "en";
        const messages = (l === "ar" ? ar : en).home.gallery;
        const media: Record<string, ResolvedMedia> = {};
        const images = Array.from({ length: spec.count }, (_, i) => {
          const pic = spec.pics[i % spec.pics.length];
          const extra = spec.per?.(i) ?? {};
          media[galleryImagePath(0, i)] = {
            width: bounds[pic].width,
            height: bounds[pic].height,
            decorative: false,
            alt: { ar: `صورة ${i + 1}`, en: `Picture ${i + 1}` },
            sources: (["webp", "jpg"] as const).flatMap((format) =>
              [bounds[pic].width / 2, bounds[pic].width].map((width) => ({
                kind: "w" as const,
                width,
                height: Math.round((width * bounds[pic].height) / bounds[pic].width),
                format,
                src: `../pics/${pic}.png`,
              })),
            ),
          };
          const { media: mediaExtra, caption, ...rest } = extra as {
            media?: Record<string, unknown>;
            caption?: string;
          };
          return {
            id: `i${i + 1}`,
            media: { mediaId: ID(i), ...(mediaExtra ?? {}) },
            caption: caption === "LONG" ? LONG[l] : CAPTIONS[l][i % CAPTIONS[l].length],
            ...rest,
          };
        });
        const section = {
          id: "ga",
          type: "gallery",
          visible: true,
          content: { images, ...(spec.options ? { options: spec.options } : {}) },
          ...(spec.design ? { design: spec.design } : {}),
        } as unknown as PresentationHomeSection;

        const nodes = await publishedNodes([section], {
          implemented: {},
          media,
          basePath: "/sa/en",
          locale: l,
          apps: { iosUrl: "", androidUrl: "", appName: "" },
          benefitsTitle: "b",
          featuredTitle: "f",
          offersTitle: "o",
          appTitle: "a",
          appStoreLabel: "as",
          playStoreLabel: "ps",
          design: { primaryColor: "#12372a", accentColor: null, dir },
          galleryLabels: { ...messages },
        } as never);
        expect(nodes).toHaveLength(1);
        const element = findGallery(nodes[0]);
        expect(element, `${name}.${dir}: a gallery element`).not.toBeNull();
        const html = `<!doctype html><html lang="${l}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><style>:root{--store-primary:#12372a;--store-primary-foreground:#ffffff;--store-accent:#ffd166;--store-foreground:#111827;--store-muted-foreground:#4b5563;--store-border:#d1d5db;--store-surface:#ffffff;--store-radius:14px}body{background:#f8f9fa;margin:0;font-family:system-ui,sans-serif}#stack{max-width:85rem;margin-inline:auto;padding:16px}</style></head><body><div id="stack"><div id="host">${renderToStaticMarkup(nodes[0])}</div><div style="min-height:600px">page content below the gallery</div></div><script id="gallery-props" type="application/json">${JSON.stringify(element?.props).replace(/</g, "\\u003c")}</script><script src="../mount.js"></script></body></html>`;
        writeFileSync(join(DIR, "pages", `${name}.${dir}.html`), html);
      }
    }
  });
});
