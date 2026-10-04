"use client";

/**
 * CUST-H4-2 — Section Library. Replaces the flat, unsearchable "add section"
 * list with a real merchant-facing library: search, the 7-category taxonomy
 * (CUST-H4-ARCH-1 §16), a short description and an honest state per card,
 * and already-added/max-instance copy instead of a silently-disabled button.
 *
 * CUST-H4-2 review fix (mobile contract): the Library's actual content
 * (`SectionLibraryContent`) is shared by both presentations, per the H4
 * mobile UX contract's existing Bottom Sheet convention:
 *
 * - **Desktop** (`SectionLibraryDialog`): a centered dialog — same
 *   precedent `PublishConfirmDialog` already set in `ExperienceBuilder.tsx`
 *   ("مركزيٌّ لا Bottom Sheet").
 * - **Mobile**: no second dialog at all. `HomepagePanel` renders
 *   `SectionLibraryContent` directly in place of its own composer body
 *   (same "sections" mobile sheet `ExperienceBuilder.tsx` already opens —
 *   no new `mobileSheet` wiring), so the merchant never sees a centered
 *   modal stacked on top of the existing Bottom Sheet, and there is never
 *   more than one `aria-modal` surface on screen. The content's own
 *   header control returns to the composer list (`setPickerOpen(false)`)
 *   without closing the sheet itself — a "back", not an "exit".
 *
 * CUST-H4-2 review fix (mobile UX polish): the header control's *meaning*
 * differs by presentation even though the handler is identical
 * (`onClose`), so its *affordance* must too — a second "×" next to the
 * sheet's own "×" reads as "close" when it actually means "back". The
 * `closeAction` prop ("close" | "back") switches the icon + accessible
 * label only; `SectionLibraryDialog` (desktop, where the control really
 * does close something) passes "close" explicitly, `HomepagePanel`'s
 * mobile branch passes "back".
 *
 * Adding a section still goes through the existing `addSection`/
 * `canAddSectionType` model (`HomepagePanel`) in both presentations — this
 * file only renders the picker surface; it owns no section-instance
 * mutation logic itself.
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

/**
 * Disabled-reason hierarchy (CUST-H4-2 review fix): a capability-level
 * non-addable reason always wins — a section withheld from merchant-addable
 * results (none today — `offers` went LIVE in CUST-H4-7) must explain *why*, never
 * fall through to a generic/empty reason. Only once the capability itself
 * allows adding do the document-wide cap and the per-type instance cap get
 * a turn.
 */
function addDisabledReasonKey(
  sections: readonly PresentationHomeSection[],
  cap: SectionCapability,
): CustomizerMessageKey | null {
  if (!cap.merchantAddable) return cap.reasonKey ?? null;
  if (sections.length >= MAX_HOME_SECTIONS) return "sectionLimitReached";
  if (cap.maxInstances !== null) {
    const count = sections.filter((section) => section.type === cap.type).length;
    if (count >= cap.maxInstances) return "sectionLibraryAlreadyAdded";
  }
  return null;
}

/**
 * The Library's actual search/category/card content, with no dialog/modal
 * chrome of its own — shared verbatim by the desktop centered dialog and
 * the mobile inline (Bottom Sheet) presentation. `listMaxHeightClassName`
 * lets each presentation cap the scrollable card area without depending on
 * a flex-sized ancestor: the desktop dialog is itself a bounded flex
 * column (`flex-1` correctly fills it), but the mobile Bottom Sheet's own
 * body is a plain `overflow-y-auto` div with no defined height for a
 * `flex-1` child to fill — a fixed viewport-relative cap (`max-h-[*vh]`,
 * the same fixed-height-region pattern `ProductPreviewPickerPanel` already
 * uses for its own nested card list) works in both cases.
 */
export function SectionLibraryContent({
  sections,
  t,
  onAdd,
  onClose,
  listMaxHeightClassName = "max-h-[60vh]",
  closeAction = "close",
}: {
  sections: readonly PresentationHomeSection[];
  t: (key: CustomizerMessageKey) => string;
  onAdd: (type: HomeBuilderSectionKey) => void;
  onClose: () => void;
  listMaxHeightClassName?: string;
  /** "close" (desktop dialog — really closes something) vs "back" (mobile —
   * returns to the composer inside the same still-open Bottom Sheet). Only
   * the header control's icon/label change; `onClose` is called either way. */
  closeAction?: "close" | "back";
}) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
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
      data-section-picker=""
      data-close-action={closeAction}
      className="flex min-h-0 flex-col"
    >
      <header className="flex shrink-0 items-start justify-between gap-2 border-b border-border p-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-text">
            {t("sectionLibraryTitle")}
          </h2>
          <p className="mt-0.5 text-xs text-muted">{t("sectionLibraryHint")}</p>
        </div>
        <button
          type="button"
          data-section-library-close-action={closeAction}
          aria-label={closeAction === "back" ? t("sectionLibraryBack") : t("close")}
          onClick={onClose}
          className="shrink-0 rounded-md p-1.5 text-muted hover:bg-primary-soft hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          {closeAction === "back" ? <BackIcon /> : <CloseIcon />}
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

      <div className={`${listMaxHeightClassName} overflow-y-auto p-4`}>
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
    </div>
  );
}

/**
 * Desktop presentation — centered dialog, not a Bottom Sheet, same
 * precedent `PublishConfirmDialog` already set in `ExperienceBuilder.tsx`
 * ("مركزيٌّ لا Bottom Sheet"). Mobile uses `SectionLibraryContent` directly
 * (see `HomepagePanel`) and never renders this wrapper — one `aria-modal`
 * surface at a time, never two nested.
 */
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
        aria-label={t("sectionLibraryTitle")}
        className="flex max-h-[85dvh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
      >
        <SectionLibraryContent
          sections={sections}
          t={t}
          onAdd={onAdd}
          onClose={onClose}
          listMaxHeightClassName="flex-1"
          closeAction="close"
        />
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
 * Drawn pointing start-ward (left) for LTR; `rtl:rotate-180` flips it to
 * point right under RTL — the same logical-direction pattern
 * `storefront/.../HeroSection.tsx` already uses for its own chevron
 * (`rtl:rotate-180`), not a hardcoded locale check.
 */
function BackIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-4 rtl:rotate-180"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
    >
      <path d="M9.5 3.5 4.5 8l5 4.5M4.5 8h7" strokeLinecap="round" strokeLinejoin="round" />
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
    case "productShelf":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="5" height="7" rx="0.75" />
          <rect x="12" y="4" width="5" height="7" rx="0.75" />
          <path d="M3 14h5M12 14h5" />
        </svg>
      );
    case "discovery":
      return (
        <svg {...common}>
          <circle cx="8.5" cy="8.5" r="4.5" />
          <path d="M12 12l4.5 4.5" />
        </svg>
      );
    case "deliveryPromise":
      return (
        <svg {...common}>
          <path d="M2.5 6.5h9v7h-9zM11.5 9h3l2 2v2.5h-5" />
          <circle cx="6" cy="14.5" r="1.25" />
          <circle cx="14" cy="14.5" r="1.25" />
        </svg>
      );
    default:
      return null;
  }
}
