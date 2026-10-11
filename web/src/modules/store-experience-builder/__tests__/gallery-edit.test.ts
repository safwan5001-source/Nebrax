import { describe, expect, it } from "vitest";
import {
  addImage,
  canAddImage,
  compactOptions,
  duplicateImage,
  moveImage,
  removeImage,
  setImageCaption,
  setImageLink,
  setImageMedia,
  setOptions,
} from "../gallery-edit";
import { type GalleryContent, normalizeGalleryContent, resolveGalleryOptions } from "../presentation/gallery-content";
import { sanitizeContentHref } from "../presentation/section-content";

const A = "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e";
const B = "1c9a7d3f-4e4b-4b64-8d8f-9a2b3c4d5e6f";
const empty: GalleryContent = { images: [] };
const two = (): GalleryContent => addImage(addImage(empty, { mediaId: A }, "a"), { mediaId: B }, "b");

/** What the editor stores must already be what the normaliser would keep. */
const stable = (content: GalleryContent) =>
  expect(normalizeGalleryContent(structuredClone(content), sanitizeContentHref)).toEqual(content);

describe("gallery-edit (CUST-HV V8f)", () => {
  it("adds an image that is only its picture, with a fresh id, keeping the whole reference (alt, decorative, fit, focal)", () => {
    const media = { mediaId: A, fit: "contain" as const, focal: { x: 10, y: 20 }, alt: { en: "A rose" } };
    const next = addImage(empty, media);
    expect(next.images).toHaveLength(1);
    expect(next.images[0].id).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    expect(next.images[0].media).toEqual(media);
    stable(next);
  });

  it("stops at twenty-four images", () => {
    let content = empty;
    for (let i = 0; i < 30; i += 1) content = addImage(content, { mediaId: A }, `i${i}`);
    expect(content.images).toHaveLength(24);
    expect(canAddImage(content)).toBe(false);
    expect(addImage(content, { mediaId: B }, "x")).toBe(content);
    expect(duplicateImage(content, "i0")).toEqual({ content, id: null });
  });

  it("duplicates right after the original with a new id and an independent copy", () => {
    const base = setImageCaption(two(), "a", "Hello");
    const { content, id } = duplicateImage(base, "a", "a2");
    expect(id).toBe("a2");
    expect(content.images.map((i) => i.id)).toEqual(["a", "a2", "b"]);
    expect(setImageCaption(content, "a2", "Changed").images[0].caption).toBe("Hello");
    stable(content);
  });

  it("moves within bounds and removes by id", () => {
    const base = two();
    expect(moveImage(base, "a", 1).images.map((i) => i.id)).toEqual(["b", "a"]);
    expect(moveImage(base, "a", -1)).toBe(base);
    expect(moveImage(base, "b", 1)).toBe(base);
    expect(removeImage(removeImage(base, "a"), "b").images).toEqual([]);
  });

  it("captions are truncated by code point and a blank value is absence", () => {
    let content = setImageCaption(two(), "a", "😀".repeat(130));
    expect(Array.from(content.images[0].caption ?? "")).toHaveLength(120);
    content = setImageCaption(content, "a", "  ");
    expect("caption" in content.images[0]).toBe(false);
    stable(setImageCaption(two(), "a", "Spring"));
  });

  it("a link is stored as typed and an empty one is removed; the normaliser decides what survives", () => {
    let content = setImageLink(two(), "a", "/products");
    expect(content.images[0].link).toBe("/products");
    stable(content);
    content = setImageLink(content, "a", "");
    expect("link" in content.images[0]).toBe(false);
    const unsafe = setImageLink(two(), "a", "javascript:alert(1)");
    expect(normalizeGalleryContent(unsafe, sanitizeContentHref)?.images[0].link).toBeUndefined();
  });

  it("replacing the picture keeps the image's caption and link", () => {
    const base = setImageLink(setImageCaption(two(), "a", "Spring"), "a", "/p");
    const next = setImageMedia(base, "a", { mediaId: B, decorative: true });
    expect(next.images[0]).toEqual({ id: "a", media: { mediaId: B, decorative: true }, caption: "Spring", link: "/p" });
  });

  it("options store only what differs from the default", () => {
    expect(setOptions(two(), {}).options).toBeUndefined();
    let content = setOptions(two(), { columns: 4, aspect: "16:9", gap: "lg", captions: true, lightbox: true });
    expect(content.options).toEqual({ columns: 4, aspect: "16:9", gap: "lg", captions: true, lightbox: true });
    stable(content);
    content = setOptions(content, { columns: 3, aspect: "1:1", gap: "md" });
    expect(content.options).toEqual({ captions: true, lightbox: true });
    content = setOptions(content, { captions: false, lightbox: false });
    expect(content.options).toBeUndefined();
    expect(compactOptions(resolveGalleryOptions(undefined))).toEqual({});
  });
});
