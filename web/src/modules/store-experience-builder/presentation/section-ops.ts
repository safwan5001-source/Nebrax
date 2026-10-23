/**
 * CUST-HV V10d — the homepage section-list operations as pure functions over the document, so the one place that decides what "move",
 * "hide", "duplicate" and "delete" mean is shared by the section list (ControlPanels) and the Canvas hover action bar. None of them
 * performs I/O; each returns the next document (or `null` when the operation is not allowed), and the caller commits it through the
 * builder's normal draft update — so every effect is a draft edit, revision-checked at Save like any other.
 */

import type { PresentationHomeSection, StorefrontPresentationConfig } from "./config";
import { canDeleteSection, canDuplicateSection, newHomeSectionId } from "./section-capabilities";
import { type HeroContent, heroContentOf } from "./section-content";
import { MAX_SECTION_LABEL } from "./config";

export type SectionOpResult = StorefrontPresentationConfig;

function withSections(
  config: StorefrontPresentationConfig,
  sections: PresentationHomeSection[],
): StorefrontPresentationConfig {
  return { ...config, homepage: { ...config.homepage, sections } };
}

/** The legacy global hero text as the explicit content of an instance (V0 §8.1.4). */
export function legacyHeroContent(homepage: { heroHeadline: string; heroSubheadline: string }): HeroContent {
  const subheadline = homepage.heroSubheadline.trim();
  return {
    headline: homepage.heroHeadline.trim(),
    ...(subheadline ? { subheadline } : {}),
  };
}

/**
 * A hero is "authored" once it says something — an explicit empty headline is not content to lose. A display choice is a merchant
 * edit too (AWJ-HERO-DISPLAY): hiding the title / description / buttons, or linking the picture, is worth a delete confirmation
 * even while the text fields are still empty.
 */
export function isHeroAuthored(content: HeroContent | undefined): boolean {
  if (!content) return false;
  return (
    content.headline.trim() !== "" ||
    (content.subheadline ?? "").trim() !== "" ||
    (content.ctas?.length ?? 0) > 0 ||
    content.showTitle === false ||
    content.showSubheadline === false ||
    content.showCtas === false ||
    (content.imageHref ?? "").trim() !== ""
  );
}

/** Whether removing the section would lose something the merchant wrote or designed (so deleting asks first). */
export function sectionIsAuthored(section: PresentationHomeSection): boolean {
  return Boolean(
    (section.content &&
      (section.type === "hero"
        ? isHeroAuthored(heroContentOf(section))
        : Object.keys(section.content).length > 0)) ||
      (section.design && Object.keys(section.design).length > 0) ||
      // a name the merchant typed is authored too (V10c): deleting it deserves the same confirmation
      Boolean(section.label),
  );
}

/**
 * The name of a duplicated section: the original's, plus a suffix, never past the limit. When it does not fit, the ORIGINAL name is
 * shortened — the suffix is what tells the two apart, so it is never the part that is cut.
 */
export function copyLabel(label: string, suffix: string): string {
  const tail = ` · ${suffix}`;
  const room = Math.max(0, MAX_SECTION_LABEL - Array.from(tail).length);
  const head = Array.from(label);
  const kept = head.length <= room ? label : head.slice(0, room).join("").trimEnd();
  return `${kept}${tail}`;
}

export function canMoveSection(config: StorefrontPresentationConfig, id: string, delta: 1 | -1): boolean {
  const sections = config.homepage.sections;
  const index = sections.findIndex((section) => section.id === id);
  return index >= 0 && index + delta >= 0 && index + delta < sections.length;
}

/** Move one section to a new index (drag and drop, or a step). `null` when nothing would change. */
export function moveSectionTo(
  config: StorefrontPresentationConfig,
  fromIndex: number,
  toIndex: number,
): SectionOpResult | null {
  const sections = config.homepage.sections;
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= sections.length ||
    toIndex >= sections.length
  ) {
    return null;
  }
  const next = [...sections];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return withSections(config, next);
}

export function moveSection(config: StorefrontPresentationConfig, id: string, delta: 1 | -1): SectionOpResult | null {
  const index = config.homepage.sections.findIndex((section) => section.id === id);
  return index < 0 ? null : moveSectionTo(config, index, index + delta);
}

/** Show or hide a section. The app-promo section also carries the store's app switch, kept in step with it. */
export function setSectionVisible(
  config: StorefrontPresentationConfig,
  id: string,
  visible: boolean,
): SectionOpResult | null {
  const sections = config.homepage.sections;
  const current = sections.find((section) => section.id === id);
  if (!current) return null;
  const next = withSections(
    config,
    sections.map((section) => (section.id === id ? { ...section, visible } : section)),
  );
  return current.type === "appPromo" ? { ...next, apps: { ...config.apps, showHomepageSection: visible } } : next;
}

/** Duplicate with design (content, design and a suffixed name), right after the original, under a new id. */
export function duplicateSection(
  config: StorefrontPresentationConfig,
  id: string,
  copySuffix: string,
): { config: SectionOpResult; id: string } | null {
  const sections = config.homepage.sections;
  const index = sections.findIndex((section) => section.id === id);
  const source = sections[index];
  if (!source || !canDuplicateSection(sections, source)) return null;
  const copy: PresentationHomeSection = {
    id: newHomeSectionId(),
    type: source.type,
    visible: source.visible,
    ...(source.label ? { label: copyLabel(source.label, copySuffix) } : {}),
    ...(source.content ? { content: structuredClone(source.content) } : {}),
    ...(source.design ? { design: structuredClone(source.design) } : {}),
  };
  // A hero still reading the legacy globals is copied with that text made explicit, so the duplicate is a real
  // instance and does not depend on the globals the original still reads.
  if (source.type === "hero" && !source.content) copy.content = legacyHeroContent(config.homepage);
  const next = [...sections];
  next.splice(index + 1, 0, copy);
  return { config: withSections(config, next), id: copy.id };
}

/** Delete (removing the instance is the real delete — there is no resurrection). The fallback is the next sibling, else the previous. */
export function deleteSection(
  config: StorefrontPresentationConfig,
  id: string,
): { config: SectionOpResult; fallbackId: string | null } | null {
  const sections = config.homepage.sections;
  const index = sections.findIndex((section) => section.id === id);
  const removed = sections[index];
  if (!removed || !canDeleteSection(removed)) return null;
  const next = sections.filter((_, i) => i !== index);
  const fallback = next[index] ?? next[index - 1] ?? null;
  return { config: withSections(config, next), fallbackId: fallback ? fallback.id : null };
}
