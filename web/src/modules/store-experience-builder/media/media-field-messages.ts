/**
 * AWJ-VD-H1 / VD-3 — message adapter for `MediaRefField` / `MediaPicker` outside the Customizer.
 *
 * Both components take a translator over the Customizer catalog. Another surface (the facet identity editor) keeps its
 * own catalog, so it builds the translator here: the shared media wording comes from the Customizer catalog (one
 * source for the picker, the states and the alt fields — nothing duplicated), and the few phrases that differ for the
 * surface are overridden by key.
 */

import { type CustomizerLocale, type CustomizerMessageKey, customizerMessage } from "../messages";

export type MediaFieldOverrides = Partial<Record<CustomizerMessageKey, string>>;

export function createMediaFieldT(
  locale: CustomizerLocale,
  overrides: MediaFieldOverrides = {},
): (key: CustomizerMessageKey) => string {
  return (key) => overrides[key] ?? customizerMessage(locale, key);
}
