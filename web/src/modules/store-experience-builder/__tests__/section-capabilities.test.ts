import { describe, expect, it } from "vitest";
import {
  canAddSectionType,
  canDuplicateSection,
  DEFAULT_PRESENTATION_CONFIG,
  HOME_BUILDER_SECTION_KEYS,
  hasAddableSectionType,
  isGatedHomeSection,
  MAX_HOME_SECTIONS,
  newHomeSectionId,
  type PresentationHomeSection,
  SECTION_CAPABILITIES,
  SECTION_LIBRARY_CATEGORIES,
  SECTION_LIBRARY_CATEGORY_LABEL,
  sectionTypesInCategory,
} from "../presentation";
import { customizerMessage } from "../messages";

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

describe("CUST-H4-2 capability registry — state/category/library metadata", () => {
  it("has exactly one well-formed capability entry per registered type, no unknowns", () => {
    const keys = Object.keys(SECTION_CAPABILITIES);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.sort()).toEqual([...HOME_BUILDER_SECTION_KEYS].sort());
    for (const type of HOME_BUILDER_SECTION_KEYS) {
      expect(SECTION_CAPABILITIES[type].type).toBe(type);
    }
  });

  it("only uses valid state values from the H4 vocabulary", () => {
    const valid = new Set(["live", "partial", "gated", "deferred"]);
    for (const type of HOME_BUILDER_SECTION_KEYS) {
      expect(valid.has(SECTION_CAPABILITIES[type].state)).toBe(true);
    }
  });

  it("never flattens a non-live state to live (H4-1 §5 truth matrix)", () => {
    // Exact truth matrix from CUST-H4-ARCH-1 §5 — PARTIAL/GATED sections must
    // keep their honest state, not read as LIVE.
    const expected: Record<string, string> = {
      hero: "live",
      categories: "live",
      newArrivals: "live",
      wholesale: "live",
      banner: "live",
      featured: "partial",
      offers: "gated",
      benefits: "live",
      appPromo: "live",
      customContent: "live",
    };
    for (const type of HOME_BUILDER_SECTION_KEYS) {
      expect(SECTION_CAPABILITIES[type].state).toBe(expected[type]);
    }
  });

  it("keeps offers' formalized gated state consistent with the existing isGatedHomeSection gate", () => {
    for (const type of HOME_BUILDER_SECTION_KEYS) {
      expect(SECTION_CAPABILITIES[type].state === "gated").toBe(
        isGatedHomeSection(type),
      );
    }
  });

  it("documents Featured as truthfully PARTIAL with a merchant-facing reason, not silently LIVE", () => {
    expect(SECTION_CAPABILITIES.featured.state).toBe("partial");
    expect(SECTION_CAPABILITIES.featured.reasonKey).toBeTruthy();
  });

  it("documents Offers as truthfully GATED with a merchant-facing reason, not hidden or silently LIVE", () => {
    expect(SECTION_CAPABILITIES.offers.state).toBe("gated");
    expect(SECTION_CAPABILITIES.offers.reasonKey).toBeTruthy();
    // H4-2 does not reinterpret H4-1's decision: Offers stays addable (a real,
    // non-deceptive gate), it is not withheld from merchant-addable results.
    expect(SECTION_CAPABILITIES.offers.merchantAddable).toBe(true);
  });

  it("maps every section to exactly one of the 7 taxonomy categories, none empty", () => {
    expect(SECTION_LIBRARY_CATEGORIES.length).toBe(7);
    const covered = new Set<string>();
    for (const type of HOME_BUILDER_SECTION_KEYS) {
      const category = SECTION_CAPABILITIES[type].category;
      expect(SECTION_LIBRARY_CATEGORIES.includes(category)).toBe(true);
      covered.add(category);
    }
    // No empty category: every declared category has at least one section.
    for (const category of SECTION_LIBRARY_CATEGORIES) {
      expect(sectionTypesInCategory(category).length).toBeGreaterThan(0);
      expect(covered.has(category)).toBe(true);
    }
  });

  it("resolves every title/description/category-label/reason key in both Arabic and English, never a raw key", () => {
    const keys = new Set<string>();
    for (const category of SECTION_LIBRARY_CATEGORIES) {
      keys.add(SECTION_LIBRARY_CATEGORY_LABEL[category]);
    }
    for (const type of HOME_BUILDER_SECTION_KEYS) {
      const cap = SECTION_CAPABILITIES[type];
      keys.add(cap.titleKey);
      keys.add(cap.descriptionKey);
      if (cap.reasonKey) keys.add(cap.reasonKey);
    }
    for (const key of keys) {
      const ar = customizerMessage("ar", key as never);
      const en = customizerMessage("en", key as never);
      expect(ar).toBeTruthy();
      expect(en).toBeTruthy();
      expect(ar).not.toBe(key);
      expect(en).not.toBe(key);
    }
  });

  it("merchantAddable gates canAddSectionType independently of instance count", () => {
    // No registered type is withheld today — every one should be reachable
    // via canAddSectionType once instance-count rules allow it.
    for (const type of HOME_BUILDER_SECTION_KEYS) {
      expect(SECTION_CAPABILITIES[type].merchantAddable).toBe(true);
    }
    const sections = DEFAULT_PRESENTATION_CONFIG.homepage.sections.filter(
      (s) => s.type !== "appPromo",
    );
    expect(canAddSectionType(sections, "appPromo")).toBe(true);
  });
});
