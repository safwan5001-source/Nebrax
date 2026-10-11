/**
 * CUST-HV V8b — renders the REAL published slider (the production `publishedNodes` → `resolveSlider` → `HomeSlider`, as static HTML) for every
 * proof page × direction, for the browser proof in `scripts/slider-proof/measure.mjs`. The page also carries the exact props the production
 * component received, so `scripts/slider-proof/mount.tsx` can client-render the REAL component over the static markup. Inert unless
 * SLIDER_PROOF_DIR is set (CI never runs it); the directory must already hold `storefront.css`, `pics/` and `bounds.json`
 * (`node scripts/pixel-proof/build-css.mjs <dir>`, `node scripts/slider-proof/make-pictures.mjs <dir>`).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HomeSlider } from "@/components/home/HomeSlider";
import type { PresentationHomeSection } from "@/lib/presentation/config";
import type { ResolvedMedia } from "@/lib/presentation/media-ref";
import { slidePicturePath } from "@/lib/presentation/slider-resolve";
import ar from "../../../../messages/ar.json";
import en from "../../../../messages/en.json";
import { publishedNodes } from "../published-nodes";

const DIR = process.env.SLIDER_PROOF_DIR ?? "";
const ID = (n: number) =>
  `0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d${String(n).padStart(2, "0")}`;

type Bounds = Record<
  string,
  { width: number; height: number; min: number[]; max: number[] }
>;
type Slide = Record<string, unknown>;
interface PageSpec {
  slides: Array<{
    pic: keyof Bounds | string;
    phone?: string;
    withoutBounds?: boolean;
    extra?: Slide;
  }>;
  behaviour?: Slide;
  design?: PresentationHomeSection["design"];
}

const COPY = {
  en: [
    [
      "Spring in bloom",
      "Fresh flowers, delivered to your door every morning.",
      "Shop spring",
    ],
    [
      "Same-day delivery",
      "Order before noon and we deliver the same day across the city.",
      "Order now",
    ],
    [
      "Gifts that last",
      "Boxes, plants and keepsakes for every occasion.",
      "See gifts",
    ],
    [
      "Weddings and events",
      "Arrangements designed around your colours and your venue.",
      "Plan an event",
    ],
    [
      "Subscriptions",
      "A fresh bunch every week — pause or skip whenever you like.",
      "Subscribe",
    ],
    [
      "Corporate",
      "Reception, offices and hotels, on a standing schedule.",
      "Get a quote",
    ],
    [
      "Care guides",
      "Make your flowers last twice as long with a few simple habits.",
      "Read more",
    ],
    [
      "New arrivals",
      "The season's first tulips, ranunculus and peonies.",
      "Discover",
    ],
  ],
  ar: [
    ["الربيع في أبهى صوره", "ورود طازجة تصل إلى بابك كل صباح.", "تسوّق الربيع"],
    [
      "توصيل في اليوم نفسه",
      "اطلب قبل الظهر ونوصّل في اليوم نفسه داخل المدينة.",
      "اطلب الآن",
    ],
    ["هدايا تدوم", "صناديق ونباتات وتذكارات لكل مناسبة.", "شاهد الهدايا"],
    [
      "الأعراس والمناسبات",
      "تنسيقات مصمَّمة حول ألوانك ومكان الحفل.",
      "خطّط لمناسبتك",
    ],
    ["الاشتراكات", "باقة طازجة كل أسبوع — أوقف أو تخطَّ متى شئت.", "اشترك"],
    ["الشركات", "الاستقبال والمكاتب والفنادق بجدول ثابت.", "احصل على عرض"],
    ["أدلة العناية", "اجعل ورودك تدوم ضعف المدة بعادات بسيطة.", "اقرأ المزيد"],
    ["وصل حديثاً", "أولى توليب وأقحوان وفاوانيا الموسم.", "اكتشف"],
  ],
};
const LONG = {
  en: "Supercalifragilisticexpialidocious-flowers-and-more-flowers-than-anybody-could-ever-possibly-need-in-one-single-week",
  ar: "ورودطازجةجداًتصلإلىبابككلصباحوتدومأطولبكثيرمماتتوقعهمنأيمتجرآخرفيالمدينةكلها",
};

const PAGES: Record<string, PageSpec> = {
  basic: { slides: [{ pic: "dark" }, { pic: "dark2" }, { pic: "dark" }] },
  light: { slides: [{ pic: "light" }, { pic: "light" }] },
  wash: {
    slides: [
      {
        pic: "wide",
        extra: { overlay: { color: { hex: "#000000" }, alpha: 70 } },
      },
      {
        pic: "wide",
        extra: { overlay: { color: { hex: "#000000" }, alpha: 70 } },
      },
    ],
  },
  align: {
    slides: [
      { pic: "dark", extra: { align: "start" } },
      { pic: "dark2", extra: { align: "center" } },
      { pic: "dark", extra: { align: "end" } },
    ],
  },
  fade: {
    slides: [{ pic: "dark" }, { pic: "dark2" }],
    behaviour: { transition: "fade", duration: "fast" },
  },
  none: {
    slides: [{ pic: "dark" }, { pic: "dark2" }],
    behaviour: { transition: "none" },
  },
  auto: {
    slides: [{ pic: "dark" }, { pic: "dark2" }, { pic: "dark" }],
    behaviour: { autoplay: true, interval: 5, loop: true },
  },
  phone: {
    slides: [
      { pic: "dark", phone: "phone" },
      { pic: "dark2", phone: "phone" },
    ],
  },
  long: {
    slides: Array.from({ length: 8 }, (_, i) => ({
      pic: i % 2 ? "dark2" : "dark",
      extra: i === 0 ? { heading: "LONG" } : {},
    })),
  },
  single: { slides: [{ pic: "dark" }] },
  withheld: {
    slides: [{ pic: "dark", withoutBounds: true }, { pic: "dark2" }],
  },
  designed: {
    slides: [{ pic: "dark" }, { pic: "dark2" }],
    design: {
      background: { kind: "solid", color: { role: "surface" } },
      spacing: { top: "md", bottom: "md" },
      radius: "lg",
      border: { width: "hairline" },
      mediaTreatment: { height: "tall" },
    },
  },
};

function findSlider(node: ReactNode): ReactElement | null {
  if (!isValidElement(node)) return null;
  if (node.type === HomeSlider) return node;
  const children = (node.props as { children?: ReactNode }).children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const hit = findSlider(child);
    if (hit) return hit;
  }
  return null;
}

describe("slider proof", () => {
  it.skipIf(!DIR)("renders every page × direction", async () => {
    mkdirSync(join(DIR, "pages"), { recursive: true });
    const css = readFileSync(join(DIR, "storefront.css"), "utf8");
    const bounds = JSON.parse(
      readFileSync(join(DIR, "bounds.json"), "utf8"),
    ) as Bounds;

    for (const [name, spec] of Object.entries(PAGES)) {
      for (const dir of ["ltr", "rtl"] as const) {
        const l = dir === "rtl" ? "ar" : "en";
        const messages = (l === "ar" ? ar : en).home.slider;
        const media: Record<string, ResolvedMedia> = {};
        const slides = spec.slides.map((s, j) => {
          const copy = COPY[l][j % COPY[l].length] as string[];
          const picture = (
            pic: string,
            withBounds: boolean,
          ): ResolvedMedia => ({
            width: bounds[pic].width,
            height: bounds[pic].height,
            decorative: false,
            alt: { ar: "صورة الشريحة", en: "Slide picture" },
            sources: (["webp", "jpg"] as const).map((format) => ({
              kind: "w" as const,
              width: bounds[pic].width,
              height: bounds[pic].height,
              format,
              src: `../pics/${pic}.png`,
            })),
            ...(withBounds
              ? {
                  contrast: {
                    min: bounds[pic].min as [number, number, number],
                    max: bounds[pic].max as [number, number, number],
                  },
                }
              : {}),
          });
          media[slidePicturePath(0, j, "media")] = picture(
            s.pic as string,
            !s.withoutBounds,
          );
          if (s.phone)
            media[slidePicturePath(0, j, "mobile")] = picture(s.phone, true);
          return {
            id: `s${j + 1}`,
            media: { mediaId: ID(j) },
            ...(s.phone
              ? { mobile: { mediaId: ID(50 + j), decorative: true } }
              : {}),
            heading: s.extra?.heading === "LONG" ? LONG[l] : copy[0],
            sub: copy[1],
            cta: { label: copy[2], href: `/c/slide-${j + 1}` },
            ...(s.extra && "heading" in s.extra ? {} : (s.extra ?? {})),
          };
        });
        const section = {
          id: "sl",
          type: "slider",
          visible: true,
          content: {
            slides,
            ...(spec.behaviour ? { behaviour: spec.behaviour } : {}),
          },
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
          sliderLabels: {
            label: messages.label,
            slide: messages.slide,
            previous: messages.previous,
            next: messages.next,
            goTo: messages.goTo,
            pause: messages.pause,
            play: messages.play,
            choose: messages.choose,
          },
        } as never);
        expect(nodes).toHaveLength(1);
        const element = findSlider(nodes[0]);
        expect(element, `${name}.${dir}: a slider element`).not.toBeNull();
        const html = `<!doctype html><html lang="${l}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><style>:root{--store-primary:#12372a;--store-primary-foreground:#ffffff;--store-accent:#ffd166;--store-foreground:#111827;--store-muted-foreground:#4b5563;--store-border:#d1d5db;--store-surface:#ffffff;--store-radius:14px}body{background:#f8f9fa;margin:0;font-family:system-ui,sans-serif}#stack{max-width:85rem;margin-inline:auto;padding:16px}</style></head><body><div id="stack"><div id="host">${renderToStaticMarkup(nodes[0])}</div><div style="min-height:400px">page content below the slider</div></div><script id="slider-props" type="application/json">${JSON.stringify(element?.props).replace(/</g, "\\u003c")}</script><script src="../mount.js"></script></body></html>`;
        writeFileSync(join(DIR, "pages", `${name}.${dir}.html`), html);
      }
    }
  });
});
