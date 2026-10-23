import { describe, expect, it } from "vitest";
import type { PresentationHomeSection } from "../config";
import {
  galleryImagePath,
  pictureData,
  resolveGallery,
} from "../gallery-resolve";
import type { ResolvedMedia, ResolvedMediaMap } from "../media-ref";

const ID_A = "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e";
const ID_B = "1c9a7d3f-4e4b-4b64-8d8f-9a2b3c4d5e6f";

function media(over: Partial<ResolvedMedia> = {}): ResolvedMedia {
  return {
    width: 1600,
    height: 900,
    decorative: false,
    alt: { ar: "صورة", en: "Picture" },
    sources: [
      {
        kind: "w",
        width: 800,
        height: 450,
        format: "webp",
        src: "/api/storefront/media/customizer/a/800w.webp",
      },
      {
        kind: "w",
        width: 1600,
        height: 900,
        format: "webp",
        src: "/api/storefront/media/customizer/a/1600w.webp",
      },
      {
        kind: "w",
        width: 800,
        height: 450,
        format: "jpg",
        src: "/api/storefront/media/customizer/a/800w.jpg",
      },
      {
        kind: "w",
        width: 1600,
        height: 900,
        format: "jpg",
        src: "/api/storefront/media/customizer/a/1600w.jpg",
      },
    ],
    ...over,
  };
}

function gallery(
  content: unknown,
  design?: PresentationHomeSection["design"],
): PresentationHomeSection {
  return {
    id: "g",
    type: "gallery",
    visible: true,
    content,
    ...(design ? { design } : {}),
  } as PresentationHomeSection;
}

const two = {
  images: [
    { id: "a", media: { mediaId: ID_A }, caption: "One", link: "/products" },
    { id: "b", media: { mediaId: ID_B } },
  ],
};

describe("resolveGallery (CUST-HV V8e)", () => {
  it("joins the document to the server's resolved media by JSON path", () => {
    expect(galleryImagePath(3, 1)).toBe(
      "homepage.sections.3.content.images.1.media",
    );
    const resolved: ResolvedMediaMap = {
      [galleryImagePath(3, 0)]: media(),
      [galleryImagePath(3, 1)]: media({ alt: { ar: null, en: "B" } }),
    };
    const view = resolveGallery(gallery(two), 3, resolved, "en");
    expect(view?.images.map((i) => [i.id, i.position, i.alt])).toEqual([
      ["a", 1, "Picture"],
      ["b", 2, "B"],
    ]);
    expect(view?.images[0]).toMatchObject({
      caption: "One",
      link: "/products",
    });
    expect(view?.images[1]).toMatchObject({ caption: "", link: null });
  });

  it("an image the server did not resolve is omitted, never guessed; positions count what is drawn", () => {
    const view = resolveGallery(
      gallery(two),
      0,
      { [galleryImagePath(0, 1)]: media() },
      "en",
    );
    expect(view?.images.map((i) => [i.id, i.position])).toEqual([["b", 1]]);
  });

  it("a gallery with nothing resolvable is omitted whole", () => {
    expect(resolveGallery(gallery(two), 0, {}, "en")).toBeNull();
    expect(resolveGallery(gallery(undefined), 0, {}, "en")).toBeNull();
  });

  it("alt follows the visitor's locale, never the other one; a decorative picture is empty", () => {
    const resolved = {
      [galleryImagePath(0, 0)]: media({ alt: { ar: "صورة", en: null } }),
      [galleryImagePath(0, 1)]: media({ decorative: true }),
    };
    const ar = resolveGallery(gallery(two), 0, resolved, "ar");
    const en = resolveGallery(gallery(two), 0, resolved, "en");
    expect(ar?.images.map((i) => i.alt)).toEqual(["صورة", ""]);
    expect(en?.images.map((i) => i.alt)).toEqual(["", ""]);
  });

  it("options come with every default explicit; the layout is the grid unless the design says carousel", () => {
    const resolved = {
      [galleryImagePath(0, 0)]: media(),
      [galleryImagePath(0, 1)]: media(),
    };
    const plain = resolveGallery(gallery(two), 0, resolved, "en");
    expect(plain?.layout).toBe("grid");
    expect(plain?.options).toEqual({
      columns: 3,
      aspect: "1:1",
      gap: "md",
      captions: false,
      lightbox: false,
      showMotionControls: false,
    });
    const strip = resolveGallery(
      gallery(
        { ...two, options: { columns: 4, captions: true, lightbox: true } },
        { layout: "carousel" },
      ),
      0,
      resolved,
      "en",
    );
    expect(strip?.layout).toBe("carousel");
    expect(strip?.options).toMatchObject({
      columns: 4,
      captions: true,
      lightbox: true,
    });
  });

  it("fit and focal point come from the reference, not the server's picture", () => {
    const view = resolveGallery(
      gallery({
        images: [
          {
            id: "a",
            media: { mediaId: ID_A, fit: "contain", focal: { x: 10, y: 80 } },
          },
          { id: "b", media: { mediaId: ID_B } },
        ],
      }),
      0,
      {
        [galleryImagePath(0, 0)]: media(),
        [galleryImagePath(0, 1)]: media(),
      },
      "en",
    );
    expect(view?.images[0]).toMatchObject({
      fit: "contain",
      focal: { x: 10, y: 80 },
    });
    expect(view?.images[1].fit).toBe("cover");
    expect(view?.images[1].focal).toBeUndefined();
  });
});

describe("pictureData", () => {
  it("lists the real rendered widths per format and falls back to the largest JPEG", () => {
    const data = pictureData(media());
    expect(data.webp).toBe(
      "/api/storefront/media/customizer/a/800w.webp 800w, /api/storefront/media/customizer/a/1600w.webp 1600w",
    );
    expect(data.jpg).toContain("1600w.jpg 1600w");
    expect(data.fallback).toBe("/api/storefront/media/customizer/a/1600w.jpg");
    expect([data.width, data.height]).toEqual([1600, 900]);
  });
});
