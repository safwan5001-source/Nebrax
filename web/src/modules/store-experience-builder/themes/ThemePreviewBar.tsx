"use client";

/**
 * CUST-HV V10b (V0 §16) — the Preview and Apply-summary surface for a theme. It sits above the Canvas while the Canvas renders the
 * merchant's own document with the theme applied (unsaved, read-only). It lists exactly which design areas change and what is kept,
 * then offers the one write: "Apply as a new draft". Nothing here touches the Published Version.
 */

import { Check, Minus } from "lucide-react";
import { type CustomizerLocale, type CustomizerMessageKey, customizerMessage } from "../messages";
import { fillTemplate } from "../slider-edit";
import type { ThemeApplySummary, ThemeArea, ThemeKept } from "./apply-theme";
import type { ThemeDefinition } from "./theme-definition";

const AREA_LABEL: Record<ThemeArea, CustomizerMessageKey> = {
  identity: "themeAreaIdentity",
  typography: "themeAreaTypography",
  buttons: "themeAreaButtons",
  surfaces: "themeAreaSurfaces",
  cards: "themeAreaCards",
  layout: "themeAreaLayout",
  motion: "themeAreaMotion",
  header: "themeAreaHeader",
  footer: "themeAreaFooter",
  sections: "themeAreaSections",
};

const KEPT_LABEL: Record<ThemeKept, CustomizerMessageKey> = {
  content: "themeKeptContent",
  media: "themeKeptMedia",
  links: "themeKeptLinks",
  logos: "themeKeptLogos",
  navigation: "themeKeptNavigation",
  announcements: "themeKeptAnnouncements",
  order: "themeKeptOrder",
  visibility: "themeKeptVisibility",
};

export function ThemePreviewBar({
  locale,
  theme,
  summary,
  applying,
  error,
  canApply,
  onApply,
  onExit,
}: {
  locale: CustomizerLocale;
  theme: ThemeDefinition;
  summary: ThemeApplySummary;
  applying: boolean;
  error: CustomizerMessageKey | null;
  canApply: boolean;
  onApply: () => void;
  onExit: () => void;
}) {
  const t = (key: CustomizerMessageKey) => customizerMessage(locale, key);
  return (
    <section
      data-theme-preview-bar=""
      data-theme-id={theme.id}
      aria-label={t("themeSummaryTitle")}
      className="shrink-0 border-b border-border bg-surface px-3 py-3 md:px-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted">{t("themePreviewLabel")}</p>
          <h2 className="truncate text-base font-semibold text-text">
            <bdi>{theme.name[locale]}</bdi>
          </h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">{t("themePreviewNote")}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            data-theme-exit=""
            onClick={onExit}
            disabled={applying}
            className="inline-flex min-h-11 items-center rounded-md border border-border bg-surface px-4 text-sm font-medium text-text hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50 md:min-h-10"
          >
            {t("themeExitPreview")}
          </button>
          <button
            type="button"
            data-theme-apply=""
            onClick={onApply}
            disabled={applying || !canApply || summary.noop}
            className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50 md:min-h-10"
          >
            {applying ? t("themeApplying") : t("themeApply")}
          </button>
        </div>
      </div>

      {error ? (
        <p role="alert" data-theme-error="" className="mt-2 rounded-md border border-negative/30 bg-negative/5 px-3 py-2 text-xs text-negative">
          {t(error)}
        </p>
      ) : null}
      {summary.noop ? (
        <p data-theme-noop="" className="mt-2 text-xs text-muted">
          {t("themeNoop")}
        </p>
      ) : null}

      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <div>
          <h3 className="text-xs font-semibold text-text">{t("themeSummaryChanges")}</h3>
          <ul role="list" data-theme-areas="" className="mt-1.5 grid grid-cols-2 gap-1">
            {summary.areas.map((entry) => (
              <li
                key={entry.area}
                data-theme-area={entry.area}
                data-changed={entry.changed ? "" : undefined}
                className="flex items-center gap-2 text-xs"
              >
                {entry.changed ? (
                  <Check aria-hidden className="size-3.5 shrink-0 text-primary" />
                ) : (
                  <Minus aria-hidden className="size-3.5 shrink-0 text-muted" />
                )}
                <span className={entry.changed ? "font-medium text-text" : "text-muted"}>
                  {t(AREA_LABEL[entry.area])}
                  {entry.area === "sections" && entry.sectionIds && entry.sectionIds.length > 0
                    ? ` · ${fillTemplate(t("themeSectionsCount"), { n: entry.sectionIds.length })}`
                    : ""}
                </span>
                <span className="sr-only">{entry.changed ? t("themeAreaChanged") : t("themeAreaUnchanged")}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="text-xs font-semibold text-text">{t("themeSummaryKept")}</h3>
          <ul role="list" data-theme-kept="" className="mt-1.5 flex flex-wrap gap-1.5">
            {summary.kept.map((kept) => (
              <li key={kept} className="rounded-full bg-surface-muted px-2.5 py-1 text-[11px] text-muted">
                {t(KEPT_LABEL[kept])}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
