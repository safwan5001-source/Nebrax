/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { intentGroupKey, isContinuousInputTarget } from "../history/change-intent";
import {
  DEFAULT_PRESENTATION_CONFIG,
  clonePresentationConfig,
  normalizePresentationConfig,
} from "../presentation/config";
import { deleteSection, duplicateSection, moveSection, setSectionVisible } from "../presentation/section-ops";

describe("intentGroupKey (CUST-H5-2)", () => {
  it("groups a single text leaf change", () => {
    expect(intentGroupKey({ a: { b: "x" } }, { a: { b: "xy" } })).toBe("leaf:/a/b");
  });

  it("groups a single numeric leaf change and keeps the array index in the path", () => {
    expect(intentGroupKey({ list: [{ n: 1 }, { n: 2 }] }, { list: [{ n: 1 }, { n: 3 }] })).toBe("leaf:/list[1]/n");
  });

  it("does not group when nothing changed", () => {
    expect(intentGroupKey({ a: "x" }, { a: "x" })).toBeUndefined();
  });

  it("does not group two changed leaves (a preset or bulk edit)", () => {
    expect(intentGroupKey({ a: "x", b: "y" }, { a: "x2", b: "y2" })).toBeUndefined();
  });

  it("does not group booleans (a toggle is a decision, not a burst)", () => {
    expect(intentGroupKey({ visible: true }, { visible: false })).toBeUndefined();
  });

  it("does not group a changed type (string → number)", () => {
    expect(intentGroupKey({ a: "1" }, { a: 1 })).toBeUndefined();
  });

  it("does not group an added or removed key, or null ↔ value", () => {
    expect(intentGroupKey({ a: "x" }, { a: "x", b: "y" })).toBeUndefined();
    expect(intentGroupKey({ a: "x", b: "y" }, { a: "x" })).toBeUndefined();
    expect(intentGroupKey({ a: null }, { a: "x" })).toBeUndefined();
  });

  it("does not group a replaced key set of the same size", () => {
    expect(intentGroupKey({ a: "x" }, { b: "x" })).toBeUndefined();
  });

  it("does not group array growth, shrink or reorder", () => {
    expect(intentGroupKey({ l: ["a"] }, { l: ["a", "b"] })).toBeUndefined();
    expect(intentGroupKey({ l: ["a", "b"] }, { l: ["a"] })).toBeUndefined();
    expect(intentGroupKey({ l: ["a", "b"] }, { l: ["b", "a"] })).toBeUndefined();
  });

  it("does not group NaN/Infinity numbers", () => {
    expect(intentGroupKey({ n: 1 }, { n: Number.NaN })).toBeUndefined();
  });

  it("two consecutive typed characters in one real field share a key; a different field does not", () => {
    const base = normalizePresentationConfig(clonePresentationConfig(DEFAULT_PRESENTATION_CONFIG));
    const a = { ...base, branding: { ...base.branding, displayName: "م" } };
    const b = { ...base, branding: { ...base.branding, displayName: "مت" } };
    const other = { ...base, branding: { ...base.branding, tagline: "x" } };
    expect(intentGroupKey(base, a)).toBeDefined();
    expect(intentGroupKey(a, b)).toBe(intentGroupKey(base, a));
    expect(intentGroupKey(base, other)).not.toBe(intentGroupKey(base, a));
  });

  it("structural section operations never group", () => {
    const base = normalizePresentationConfig(clonePresentationConfig(DEFAULT_PRESENTATION_CONFIG));
    const ids = base.homepage.sections.map((section) => section.id);
    const moved = moveSection(base, ids[1], -1);
    expect(moved).not.toBeNull();
    expect(intentGroupKey(base, moved)).toBeUndefined();
    const hidden = setSectionVisible(base, ids[0], false);
    expect(intentGroupKey(base, hidden)).toBeUndefined();
    const dup = duplicateSection(base, ids[0], " copy");
    if (dup) expect(intentGroupKey(base, dup.config)).toBeUndefined();
    const del = deleteSection(base, ids[ids.length - 1]);
    if (del) expect(intentGroupKey(base, del.config)).toBeUndefined();
  });
});

describe("isContinuousInputTarget (CUST-H5-2 review)", () => {
  const make = (html: string) => {
    const host = document.createElement("div");
    host.innerHTML = html;
    return host.firstElementChild as HTMLElement;
  };

  it("is true only for continuous text/number/range/colour inputs and textareas", () => {
    for (const html of [
      "<input>",
      '<input type="text">',
      '<input type="search">',
      '<input type="number">',
      '<input type="range">',
      '<input type="color">',
      "<textarea></textarea>",
    ]) {
      expect(isContinuousInputTarget(make(html)), html).toBe(true);
    }
  });

  it("is false for discrete controls: select, checkbox, radio, file, buttons, plain elements, null", () => {
    for (const html of [
      "<select><option>a</option></select>",
      '<input type="checkbox">',
      '<input type="radio">',
      '<input type="file">',
      "<button>x</button>",
      "<div>x</div>",
    ]) {
      expect(isContinuousInputTarget(make(html)), html).toBe(false);
    }
    expect(isContinuousInputTarget(null)).toBe(false);
  });
});
