import { useSyncExternalStore } from "react";
import type { SectionDesign } from "../presentation/section-design";
import { normalizeSectionDesign } from "../presentation/section-design";

/**
 * CUST-HV V5d — copy / paste style between sections. In-memory and per editing
 * session on purpose: it is a convenience, never part of the document, and a stale
 * clipboard from another store/session must never be applied silently.
 *
 * Pasting goes through `normalizeSectionDesign(targetType, …)`, so a design copied
 * from a hero lands on a shelf with only what a shelf can render.
 */
let clip: { type: string; design: SectionDesign } | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function copyDesign(type: string, design: SectionDesign | undefined): boolean {
  if (!design || Object.keys(design).length === 0) return false;
  clip = { type, design: structuredClone(design) };
  emit();
  return true;
}

/** The design that would be applied to `type`, or `undefined` if nothing usable. */
export function pasteDesign(type: string): SectionDesign | undefined {
  if (!clip) return undefined;
  return normalizeSectionDesign(type, structuredClone(clip.design));
}

export function clearDesignClipboard(): void {
  clip = null;
  emit();
}

export function useDesignClipboard(): { type: string; design: SectionDesign } | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => clip,
    () => null,
  );
}
