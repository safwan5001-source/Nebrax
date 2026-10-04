import type { PresentationHomeSection } from "./config";
import {
  canAddSectionType,
  newHomeSectionId,
} from "./section-capabilities";

/**
 * FLOWERS-H15 / ADR-26 — the gift sections a "Flowers & Gifts" theme apply may
 * add to the *new draft version* it creates.
 *
 * Presentation only, and only what the store can actually back: a discovery
 * section per system facet (occasion / recipient) the merchant really has,
 * and the delivery-promise band only when delivery scheduling is configured.
 * Every section stores references and editorial text (ADR-21) — no products,
 * prices, availability or dates. Nothing is added twice, nothing existing is
 * moved or removed, and the section limits are respected.
 */
export interface FlowersPackInput {
  /** The merchant's own facet key for each system dimension, or `null` when they have none. */
  facetKeys: { occasion: string | null; recipient: string | null };
  /** `true` only when scheduling is enabled with at least one usable window. */
  deliveryScheduleConfigured: boolean;
  /** Editorial defaults (the merchant edits them in the builder). */
  copy: {
    occasionTitle: string;
    recipientTitle: string;
    deliveryPromiseTitle: string;
  };
}

export function applyFlowersGiftSections(
  sections: readonly PresentationHomeSection[],
  input: FlowersPackInput,
): PresentationHomeSection[] {
  const additions: PresentationHomeSection[] = [];
  let working: PresentationHomeSection[] = [...sections];

  const add = (section: PresentationHomeSection) => {
    if (!canAddSectionType(working, section.type)) return;
    additions.push(section);
    working = [...working, section];
  };

  const hasDiscovery = (dimension: string) =>
    sections.some(
      (section) =>
        section.type === "discovery" &&
        section.content !== undefined &&
        "axis" in section.content &&
        section.content.axis === "facet" &&
        section.content.dimension === dimension,
    );

  for (const [dimension, title] of [
    [input.facetKeys.occasion, input.copy.occasionTitle],
    [input.facetKeys.recipient, input.copy.recipientTitle],
  ] as const) {
    if (!dimension || hasDiscovery(dimension)) continue;
    add({
      id: newHomeSectionId(),
      type: "discovery",
      visible: true,
      content: { title, axis: "facet", dimension, display: "tiles" },
    });
  }

  if (
    input.deliveryScheduleConfigured &&
    !sections.some((section) => section.type === "deliveryPromise")
  ) {
    add({
      id: newHomeSectionId(),
      type: "deliveryPromise",
      visible: true,
      content: { title: input.copy.deliveryPromiseTitle, body: "" },
    });
  }

  if (additions.length === 0) return [...sections];

  // Directly after the hero when there is one, else first: shoppers meet
  // "shop by occasion" before the catalogue shelves. Existing order is kept.
  const heroIndex = sections.findIndex((section) => section.type === "hero");
  const at = heroIndex === -1 ? 0 : heroIndex + 1;
  return [...sections.slice(0, at), ...additions, ...sections.slice(at)];
}
