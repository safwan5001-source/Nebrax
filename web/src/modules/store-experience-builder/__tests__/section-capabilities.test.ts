import { describe, expect, it } from "vitest";
import {
  canAddSectionType,
  canDuplicateSection,
  DEFAULT_PRESENTATION_CONFIG,
  HOME_BUILDER_SECTION_KEYS,
  hasAddableSectionType,
  MAX_HOME_SECTIONS,
  newHomeSectionId,
  type PresentationHomeSection,
  SECTION_CAPABILITIES,
} from "../presentation";

const SAFE_ID = /^[a-zA-Z0-9_-]{1,64}$/;

function section(
  id: string,
  type: PresentationHomeSection["type"],
  visible = true,
): PresentationHomeSection {
  return { id, type, visible };
}

describe("section capabilities (STORE-CUSTOMIZER-V2-2)", () => {
  it("covers every registered section type exactly once", () => {
    expect(Object.keys(SECTION_CAPABILITIES).sort()).toEqual(
      [...HOME_BUILDER_SECTION_KEYS].sort(),
    );
  });

  it("marks hero as singleton and non-duplicable", () => {
    expect(SECTION_CAPABILITIES.hero).toMatchObject({
      maxInstances: 1,
      canDuplicate: false,
    });
  });

  it("marks catalog-driven sections as singletons", () => {
    for (const type of [
      "categories",
      "newArrivals",
      "wholesale",
      "appPromo",
    ] as const) {
      expect(SECTION_CAPABILITIES[type].maxInstances).toBe(1);
      expect(SECTION_CAPABILITIES[type].canDuplicate).toBe(false);
    }
  });

  it("allows multi-instance for banner/featured/offers/benefits/customContent", () => {
    for (const type of [
      "banner",
      "featured",
      "offers",
      "benefits",
      "customContent",
    ] as const) {
      expect(SECTION_CAPABILITIES[type].maxInstances).toBeNull();
      expect(SECTION_CAPABILITIES[type].canDuplicate).toBe(true);
    }
  });

  it("rejects adding a singleton type that already exists", () => {
    const sections = DEFAULT_PRESENTATION_CONFIG.homepage.sections;
    // Defaults already contain hero/categories/newArrivals/wholesale.
    expect(canAddSectionType(sections, "hero")).toBe(false);
    expect(canAddSectionType(sections, "categories")).toBe(false);
    expect(canAddSectionType(sections, "newArrivals")).toBe(false);
    expect(canAddSectionType(sections, "wholesale")).toBe(false);
  });

  it("allows adding a singleton type that is absent", () => {
    const sections = DEFAULT_PRESENTATION_CONFIG.homepage.sections.filter(
      (s) => s.type !== "appPromo",
    );
    expect(canAddSectionType(sections, "appPromo")).toBe(true);
  });

  it("allows adding multi-instance types repeatedly", () => {
    const sections = [
      ...DEFAULT_PRESENTATION_CONFIG.homepage.sections,
      section("b1", "banner"),
      section("b2", "banner"),
    ];
    expect(canAddSectionType(sections, "banner")).toBe(true);
  });

  it("blocks every add once MAX_HOME_SECTIONS is reached", () => {
    const sections = Array.from({ length: MAX_HOME_SECTIONS }, (_, i) =>
      section(`s${i}`, "banner"),
    );
    expect(canAddSectionType(sections, "banner")).toBe(false);
    expect(canAddSectionType(sections, "hero")).toBe(false);
    expect(hasAddableSectionType(sections)).toBe(false);
  });

  it("duplicate follows the capability, not the contract's technical allowance", () => {
    const hero = section("hero", "hero");
    const banner = section("b1", "banner", false);
    const sections = [hero, banner];
    expect(canDuplicateSection(sections, hero)).toBe(false);
    expect(canDuplicateSection(sections, banner)).toBe(true);
  });

  it("blocks duplicate at the section cap", () => {
    const sections = Array.from({ length: MAX_HOME_SECTIONS }, (_, i) =>
      section(`s${i}`, "banner"),
    );
    expect(canDuplicateSection(sections, sections[0])).toBe(false);
  });

  it("generates valid, distinct, safeId-compatible instance ids", () => {
    const ids = new Set(Array.from({ length: 50 }, () => newHomeSectionId()));
    expect(ids.size).toBe(50);
    for (const id of ids) {
      expect(SAFE_ID.test(id)).toBe(true);
      expect(id.startsWith("section-")).toBe(true);
      expect(id.length).toBeLessThanOrEqual(64);
    }
  });
});
