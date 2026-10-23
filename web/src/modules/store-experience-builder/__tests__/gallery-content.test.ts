import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizePresentationConfig } from "../presentation/config";
import {
  GALLERY_ASPECTS,
  GALLERY_COLUMNS,
  GALLERY_GAPS,
  type GalleryContent,
  MAX_GALLERY_IMAGES,
  galleryPublishIssues,
  normalizeGalleryContent,
  resolveGalleryOptions,
} from "../presentation/gallery-content";
import { galleryContentOf, sanitizeContentHref } from "../presentation/section-content";
import { HOME_MEDIA_SECTION_KEYS, HOME_DATA_SECTION_KEYS } from "../presentation/tokens";
import { LAYOUTS, normalizeSectionDesign } from "../presentation/section-design";

interface Fixture {
  content: Array<{ name: string; input: unknown; expected: unknown }>;
  publish: Array<{
    name: string;
    content: GalleryContent | null;
    expected: Array<{ path: string; code: string }>;
  }>;
}

const fixture = JSON.parse(
  readFileSync(
    resolve(__dirname, "../../../../../tests/Fixtures/presentation/gallery.json"),
    "utf8",
  ),
) as Fixture;

describe("gallery content — shared fixture (V8d)", () => {
  for (const c of fixture.content) {
    it(c.name, () => {
      const config = normalizePresentationConfig({
        version: 2,
        homepage: {
          sections: [
            { id: "sec-a", type: "gallery", visible: true, content: c.input },
          ],
        },
      });
      const section = config.homepage.sections.find((s) => s.id === "sec-a");
      expect(section, "the gallery section itself survives").toBeDefined();
      // key order is part of the contract: compare serialised
      expect(JSON.stringify(section?.content ?? null)).toBe(
        JSON.stringify(c.expected),
      );
      // idempotent
      const again = normalizeGalleryContent(section?.content, sanitizeContentHref);
      expect(JSON.stringify(again ?? null)).toBe(JSON.stringify(c.expected));
    });
  }
});

describe("gallery publish rules — shared fixture (V8d)", () => {
  for (const c of fixture.publish) {
    it(c.name, () => {
      expect(galleryPublishIssues(c.content ?? undefined)).toEqual(c.expected);
    });
  }
});

describe("gallery helpers (V8d)", () => {
  it("resolveGalleryOptions makes every default explicit", () => {
    expect(resolveGalleryOptions(undefined)).toEqual({
      columns: 3,
      aspect: "1:1",
      gap: "md",
      captions: false,
      lightbox: false,
      showMotionControls: false,
    });
    expect(
      resolveGalleryOptions({
        columns: 6,
        aspect: "4:5",
        gap: "none",
        captions: true,
        lightbox: true,
        showMotionControls: true,
      }),
    ).toEqual({ columns: 6, aspect: "4:5", gap: "none", captions: true, lightbox: true, showMotionControls: true });
  });

  it("galleryContentOf reads only a gallery's own images", () => {
    const content = { images: [{ id: "a", media: { mediaId: "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e" } }] };
    expect(galleryContentOf({ type: "gallery", content })).toBe(content);
    expect(galleryContentOf({ type: "slider", content })).toEqual({ images: [] });
    expect(galleryContentOf({ type: "gallery" })).toEqual({ images: [] });
  });

  it("the contract's closed lists and cap", () => {
    expect(MAX_GALLERY_IMAGES).toBe(24);
    expect([...GALLERY_COLUMNS]).toEqual([2, 3, 4, 6]);
    expect([...GALLERY_ASPECTS]).toEqual(["1:1", "4:3", "16:9", "4:5"]);
    expect([...GALLERY_GAPS]).toEqual(["none", "xs", "sm", "md", "lg", "xl"]);
  });

  it("is a media section: accepted for storage, outside the data sections and the default document", () => {
    expect(HOME_MEDIA_SECTION_KEYS).toContain("gallery");
    expect(HOME_DATA_SECTION_KEYS as readonly string[]).not.toContain("gallery");
    const config = normalizePresentationConfig({ version: 3 });
    expect(config.homepage.sections.some((s) => s.type === "gallery")).toBe(false);
    expect(config.version).toBe(3);
  });

  it("the design layout is the grid by default (absence) or `carousel`; nothing else, and no text group", () => {
    expect([...LAYOUTS.gallery]).toEqual(["carousel"]);
    expect(normalizeSectionDesign("gallery", { layout: "carousel", spacing: { top: "md" } })).toEqual({
      layout: "carousel",
      spacing: { top: "md" },
    });
    expect(normalizeSectionDesign("gallery", { layout: "grid" })).toBeUndefined();
    expect(normalizeSectionDesign("gallery", { layout: "split" })).toBeUndefined();
    expect(
      normalizeSectionDesign("gallery", {
        text: { body: { hex: "#ffffff" } },
        mediaTreatment: { height: "tall" },
        background: { kind: "media", media: { mediaId: "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e" } },
      }),
    ).toBeUndefined();
  });
});
