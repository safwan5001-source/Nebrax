import { describe, expect, it } from "vitest";
import { normalizeSliderContent, resolveSliderBehaviour, type SliderContent } from "../presentation/slider-content";
import { sanitizeContentHref } from "../presentation/section-content";
import {
  addSlide,
  canAddSlide,
  compactBehaviour,
  duplicateSlide,
  fillTemplate,
  moveSlide,
  removeSlide,
  setBehaviour,
  setSlideAlign,
  setSlideCta,
  setSlideMedia,
  setSlideMobile,
  setSlideOverlay,
  setSlideText,
  setSlideTextColour,
} from "../slider-edit";

const A = "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e";
const B = "1c9a7d3f-4e4b-4b64-8d8f-9a2b3c4d5e6f";
const empty: SliderContent = { slides: [] };
const two = (): SliderContent => addSlide(addSlide(empty, { mediaId: A }, "a"), { mediaId: B }, "b");

/** What the editor stores must already be what the normaliser would keep. */
const stable = (content: SliderContent) =>
  expect(normalizeSliderContent(structuredClone(content), sanitizeContentHref)).toEqual(content);

describe("slider-edit (CUST-HV V8c-2)", () => {
  it("adds a slide that is only its picture, with a fresh id, and drops `fit`", () => {
    const next = addSlide(empty, { mediaId: A, fit: "contain", focal: { x: 10, y: 20 } });
    expect(next.slides).toHaveLength(1);
    expect(next.slides[0].id).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    expect(next.slides[0].media).toEqual({ mediaId: A, focal: { x: 10, y: 20 } });
    stable(next);
  });

  it("stops at eight slides", () => {
    let content = empty;
    for (let i = 0; i < 10; i += 1) content = addSlide(content, { mediaId: A }, `s${i}`);
    expect(content.slides).toHaveLength(8);
    expect(canAddSlide(content)).toBe(false);
    expect(addSlide(content, { mediaId: B }, "x")).toBe(content);
    expect(duplicateSlide(content, "s0")).toEqual({ content, id: null });
  });

  it("duplicates right after the original with a new id and an independent copy", () => {
    const base = setSlideText(two(), "a", "heading", "Hello");
    const { content, id } = duplicateSlide(base, "a", "a2");
    expect(id).toBe("a2");
    expect(content.slides.map((s) => s.id)).toEqual(["a", "a2", "b"]);
    expect(content.slides[1].heading).toBe("Hello");
    const edited = setSlideText(content, "a2", "heading", "Changed");
    expect(edited.slides[0].heading).toBe("Hello");
    stable(content);
  });

  it("moves within bounds and removes by id", () => {
    const base = two();
    expect(moveSlide(base, "a", 1).slides.map((s) => s.id)).toEqual(["b", "a"]);
    expect(moveSlide(base, "a", -1)).toBe(base);
    expect(moveSlide(base, "b", 1)).toBe(base);
    expect(removeSlide(base, "a").slides.map((s) => s.id)).toEqual(["b"]);
    expect(removeSlide(removeSlide(base, "a"), "b").slides).toEqual([]);
  });

  it("stores copy as written, truncated by code point, and a blank value is absence", () => {
    let content = setSlideText(two(), "a", "heading", "x".repeat(130));
    expect(Array.from(content.slides[0].heading ?? "")).toHaveLength(120);
    content = setSlideText(content, "a", "sub", "😀".repeat(210));
    expect(Array.from(content.slides[0].sub ?? "")).toHaveLength(200);
    content = setSlideText(content, "a", "heading", "   ");
    expect("heading" in content.slides[0]).toBe(false);
    stable(content);
  });

  it("keeps a button only while it has a label or a link", () => {
    let content = setSlideCta(two(), "a", { label: "Shop" });
    expect(content.slides[0].cta).toEqual({ label: "Shop", href: "" });
    content = setSlideCta(content, "a", { href: "/products" });
    expect(content.slides[0].cta).toEqual({ label: "Shop", href: "/products" });
    content = setSlideCta(content, "a", { label: "" });
    expect(content.slides[0].cta).toEqual({ label: "", href: "/products" });
    content = setSlideCta(content, "a", { href: "" });
    expect("cta" in content.slides[0]).toBe(false);
    stable(setSlideCta(two(), "a", { label: "Shop", href: "/products" }));
  });

  it("the phone picture is stored decorative with no alt / fit; the main picture keeps alt and loses fit", () => {
    let content = setSlideMobile(two(), "a", { mediaId: B, alt: { en: "x" }, fit: "contain", focal: { x: 1, y: 2 } });
    expect(content.slides[0].mobile).toEqual({ mediaId: B, decorative: true, focal: { x: 1, y: 2 } });
    content = setSlideMobile(content, "a", null);
    expect("mobile" in content.slides[0]).toBe(false);
    content = setSlideMedia(content, "a", { mediaId: B, alt: { ar: "صورة", en: "A picture" }, fit: "contain" });
    expect(content.slides[0].media).toEqual({ mediaId: B, alt: { ar: "صورة", en: "A picture" } });
    stable(content);
  });

  it("overlay, text colour and alignment add and remove cleanly; 'start' is the absence of an alignment", () => {
    let content = setSlideOverlay(two(), "a", { color: { role: "overlay" }, alpha: 40 });
    content = setSlideTextColour(content, "a", { hex: "#ffffff" });
    content = setSlideAlign(content, "a", "center");
    expect(content.slides[0]).toMatchObject({ overlay: { alpha: 40 }, text: { hex: "#ffffff" }, align: "center" });
    stable(content);
    content = setSlideOverlay(content, "a", null);
    content = setSlideTextColour(content, "a", undefined);
    content = setSlideAlign(content, "a", "start");
    expect(Object.keys(content.slides[0]).sort()).toEqual(["id", "media"]);
  });

  it("behaviour stores only what differs from the default, and interval needs autoplay", () => {
    expect(setBehaviour(two(), {}).behaviour).toBeUndefined();
    let content = setBehaviour(two(), { autoplay: true, interval: 10 });
    expect(content.behaviour).toEqual({ autoplay: true, interval: 10 });
    content = setBehaviour(content, { interval: 6 });
    expect(content.behaviour).toEqual({ autoplay: true });
    content = setBehaviour(setBehaviour(content, { interval: 8 }), { autoplay: false });
    expect(content.behaviour).toBeUndefined();
    content = setBehaviour(content, { transition: "fade", duration: "slow", arrows: false, dots: false, loop: true });
    expect(content.behaviour).toEqual({ transition: "fade", duration: "slow", arrows: false, dots: false, loop: true });
    stable(content);
    expect(compactBehaviour(resolveSliderBehaviour(undefined))).toEqual({});
  });

  it("fills {placeholders} and leaves unknown ones visible", () => {
    expect(fillTemplate("{a} of {b} {c}", { a: 1, b: 2 })).toBe("1 of 2 {c}");
  });
});
