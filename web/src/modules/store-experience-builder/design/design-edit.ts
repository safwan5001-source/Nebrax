import {
  type SectionDesign,
  normalizeSectionDesign,
} from "../presentation/section-design";

/**
 * CUST-HV V5d — every inspector edit goes through the contract normaliser, so what
 * the editor stores is exactly what the server would keep (defaults never stored,
 * fixed key order, empty groups omitted) — the same guarantee V4b gave `MediaRef`.
 */
export function commitDesign(
  type: string,
  next: SectionDesign,
): SectionDesign | undefined {
  return normalizeSectionDesign(type, next);
}

/** Replace one group (or remove it with `undefined`). */
export function setGroup<K extends keyof SectionDesign>(
  type: string,
  design: SectionDesign | undefined,
  group: K,
  value: SectionDesign[K] | undefined,
): SectionDesign | undefined {
  const next: SectionDesign = { ...(design ?? {}) };
  if (value === undefined) delete next[group];
  else next[group] = value;
  return commitDesign(type, next);
}
