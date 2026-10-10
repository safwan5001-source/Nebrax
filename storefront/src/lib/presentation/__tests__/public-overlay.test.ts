import { describe, expect, it } from "vitest";
import { normalizePresentationConfig } from "../config";
import type { ResolvedMedia } from "../media-ref";
import { publishedHeaderOverlay } from "../public-overlay";

const ID = "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e";
const DARK = { min: [0, 0, 0], max: [40, 50, 60] } as const;

const media = (contrast?: {
  min: readonly number[];
  max: readonly number[];
}) => ({
  "homepage.sections.0.design.background.media": {
    width: 1600,
    height: 900,
    decorative: true,
    alt: { ar: null, en: null },
    sources: [
      { kind: "w", width: 800, height: 450, format: "jpg", src: "/m/800w.jpg" },
    ],
    ...(contrast ? { contrast } : {}),
  } as unknown as ResolvedMedia,
});

const presentation = (
  header: Record<string, unknown> | undefined,
  design: Record<string, unknown> = {
    background: { kind: "media", media: { mediaId: ID, decorative: true } },
  },
) =>
  normalizePresentationConfig({
    version: 3,
    ...(header ? { header: { design: header } } : {}),
    homepage: {
      sections: [
        {
          id: "hero",
          type: "hero",
          visible: true,
          content: { headline: "H", subheadline: "S", ctas: [] },
          design,
        },
      ],
    },
  });
const ctx = (p: ReturnType<typeof presentation>) => ({
  primaryColor: p.primaryColor,
  accentColor: p.accentColor,
  palette: p.palette,
  dir: "ltr" as const,
});

describe("publishedHeaderOverlay (V7c-2)", () => {
  const OV = { mode: "overlay-hero" };

  it("decides overlay for an opted-in header over a proven dark picture hero", () => {
    const p = presentation(OV);
    expect(publishedHeaderOverlay(p, media(DARK) as never, ctx(p))).toEqual({
      sectionId: "hero",
      tone: "light",
      fg: "#ffffff",
    });
  });

  it("is null without a presentation or context (the default storefront)", () => {
    const p = presentation(OV);
    expect(publishedHeaderOverlay(null, {}, ctx(p))).toBeNull();
    expect(
      publishedHeaderOverlay(p, media(DARK) as never, undefined),
    ).toBeNull();
  });

  it("is null when the header did not opt in", () => {
    for (const header of [
      undefined,
      { layout: "centered" },
      { mode: "solid" },
    ]) {
      const p = presentation(header);
      expect(
        publishedHeaderOverlay(p, media(DARK) as never, ctx(p)),
      ).toBeNull();
    }
  });

  it("is null when the server published no contrast evidence for the picture", () => {
    const p = presentation(OV);
    expect(publishedHeaderOverlay(p, media() as never, ctx(p))).toBeNull();
    expect(publishedHeaderOverlay(p, {}, ctx(p))).toBeNull();
  });

  it("is null for a wide-range picture (not provable) and for a split hero", () => {
    const wide = presentation(OV);
    expect(
      publishedHeaderOverlay(
        wide,
        media({ min: [0, 0, 0], max: [255, 255, 255] }) as never,
        ctx(wide),
      ),
    ).toBeNull();
    const split = presentation(OV, {
      background: { kind: "media", media: { mediaId: ID, decorative: true } },
      layout: "split",
    });
    expect(
      publishedHeaderOverlay(split, media(DARK) as never, ctx(split)),
    ).toBeNull();
  });

  it("is null when the hero's picture is not painted (no picture background)", () => {
    const p = presentation(OV, {
      background: { kind: "solid", color: { hex: "#000000" } },
    });
    expect(publishedHeaderOverlay(p, media(DARK) as never, ctx(p))).toBeNull();
  });
});
