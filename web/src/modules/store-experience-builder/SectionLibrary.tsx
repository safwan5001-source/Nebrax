"use client";

/**
 * CUST-H4-2 — Section Library. Replaces the flat, unsearchable "add section"
 * list with a real merchant-facing library: search, the 7-category taxonomy
 * (CUST-H4-ARCH-1 §16), a short description and an honest state per card,
 * and already-added/max-instance copy instead of a silently-disabled button.
 *
 * Centered dialog, not a Bottom Sheet — same markup on mobile and desktop,
 * same precedent `PublishConfirmDialog` already set in `ExperienceBuilder.tsx`
 * ("مركزيٌّ لا Bottom Sheet"). It opens from `HomepagePanel`'s own local
 * `pickerOpen` state, so on mobile it nests inside the generic "sections"
 * Bottom Sheet the same way the old inline list already did — no new wiring
 * into `ExperienceBuilder`'s `mobileSheet` state is needed.
 *
 * Adding a section still goes through the existing `addSection`/
 * `canAddSectionType` model (`HomepagePanel`) — this file only renders the
 * picker surface; it owns no section-instance mutation logic itself.
 */

import { useId, useState } from "react";
import {
  canAddSectionType,
  MAX_HOME_SECTIONS,
  SECTION_CAPABILITIES,
  SECTION_LIBRARY_CATEGORIES,
  SECTION_LIBRARY_CATEGORY_LABEL,
  sectionTypesInCategory,
  type HomeBuilderSectionKey,
  type PresentationHomeSection,
  type SectionCapability,
  type SectionLibraryCategory,
} from "./presentation";
import { type CustomizerMessageKey } from "./messages";

type CategoryFilter = SectionLibraryCategory | "all";

function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function addDisabledReasonKey(
  sections: readonly PresentationHomeSection[],
  cap: SectionCapability,
): CustomizerMessageKey | null {
  if (!cap.merchantAddable) return null;
  if (sections.length >= MAX_HOME_SECTIONS) return "sectionLimitReached";
  if (cap.maxInstances !== null) {
    const count = sections.filter((section) => section.type === cap.type).length;
    if (count >= cap.maxInstances) return "sectionLibraryAlreadyAdded";
  }
  return null;
}

