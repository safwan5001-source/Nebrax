/**
 * CUST-HV V10c (V0 §17.2) — built-in section style presets: a curated, structural `design` per section type (shape, border, shadow,
 * rhythm — never a colour, so a preset can never fail a contrast gate), plus the default each built-in theme gives that type. A preset
 * is offered only when the type can use at least one of its groups; applying it replaces the section's design (content untouched),
 * exactly like Paste style, and goes through the same normaliser.
 */

import { type SectionDesign, normalizeSectionDesign } from "../presentation/section-design";
import { BUILT_IN_THEMES } from "./built-in-themes";

export interface SectionPreset {
  id: string;
  label: { ar: string; en: string };
  design: SectionDesign;
}

const STRUCTURAL: ReadonlyArray<{ id: string; label: { ar: string; en: string }; raw: Record<string, unknown> }> = [
  {
    id: "soft",
    label: { ar: "بطاقة ناعمة", en: "Soft card" },
    raw: { radius: "lg", shadow: "soft", border: { width: "hairline" } },
  },
  {
    id: "flat",
    label: { ar: "مسطّح", en: "Flat" },
    raw: { radius: "none", shadow: "none", border: { width: "hairline" } },
  },
  {
    id: "airy",
    label: { ar: "مريح", en: "Airy" },
    raw: { spacing: { top: "lg", bottom: "lg" } },
  },
  {
    id: "tight",
    label: { ar: "مضغوط", en: "Tight" },
    raw: { spacing: { top: "sm", bottom: "sm" } },
  },
];

export function sectionPresetsFor(type: string): SectionPreset[] {
  const out: SectionPreset[] = [];
  const seen = new Set<string>();
  const add = (id: string, label: SectionPreset["label"], raw: unknown) => {
    const design = normalizeSectionDesign(type, raw);
    if (!design) return;
    const key = JSON.stringify(design);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ id, label, design });
  };
  for (const preset of STRUCTURAL) add(preset.id, preset.label, preset.raw);
  for (const theme of BUILT_IN_THEMES) {
    add(`theme:${theme.id}`, theme.name, theme.sectionDefaults?.[type]);
  }
  return out;
}
