import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRESENTATION_CONFIG,
  MAX_HOME_SECTIONS,
  type PresentationHomeSection,
  type StorefrontPresentationConfig,
  canMoveSection,
  deleteSection,
  duplicateSection,
  moveSection,
  moveSectionTo,
  sectionIsAuthored,
  setSectionVisible,
} from "../presentation";

const doc = (sections: PresentationHomeSection[], homepage: Partial<StorefrontPresentationConfig["homepage"]> = {}): StorefrontPresentationConfig => ({
  ...DEFAULT_PRESENTATION_CONFIG,
  homepage: { ...DEFAULT_PRESENTATION_CONFIG.homepage, ...homepage, sections },
});
const ids = (c: StorefrontPresentationConfig) => c.homepage.sections.map((s) => s.id);
const base = doc([
  { id: "a", type: "hero", visible: true },
  { id: "b", type: "categories", visible: true },
  { id: "c", type: "featured", visible: false },
]);

/** CUST-HV V10d — the shared list operations (section list + Canvas action bar + drag and drop). */
describe("section list operations", () => {
  it("moves by step and to an index; nothing happens at the edges or for a no-op", () => {
    expect(ids(moveSection(base, "b", 1)!)).toEqual(["a", "c", "b"]);
    expect(ids(moveSection(base, "b", -1)!)).toEqual(["b", "a", "c"]);
    expect(moveSection(base, "a", -1)).toBeNull();
    expect(moveSection(base, "c", 1)).toBeNull();
    expect(moveSection(base, "zzz", 1)).toBeNull();
    expect(ids(moveSectionTo(base, 0, 2)!)).toEqual(["b", "c", "a"]);
    expect(moveSectionTo(base, 1, 1)).toBeNull();
    expect(moveSectionTo(base, 0, 9)).toBeNull();
    expect(canMoveSection(base, "a", -1)).toBe(false);
    expect(canMoveSection(base, "b", 1)).toBe(true);
  });

  it("never mutates its input", () => {
    const snapshot = JSON.stringify(base);
    moveSection(base, "a", 1);
    setSectionVisible(base, "a", false);
    duplicateSection(base, "b", "copy");
    deleteSection(base, "b");
    expect(JSON.stringify(base)).toBe(snapshot);
  });

  it("show / hide changes only that section; the app-promo section keeps the store's app switch in step", () => {
    const next = setSectionVisible(base, "c", true)!;
    expect(next.homepage.sections.map((s) => s.visible)).toEqual([true, true, true]);
    expect(next.apps).toEqual(base.apps);
    const withApp = doc([{ id: "p", type: "appPromo", visible: true }]);
    expect(setSectionVisible(withApp, "p", false)!.apps.showHomepageSection).toBe(false);
    expect(setSectionVisible(base, "nope", true)).toBeNull();
  });

  it("duplicate keeps content, design and a suffixed name, lands after the original, with a new id", () => {
    const named = doc([
      { id: "f", type: "featured", visible: true, label: "Picks", content: { productIds: ["p1"] }, design: { layout: "rail" } },
      { id: "z", type: "benefits", visible: true },
    ]);
    const result = duplicateSection(named, "f", "copy")!;
    const [original, copy, tail] = result.config.homepage.sections;
    expect(original.id).toBe("f");
    expect(copy.id).toBe(result.id);
    expect(copy.id).not.toBe("f");
    expect(tail.id).toBe("z");
    expect(copy).toMatchObject({ type: "featured", visible: true, label: "Picks · copy", content: { productIds: ["p1"] }, design: { layout: "rail" } });
    expect(copy.content).not.toBe(original.content);
  });

  it("a hero still on the legacy text is duplicated with that text made explicit; the hero limit and the list limit hold", () => {
    const legacy = doc([{ id: "h", type: "hero", visible: true }], { heroHeadline: " Welcome ", heroSubheadline: "Hi" });
    expect(duplicateSection(legacy, "h", "copy")!.config.homepage.sections[1].content).toEqual({ headline: "Welcome", subheadline: "Hi" });
    const threeHeroes = doc([1, 2, 3].map((n) => ({ id: `h${n}`, type: "hero" as const, visible: true })));
    expect(duplicateSection(threeHeroes, "h1", "copy")).toBeNull();
    const full = doc(Array.from({ length: MAX_HOME_SECTIONS }, (_, i) => ({ id: `s${i}`, type: "customContent" as const, visible: true })));
    expect(duplicateSection(full, "s0", "copy")).toBeNull();
  });

  it("delete removes the instance and picks the next sibling, else the previous, else none", () => {
    expect(deleteSection(base, "b")!.fallbackId).toBe("c");
    expect(deleteSection(base, "c")!.fallbackId).toBe("b");
    expect(deleteSection(doc([{ id: "only", type: "benefits", visible: true }]), "only")!.fallbackId).toBeNull();
    expect(ids(deleteSection(base, "a")!.config)).toEqual(["b", "c"]);
    expect(deleteSection(base, "nope")).toBeNull();
  });

  it("knows when a delete would lose something", () => {
    expect(sectionIsAuthored({ id: "a", type: "benefits", visible: true })).toBe(false);
    expect(sectionIsAuthored({ id: "a", type: "benefits", visible: true, design: { radius: "md" } })).toBe(true);
    expect(sectionIsAuthored({ id: "a", type: "customContent", visible: true, content: { blocks: [{ id: "x", kind: "heading", text: "T" }] } })).toBe(true);
    expect(sectionIsAuthored({ id: "a", type: "hero", visible: true, content: { headline: "" } })).toBe(false);
    expect(sectionIsAuthored({ id: "a", type: "hero", visible: true, content: { headline: "Hi" } })).toBe(true);
  });
});
