/**
 * CUST-HV V10b (V0 §16, step 3) — "Apply theme" as one ordered, revision-checked write: create a NEW Draft Version, save the
 * themed document into it, and roll the version back if the save fails. The Published Version and every existing Version are
 * never an input to a write, so applying can always be undone by switching back to the previous Version.
 *
 * The themed document is `applyTheme(base, theme)` over the document the merchant was looking at when they previewed — not a
 * fresh default — so the preview and the saved draft are the same pixels. The optional gift pack adds only sections the store
 * can back (FLOWERS-H15); if it cannot be computed the theme still applies without it.
 */

import {
  createPresentationVersion,
  deletePresentationVersion,
  savePresentationVersion,
} from "@/modules/commerce-workspace/presentation-versions";
import type { PresentationHomeSection, StorefrontPresentationConfig } from "../presentation/config";
import { type ThemeApplication, applyTheme, withThemePack } from "./apply-theme";
import type { ThemeDefinition } from "./theme-definition";

export type ApplyThemeFlowResult =
  | { ok: true; versionId: string }
  | { ok: false; reason: "assets_unsupported" | "create_failed" | "save_failed" };

/** The pack step on its own: the sections the store can back for a themed pack, or `null` (never throws). */
export async function computeThemePack(
  theme: ThemeDefinition,
  sections: readonly PresentationHomeSection[],
  giftSections?: (sections: readonly PresentationHomeSection[]) => Promise<PresentationHomeSection[] | null>,
): Promise<PresentationHomeSection[] | null> {
  if (!theme.pack || !giftSections) return null;
  try {
    return await giftSections(sections);
  } catch {
    return null;
  }
}

/** The one write: a NEW draft holding exactly `config` (what was previewed), rolled back if the save fails. */
export async function writeThemedDraft(args: {
  storefrontId: string;
  config: StorefrontPresentationConfig;
  versionName: string;
}): Promise<ApplyThemeFlowResult> {
  const { storefrontId, config, versionName } = args;
  const created = await createPresentationVersion(storefrontId, versionName);
  if (!created.ok) return { ok: false, reason: "create_failed" };

  const saved = await savePresentationVersion(storefrontId, created.data.id, config, created.data.revision);
  if (!saved.ok) {
    await deletePresentationVersion(storefrontId, created.data.id);
    return { ok: false, reason: "save_failed" };
  }
  return { ok: true, versionId: created.data.id };
}

export async function applyThemeAsNewDraft(args: {
  storefrontId: string;
  base: StorefrontPresentationConfig;
  theme: ThemeDefinition;
  versionName: string;
  /** Sections the store can back for a themed pack; `null` (or a throw) means "add none". */
  giftSections?: (sections: readonly PresentationHomeSection[]) => Promise<PresentationHomeSection[] | null>;
}): Promise<ApplyThemeFlowResult> {
  const { storefrontId, base, theme, versionName, giftSections } = args;

  const applied = applyTheme(base, theme);
  if (!applied.ok) return { ok: false, reason: applied.reason };
  const application: ThemeApplication = withThemePack(
    applied,
    await computeThemePack(theme, applied.config.homepage.sections, giftSections),
  );
  if (!application.ok) return { ok: false, reason: application.reason };
  return writeThemedDraft({ storefrontId, config: application.config, versionName });
}