export function SectionLibraryDialog({
  sections,
  t,
  onAdd,
  onClose,
}: {
  sections: readonly PresentationHomeSection[];
  t: (key: CustomizerMessageKey) => string;
  onAdd: (type: HomeBuilderSectionKey) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const titleId = useId();
  const searchId = useId();

  const normalizedSearch = normalizeSearchText(search);

  const matchesSearch = (type: HomeBuilderSectionKey): boolean => {
    if (!normalizedSearch) return true;
    const cap = SECTION_CAPABILITIES[type];
    const haystack = `${t(cap.titleKey)} ${t(cap.descriptionKey)}`;
    return normalizeSearchText(haystack).includes(normalizedSearch);
  };

  const matchesCategory = (type: HomeBuilderSectionKey): boolean =>
    category === "all" || SECTION_CAPABILITIES[type].category === category;

  // A ~10-entry filter per keystroke needs no memoization.
  const groups = SECTION_LIBRARY_CATEGORIES.map((cat) => ({
    category: cat,
    types: sectionTypesInCategory(cat).filter(
      (type) => matchesCategory(type) && matchesSearch(type),
    ),
  })).filter((group) => group.types.length > 0);

  const totalVisible = groups.reduce((n, group) => n + group.types.length, 0);
  const showHeadings = category === "all";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-section-picker=""
        className="flex max-h-[85dvh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-2 border-b border-border p-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-sm font-semibold text-text">
              {t("sectionLibraryTitle")}
            </h2>
            <p className="mt-0.5 text-xs text-muted">{t("sectionLibraryHint")}</p>
          </div>
          <button
            type="button"
            aria-label={t("close")}
            onClick={onClose}
            className="shrink-0 rounded-md p-1.5 text-muted hover:bg-primary-soft hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="shrink-0 space-y-2.5 border-b border-border p-4">
          <label className="sr-only" htmlFor={searchId}>
            {t("sectionLibrarySearchLabel")}
          </label>
          <input
            id={searchId}
            type="search"
            autoFocus
            data-section-library-search=""
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("sectionLibrarySearchPlaceholder")}
            className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          />
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("sectionLibrarySearchLabel")}>
            <CategoryChip
              label={t("sectionLibraryAllCategories")}
              active={category === "all"}
              onClick={() => setCategory("all")}
            />
            {SECTION_LIBRARY_CATEGORIES.map((cat) => (
              <CategoryChip
                key={cat}
                label={t(SECTION_LIBRARY_CATEGORY_LABEL[cat])}
                active={category === cat}
                onClick={() => setCategory(cat)}
                dataCategory={cat}
              />
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {totalVisible === 0 ? (
            <p data-section-library-empty="" className="py-8 text-center text-sm text-muted">
              {t("sectionLibraryEmptySearch")}
            </p>
          ) : (
            <div className="space-y-5">
              {groups.map((group) => (
                <div key={group.category}>
                  {showHeadings ? (
                    <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
                      {t(SECTION_LIBRARY_CATEGORY_LABEL[group.category])}
                    </h3>
                  ) : null}
                  <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {group.types.map((type) => (
                      <SectionLibraryCard
                        key={type}
                        type={type}
                        sections={sections}
                        t={t}
                        onAdd={onAdd}
                      />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function CategoryChip({
  label,
  active,
  onClick,
  dataCategory,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  dataCategory?: string;
}) {
  return (
    <button
      type="button"
      data-section-library-category={dataCategory ?? "all"}
      aria-pressed={active}
      onClick={onClick}
      className={`h-7 shrink-0 rounded-full border px-2.5 text-[12px] font-medium ${
        active
          ? "border-primary bg-primary-soft text-primary"
          : "border-border bg-surface text-muted hover:bg-primary-soft hover:text-text"
      }`}
    >
      {label}
    </button>
  );
}

function SectionLibraryCard({
  type,
  sections,
  t,
  onAdd,
}: {
  type: HomeBuilderSectionKey;
  sections: readonly PresentationHomeSection[];
  t: (key: CustomizerMessageKey) => string;
  onAdd: (type: HomeBuilderSectionKey) => void;
}) {
  const cap = SECTION_CAPABILITIES[type];
  const addable = canAddSectionType(sections, type);
  const disabledReasonKey = addable ? null : addDisabledReasonKey(sections, cap);
  const stateBadge =
    cap.state === "partial"
      ? t("sectionLibraryStatePartial")
      : cap.state === "gated"
        ? t("gatedBadge")
        : null;
  const reasonText = disabledReasonKey
    ? t(disabledReasonKey)
    : cap.reasonKey
      ? t(cap.reasonKey)
      : null;

  return (
    <li>
      <button
        type="button"
        data-picker-option={type}
        data-section-state={cap.state}
        disabled={!addable}
        onClick={() => onAdd(type)}
        className={`flex w-full items-start gap-2.5 rounded-md border px-2.5 py-2.5 text-start outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 ${
          addable
            ? "border-border bg-surface hover:border-primary/50 hover:bg-primary-soft"
            : "cursor-not-allowed border-border bg-surface-muted opacity-70"
        }`}
      >
        <SectionThumbnail type={type} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <bdi className="min-w-0 truncate text-[13px] font-medium text-text">
              {t(cap.titleKey)}
            </bdi>
            {stateBadge ? (
              <span className="shrink-0 rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-medium text-muted">
                {stateBadge}
              </span>
            ) : null}
          </span>
          <span className="block truncate text-[11px] leading-4 text-muted">
            {t(cap.descriptionKey)}
          </span>
          {reasonText ? (
            <span
              data-section-library-reason=""
              className="mt-0.5 block text-[11px] leading-4 text-muted"
            >
              {reasonText}
            </span>
          ) : null}
        </span>
        {addable ? (
          <span className="shrink-0 self-center text-[11px] font-semibold text-primary">
            {t("sectionLibraryAdd")}
          </span>
        ) : null}
      </button>
    </li>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <path d="M3.5 3.5 12.5 12.5M12.5 3.5 3.5 12.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Lightweight, deterministic, per-type glyph — no network, no fake commerce
 * data, no fully-rendered mini preview. Purpose is visual distinction only
 * (CUST-H4-2 scope: "help merchants visually distinguish section types").
 */
function SectionThumbnail({ type }: { type: HomeBuilderSectionKey }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary"
    >
      <SectionGlyph type={type} />
    </span>
  );
}

function SectionGlyph({ type }: { type: HomeBuilderSectionKey }) {
  const common = {
    viewBox: "0 0 20 20",
    className: "size-4",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (type) {
    case "hero":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="14" height="12" rx="1" />
          <path d="M6 8h8M6 11h5" />
        </svg>
      );
    case "categories":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="6" height="6" rx="1" />
          <rect x="11" y="3" width="6" height="6" rx="1" />
          <rect x="3" y="11" width="6" height="6" rx="1" />
          <rect x="11" y="11" width="6" height="6" rx="1" />
        </svg>
      );
    case "newArrivals":
      return (
        <svg {...common}>
          <path d="M10 3v10M10 3l-3 3M10 3l3 3" />
          <path d="M4 14h12v3H4z" />
        </svg>
      );
    case "wholesale":
      return (
        <svg {...common}>
          <rect x="3" y="7" width="6" height="9" rx="0.5" />
          <rect x="11" y="4" width="6" height="12" rx="0.5" />
          <path d="M3 11h6M11 8h6" />
        </svg>
      );
    case "banner":
      return (
        <svg {...common}>
          <rect x="3" y="5" width="14" height="10" rx="1" />
          <path d="M3 9h14" />
          <circle cx="7" cy="7" r="0.75" fill="currentColor" stroke="none" />
        </svg>
      );
    case "featured":
      return (
        <svg {...common}>
          <path d="M10 3l1.8 3.7 4 .6-3 2.9.7 4-3.5-1.9-3.5 1.9.7-4-3-2.9 4-.6z" />
        </svg>
      );
    case "offers":
      return (
        <svg {...common}>
          <path d="M4 10 10 4h6v6l-6 6-6-6z" />
          <circle cx="12" cy="6" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case "benefits":
      return (
        <svg {...common}>
          <path d="M10 3l6 2v5c0 4-2.7 6.4-6 7-3.3-.6-6-3-6-7V5z" />
          <path d="M7.5 10l1.8 1.8 3.2-3.6" />
        </svg>
      );
    case "appPromo":
      return (
        <svg {...common}>
          <rect x="6" y="2.5" width="8" height="15" rx="1.5" />
          <path d="M9 15h2" />
        </svg>
      );
    case "customContent":
      return (
        <svg {...common}>
          <path d="M4 5h12M4 9h12M4 13h8" />
        </svg>
      );
    default:
      return null;
  }
}
