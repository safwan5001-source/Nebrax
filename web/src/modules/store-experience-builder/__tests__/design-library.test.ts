import { describe, expect, it } from "vitest";
import {
  clonePresentationConfig,
  DEFAULT_PRESENTATION_CONFIG,
  normalizePresentationConfig,
  type StorefrontPresentationConfig,
} from "../presentation";
import {
  DESIGN_LIBRARY_VARIANTS,
  type SectionDesignLibraryVariant,
} from "../design-library";

describe("AWJ Store Design Library Phase 1 contract", () => {
  it("keeps the legacy document byte-compatible until a merchant applies a variant", () => {
    const legacy = clonePresentationConfig(DEFAULT_PRESENTATION_CONFIG);
    expect(legacy.cards).toBeUndefined();
    expect(normalizePresentationConfig(legacy)).toEqual(legacy);
  });

  it("ships exactly six unique variants across five supported categories", () => {
    expect(DESIGN_LIBRARY_VARIANTS).toHaveLength(6);
    expect(new Set(DESIGN_LIBRARY_VARIANTS.map((variant) => variant.id)).size).toBe(6);
    expect(new Set(DESIGN_LIBRARY_VARIANTS.map((variant) => variant.category))).toEqual(
      new Set(["products", "categories", "promotions", "featured", "content"]),
    );
  });

  it("round-trips every preset through the existing published configuration normalizer", () => {
    for (const variant of DESIGN_LIBRARY_VARIANTS) {
      let draft = clonePresentationConfig(DEFAULT_PRESENTATION_CONFIG);
      if (variant.scope === "global") {
        draft = {
          ...draft,
          productCard: variant.productCard,
          cards: variant.cards,
        };
        const stored = normalizePresentationConfig(draft);
        expect(stored.productCard).toBe(variant.productCard);
        expect(stored.cards).toEqual(variant.cards);
      } else {
        const exists = draft.homepage.sections.some(
          (section) => section.type === variant.sectionType,
        );
        draft = {
          ...draft,
          homepage: {
            ...draft.homepage,
            sections: exists
              ? draft.homepage.sections.map((section) =>
                  section.type === variant.sectionType
                    ? { ...section, design: variant.design }
                    : section,
                )
              : [
                  ...draft.homepage.sections,
                  {
                    id: `library-${variant.id}`,
                    type: variant.sectionType,
                    visible: true,
                    design: variant.design,
                  },
                ],
          },
        } as StorefrontPresentationConfig;
        const stored = normalizePresentationConfig(draft);
        expect(
          stored.homepage.sections.find(
            (section) => section.type === variant.sectionType,
          )?.design,
        ).toEqual(variant.design);
      }
    }
  });

  it("contains only section presets accepted by their existing type capability", () => {
    const sectionVariants = DESIGN_LIBRARY_VARIANTS.filter(
      (variant): variant is SectionDesignLibraryVariant =>
        variant.scope === "section",
    );
    expect(sectionVariants).toHaveLength(5);
    expect(sectionVariants.every((variant) => Object.keys(variant.design).length > 0)).toBe(true);
  });
});
