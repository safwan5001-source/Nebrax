/**
 * CUST-HV V6b-5 — renders the REAL published hero (`publishedNodes`, `SectionBackdrop`, the validated design
 * tokens) for every configuration the PHP exporter wrote (`StorefrontMediaPixelProofExportTest`), pointing
 * the picture at the files the server actually produced and carrying the server's own widened bounds.
 * Output: `<dir>/pages/<case>.<ltr|rtl>.html`, measured by `scripts/pixel-proof/measure.mjs` in Chromium.
 *
 * Inert unless PIXEL_PROOF_DIR is set (CI never runs it).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { publishedNodes } from "@/components/home/published-nodes";
import { backgroundMediaPath } from "@/lib/presentation/background-media";
import type { PresentationHomeSection } from "@/lib/presentation/config";
import type { ResolvedMedia } from "@/lib/presentation/media-ref";

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

const renderHero = ({
  section,
  headingLevel,
  designed,
  backdrop,
}: Record<string, any>) => {
  const H = headingLevel === 1 ? "h1" : "h2";
  return (
    <section
      aria-labelledby={`h-${section.id}`}
      className="flex items-center rounded-store bg-linear-to-r rtl:bg-linear-to-l from-primary-700 via-primary-600 to-primary-500 text-store-primary-foreground min-h-[11rem] md:min-h-[16rem] lg:min-h-[18rem]"
    >
      {backdrop}
      <div
        data-section-content={designed ? "" : undefined}
        className="max-w-2xl p-5 md:p-10 lg:p-14"
      >
        <H
          id={`h-${section.id}`}
          className="text-xl font-black leading-tight sm:text-2xl lg:text-4xl"
        >
          <bdi>Picture hero headline for the proof</bdi>
        </H>
        <p className="mt-2 line-clamp-2 text-xs text-store-primary-foreground/80 md:mt-3 md:text-sm">
          A supporting line that sits over the photograph
        </p>
        <a
          href="/products"
          className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-store bg-store-primary-foreground px-4 text-xs font-bold text-store-primary shadow-md md:mt-5 md:h-11 md:px-6 md:text-sm"
        >
          Shop now
        </a>
      </div>
    </section>
  );
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
        const nodes = await publishedNodes(sections, {
          implemented: {} as never,
          renderHero,
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
        } as never);
        const html = `<!doctype html><html lang="${dir === "rtl" ? "ar" : "en"}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><style>:root{--store-primary:#12372a;--store-primary-foreground:#ffffff;--store-foreground:#111827;--store-muted-foreground:#4b5563;--store-border:#e5e7eb;--store-surface:#ffffff;--store-radius:14px}body{background:#f8f9fa;margin:0;padding:16px;font-family:system-ui,sans-serif}</style></head><body>${renderToStaticMarkup(<>{nodes}</>)}</body></html>`;
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
