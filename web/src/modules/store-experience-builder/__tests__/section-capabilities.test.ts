import { describe, expect, it } from "vitest";
import {
  canAddSectionType,
  canDuplicateSection,
  DEFAULT_PRESENTATION_CONFIG,
  ALL_HOME_SECTION_KEYS,
  HOME_BUILDER_SECTION_KEYS,
  HOME_DATA_SECTION_KEYS,
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
import { CUSTOMIZER_MESSAGES, customizerMessage } from "../messages";

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
      [...ALL_HOME_SECTION_KEYS].sort(),
    );
  });

  it("marks hero as a bounded, duplicable and deletable per-instance section (CUST-HV V6a)", () => {
    expect(SECTION_CAPABILITIES.hero).toMatchObject({
      maxInstances: 3,
      canDuplicate: true,
      canDelete: true,
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
    // Defaults already contain categories/newArrivals/wholesale (a hero is no longer a singleton).
    expect(canAddSectionType(sections, "categories")).toBe(false);
    expect(canAddSectionType(sections, "newArrivals")).toBe(false);
    expect(canAddSectionType(sections, "wholesale")).toBe(false);
  });

  it("a hero can be added until the bound of three is reached, then no further (V6a)", () => {
    const withHeroes = (count: number) => [
      ...DEFAULT_PRESENTATION_CONFIG.homepage.sections.filter((s) => s.type !== "hero"),
      ...Array.from({ length: count }, (_, i) => section(`hero-${i}`, "hero")),
    ];
    expect(canAddSectionType(withHeroes(0), "hero")).toBe(true); // zero heroes is allowed
    expect(canAddSectionType(withHeroes(1), "hero")).toBe(true);
    expect(canAddSectionType(withHeroes(2), "hero")).toBe(true);
    expect(canAddSectionType(withHeroes(3), "hero")).toBe(false);
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
    expect(canDuplicateSection(sections, hero)).toBe(true);
    expect(canDuplicateSection(sections, banner)).toBe(true);
    // a singleton type never duplicates
    const categories = section("c1", "categories");
    expect(canDuplicateSection([categories], categories)).toBe(false);
  });

  it("a duplicate is one more instance, so it respects the type's own bound (hero ≤ 3, V6a)", () => {
    const heroes = [section("h1", "hero"), section("h2", "hero")];
    expect(canDuplicateSection(heroes, heroes[0])).toBe(true);
    const full = [...heroes, section("h3", "hero")];
    expect(canDuplicateSection(full, full[0])).toBe(false);
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
    expect(keys.sort()).toEqual([...ALL_HOME_SECTION_KEYS].sort());
    for (const type of ALL_HOME_SECTION_KEYS) {
      expect(SECTION_CAPABILITIES[type].type).toBe(type);
    }
  });

  it("only uses valid state values from the H4 vocabulary", () => {
    const valid = new Set(["live", "partial", "gated", "deferred"]);
    for (const type of ALL_HOME_SECTION_KEYS) {
      expect(valid.has(SECTION_CAPABILITIES[type].state)).toBe(true);
    }
  });

  it("never flattens a non-live state to live (H4-1 §5 truth matrix)", () => {
    // Exact truth matrix from CUST-H4-ARCH-1 §5 — PARTIAL/GATED sections must
    // keep their honest state, not read as LIVE. As of CUST-H4-7 every
    // section is genuinely LIVE (Offers has its real backend, picker, Canvas
    // and Published renderer).
    const expected: Record<string, string> = {
      hero: "live",
      categories: "live",
      newArrivals: "live",
      wholesale: "live",
      banner: "live",
      featured: "live",
      offers: "live",
      benefits: "live",
      appPromo: "live",
      customContent: "live",
      // FLOWERS-H9 / ADR-21 — read live by the storefront (H9b renderers).
      productShelf: "live",
      discovery: "live",
      deliveryPromise: "live",
    };
    for (const type of ALL_HOME_SECTION_KEYS) {
      expect(SECTION_CAPABILITIES[type].state).toBe(expected[type]);
    }
  });

  it("keeps the formalized gated state consistent with the existing isGatedHomeSection gate (empty today)", () => {
    for (const type of ALL_HOME_SECTION_KEYS) {
      expect(SECTION_CAPABILITIES[type].state === "gated").toBe(
        isGatedHomeSection(type),
      );
    }
  });

  it("documents Featured as truthfully LIVE now that CUST-H4-5 shipped the real picker + batched read", () => {
    expect(SECTION_CAPABILITIES.featured.state).toBe("live");
    expect(SECTION_CAPABILITIES.featured.merchantAddable).toBe(true);
    // LIVE sections never carry a reasonKey (that field only explains a
    // non-live state on the Library card).
    expect(SECTION_CAPABILITIES.featured.reasonKey).toBeUndefined();
  });

  it("documents Offers as LIVE and merchant-addable now that CUST-H4-6 + H4-7 shipped (no gated reason/badge left)", () => {
    expect(SECTION_CAPABILITIES.offers.state).toBe("live");
    expect(SECTION_CAPABILITIES.offers.merchantAddable).toBe(true);
    // LIVE sections never carry a reasonKey, and the stale "coming soon"
    // copy is gone from both locales.
    expect(SECTION_CAPABILITIES.offers.reasonKey).toBeUndefined();
    expect("sectionOffersComingSoon" in CUSTOMIZER_MESSAGES.ar).toBe(false);
    expect("sectionOffersComingSoon" in CUSTOMIZER_MESSAGES.en).toBe(false);
    expect(isGatedHomeSection("offers")).toBe(false);
  });

  it("lets a merchant add Offers via the public canAddSectionType/hasAddableSectionType API, with independent instances", () => {
    const sections = DEFAULT_PRESENTATION_CONFIG.homepage.sections;
    expect(canAddSectionType(sections, "offers")).toBe(true);
    const withoutOffers = sections.filter((s) => s.type !== "offers");
    expect(canAddSectionType(withoutOffers, "offers")).toBe(true);
    // canDuplicate / maxInstances: null — several Offers rails are allowed.
    expect(SECTION_CAPABILITIES.offers.canDuplicate).toBe(true);
    expect(SECTION_CAPABILITIES.offers.maxInstances).toBeNull();
    expect(SECTION_CAPABILITIES.offers.category).toBe("offersMarketing");
  });

  it("leaves every other section's capability state unchanged by the Offers transition", () => {
    for (const type of ALL_HOME_SECTION_KEYS) {
      expect(SECTION_CAPABILITIES[type].state).toBe("live");
      expect(SECTION_CAPABILITIES[type].merchantAddable).toBe(true);
    }
    // Featured stays live (H4-5) with its own duplicate rules untouched.
    expect(SECTION_CAPABILITIES.featured.canDuplicate).toBe(true);
  });

  it("maps every section to exactly one of the 7 taxonomy categories, none empty", () => {
    expect(SECTION_LIBRARY_CATEGORIES.length).toBe(7);
    const covered = new Set<string>();
    for (const type of ALL_HOME_SECTION_KEYS) {
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
    for (const type of ALL_HOME_SECTION_KEYS) {
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
    // Every type is merchant-addable (Offers flipped in CUST-H4-7), so
    // instance-count rules are the only remaining gate.
    for (const type of ALL_HOME_SECTION_KEYS) {
      expect(SECTION_CAPABILITIES[type].merchantAddable).toBe(true);
    }
    const sections = DEFAULT_PRESENTATION_CONFIG.homepage.sections.filter(
      (s) => s.type !== "appPromo",
    );
    expect(canAddSectionType(sections, "appPromo")).toBe(true);
  });
});

describe("FLOWERS-H9c data-backed sections (ADR-21)", () => {
  it("are addable, live, and kept out of the default document's key list", () => {
    for (const type of HOME_DATA_SECTION_KEYS) {
      expect(SECTION_CAPABILITIES[type].state).toBe("live");
      expect(SECTION_CAPABILITIES[type].merchantAddable).toBe(true);
      expect(canAddSectionType([], type)).toBe(true);
      expect(HOME_BUILDER_SECTION_KEYS).not.toContain(type);
      expect(ALL_HOME_SECTION_KEYS).toContain(type);
    }
    expect(DEFAULT_PRESENTATION_CONFIG.homepage.sections.some((entry) =>
      (HOME_DATA_SECTION_KEYS as readonly string[]).includes(entry.type),
    )).toBe(false);
  });

  it("allows many shelves/discovery blocks but a single delivery promise", () => {
    const shelves = [section("a", "productShelf"), section("b", "productShelf")];
    expect(canAddSectionType(shelves, "productShelf")).toBe(true);
    expect(canAddSectionType([section("a", "deliveryPromise")], "deliveryPromise")).toBe(false);
    expect(canDuplicateSection(shelves, shelves[0])).toBe(true);
    expect(canDuplicateSection([section("a", "deliveryPromise")], section("a", "deliveryPromise"))).toBe(false);
  });
});
