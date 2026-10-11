/**
 * CUST-HV V9c-1 — renders the REAL published Custom Content section (the production `publishedNodes` → `resolveContentBlocks` →
 * `CustomContentBand`, as static HTML) for every proof page × direction, for the browser proof in `scripts/content-proof/measure.mjs`.
 * Inert unless CONTENT_PROOF_DIR is set (CI never runs it); the directory must already hold `storefront.css`, `pics/` and `bounds.json`
 * (`node scripts/pixel-proof/build-css.mjs <dir>`, `node scripts/slider-proof/make-pictures.mjs <dir>`).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PresentationHomeSection } from "@/lib/presentation/config";
import type { ResolvedMedia } from "@/lib/presentation/media-ref";
import ar from "../../../../messages/ar.json";
import en from "../../../../messages/en.json";
import { publishedNodes } from "../published-nodes";

const DIR = process.env.CONTENT_PROOF_DIR ?? "";
const ID = (n: number) =>
  `0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d${String(n).padStart(2, "0")}`;

type Bounds = Record<string, { width: number; height: number }>;
type Copy = { en: string; ar: string };
const LONG: Copy = {
  en: "Supercalifragilisticexpialidocious-flowers-and-more-flowers-than-anybody-could-ever-possibly-need",
  ar: "ورودطازجةجداًتصلإلىبابككلصباحوتدومأطولبكثيرمماتتوقعهمنأيمتجرآخرفيالمدينةكلها",
};
const SHORT: Copy = {
  en: "Fresh flowers delivered the same day, wrapped by hand.",
  ar: "ورود طازجة تصل في اليوم نفسه، ومغلّفة يدوياً.",
};
const TITLE: Copy = { en: "Why customers love us", ar: "لماذا يحبنا عملاؤنا" };

interface Page {
  blocks: (l: "en" | "ar") => unknown[];
  /** [json path under blocks, picture] */
  pics: Array<[string, string]>;
  design?: PresentationHomeSection["design"];
}

const PAGES: Record<string, Page> = {
  mixed: {
    blocks: (l) => [
      { id: "h", kind: "heading", text: TITLE[l] },
      { id: "p", kind: "paragraph", text: `${SHORT[l]}\n${SHORT[l]}` },
      { id: "i", kind: "image", media: { mediaId: ID(1) }, caption: SHORT[l] },
      {
        id: "k",
        kind: "callout",
        text: SHORT[l],
        tone: "success",
        icon: "gift",
      },
      {
        id: "b",
        kind: "button",
        label: l === "ar" ? "تسوّق الآن" : "Shop now",
        href: "/products",
      },
      { id: "d", kind: "divider" },
      { id: "s", kind: "spacer", size: "lg" },
      { id: "w", kind: "paragraph", text: LONG[l] },
    ],
    pics: [["2.media", "light"]],
  },
  columns: {
    blocks: (l) => [
      {
        id: "c",
        kind: "columns",
        columns: [
          [
            { id: "c1h", kind: "heading", text: TITLE[l], level: 3 },
            { id: "c1p", kind: "paragraph", text: LONG[l] },
            {
              id: "c1b",
              kind: "button",
              label: l === "ar" ? "اعرف المزيد" : "Learn more",
              href: "/about",
              style: "outline",
            },
          ],
          [
            {
              id: "c2i",
              kind: "image",
              media: { mediaId: ID(2) },
              caption: SHORT[l],
            },
            { id: "c2k", kind: "callout", text: SHORT[l], tone: "warning" },
          ],
        ],
      },
      { id: "after", kind: "paragraph", text: SHORT[l] },
    ],
    pics: [["0.columns.1.0.media", "dark"]],
  },
  aligned: {
    blocks: (l) => [
      { id: "h1", kind: "heading", text: TITLE[l] },
      { id: "h2", kind: "heading", text: TITLE[l], align: "center" },
      { id: "h3", kind: "heading", text: TITLE[l], align: "end", level: 3 },
      { id: "p1", kind: "paragraph", text: SHORT[l] },
      { id: "p2", kind: "paragraph", text: SHORT[l], align: "center" },
      { id: "p3", kind: "paragraph", text: SHORT[l], align: "end" },
      { id: "d1", kind: "divider", style: "dots" },
      { id: "sp", kind: "spacer", size: "sm" },
    ],
    pics: [],
  },
  designed: {
    blocks: (l) => [
      { id: "h", kind: "heading", text: TITLE[l] },
      { id: "p", kind: "paragraph", text: SHORT[l] },
      {
        id: "k",
        kind: "callout",
        text: SHORT[l],
        tone: "success",
        icon: "badge-check",
      },
      {
        id: "b",
        kind: "button",
        label: l === "ar" ? "تسوّق الآن" : "Shop now",
        href: "/products",
        style: "outline",
      },
    ],
    pics: [],
    design: {
      background: { kind: "solid", color: { hex: "#12372a" } },
      spacing: { top: "md", bottom: "md" },
      radius: "lg",
    },
  },
};

describe("content blocks proof", () => {
  it.skipIf(!DIR)("renders every page × direction", async () => {
    mkdirSync(join(DIR, "pages"), { recursive: true });
    const css = readFileSync(join(DIR, "storefront.css"), "utf8");
    const bounds = JSON.parse(
      readFileSync(join(DIR, "bounds.json"), "utf8"),
    ) as Bounds;

    for (const [name, spec] of Object.entries(PAGES)) {
      for (const dir of ["ltr", "rtl"] as const) {
        const l = dir === "rtl" ? "ar" : "en";
        const messages = (l === "ar" ? ar : en).home.content;
        const media: Record<string, ResolvedMedia> = {};
        for (const [path, pic] of spec.pics) {
          media[`homepage.sections.0.content.blocks.${path}`] = {
            width: bounds[pic].width,
            height: bounds[pic].height,
            decorative: false,
            alt: { ar: "صورة", en: "Picture" },
            sources: (["webp", "jpg"] as const).map((format) => ({
              kind: "w" as const,
              width: bounds[pic].width,
              height: bounds[pic].height,
              format,
              src: `../pics/${pic}.png`,
            })),
          };
        }
        const section = {
          id: "cc",
          type: "customContent",
          visible: true,
          content: { blocks: spec.blocks(l) },
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
          contentLabels: { ...messages },
        } as never);
        expect(nodes).toHaveLength(1);
        const html = `<!doctype html><html lang="${l}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><style>:root{--store-primary:#12372a;--store-primary-foreground:#ffffff;--store-accent:#ffd166;--store-foreground:#111827;--store-muted-foreground:#4b5563;--store-border:#d1d5db;--store-surface:#ffffff;--store-radius:14px}body{background:#f8f9fa;margin:0;font-family:system-ui,sans-serif}#stack{max-width:85rem;margin-inline:auto;padding:16px}</style></head><body><div id="stack"><div id="host">${renderToStaticMarkup(nodes[0])}</div><div style="min-height:300px">page content below</div></div></body></html>`;
        writeFileSync(join(DIR, "pages", `${name}.${dir}.html`), html);
      }
    }
  });
});
