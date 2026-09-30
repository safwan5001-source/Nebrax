"use client";

/**
 * CUST-H2-4 — محتوى منتقي "معاينة تصنيف"، مُعاد استعماله من موضعين بالضبط
 * كما `ProductPreviewPickerPanel` (CUST-H2-3): داخل قائمة `CategoryPreviewPicker`
 * المنسدلة على سطح المكتب/الجهاز اللوحي، وداخل ورقة سفلية مستقلة على الجوال
 * (`ExperienceBuilder`). الحالة (القائمة/التحميل/البحث) تعيش في `ExperienceBuilder`
 * وحده — هذا مكوّنٌ عرضي بحت، بلا طلب شبكة خاص به.
 *
 * الاختيار **سياق محرِّر بحت** — لا يُكتَب إلى `pagePresentation`، لا يُغيِّر
 * `dirty`. راجع `ExperienceBuilder`'s `previewCategoryId`.
 *
 * `parentName` يُعرَض كسطر ثانٍ خافت تحت الاسم (تلميح تسلسل هرمي) لتمييز
 * تصنيفات بنفس الاسم أو لتوضيح موضع التصنيف — لا يُعرَض المعرّف الخام أبداً
 * كتسمية أساسية.
 */

import type { WorkspaceCategorySummary } from "@/modules/commerce-workspace/workspace-categories";
import { type CustomizerLocale, type CustomizerMessageKey, customizerMessage } from "./messages";

export type CategoryPickerListState = "idle" | "loading" | "error" | "ready";

export function CategoryPreviewPickerPanel({
  locale,
  listState,
  categories,
  selectedCategoryId,
  search,
  onSearchChange,
  onSelect,
  onRetry,
}: {
  locale: CustomizerLocale;
  listState: CategoryPickerListState;
  categories: WorkspaceCategorySummary[];
  selectedCategoryId: string | null;
  search: string;
  onSearchChange: (value: string) => void;
  onSelect: (category: WorkspaceCategorySummary) => void;
  onRetry: () => void;
}) {
  const t = (key: CustomizerMessageKey) => customizerMessage(locale, key);

  return (
    <div data-category-picker-panel="" className="flex flex-col gap-2">
      <label className="sr-only" htmlFor="category-picker-search">
        {t("categoryPickerSearchLabel")}
      </label>
      <input
        id="category-picker-search"
        type="search"
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder={t("categoryPickerSearchPlaceholder")}
        className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      />
      <div role="listbox" aria-label={t("categoryPickerMenuTitle")} className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
        {listState === "loading" ? (
          <p data-category-picker-loading="" className="px-3 py-4 text-center text-sm text-muted">
            {t("categoryPickerLoading")}
          </p>
        ) : listState === "error" ? (
          <div data-category-picker-error="" className="flex flex-col items-center gap-2 px-3 py-4 text-center text-sm text-muted">
            <span>{t("categoryPickerLoadFailed")}</span>
            <button
              type="button"
              onClick={onRetry}
              className="rounded-md border border-border px-3 py-1 text-xs font-medium text-text hover:bg-primary-soft"
            >
              {t("retry")}
            </button>
          </div>
        ) : categories.length === 0 ? (
          <p data-category-picker-empty="" className="px-3 py-4 text-center text-sm text-muted">
            {t("categoryPickerEmpty")}
          </p>
        ) : (
          categories.map((category) => {
            const selected = category.id === selectedCategoryId;
            return (
              <button
                key={category.id}
                type="button"
                role="option"
                aria-selected={selected}
                data-category-option={category.id}
                onClick={() => onSelect(category)}
                className={`flex min-h-11 w-full items-center gap-2.5 rounded-md px-2 text-start text-sm ${
                  selected ? "bg-primary-soft font-medium text-primary" : "text-text hover:bg-primary-soft"
                }`}
              >
                <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-muted">
                  <CategoryPlaceholderIcon />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">
                    <bdi>{category.name}</bdi>
                  </span>
                  {category.parentName ? (
                    <span className="block truncate text-xs text-muted">
                      <bdi>{category.parentName}</bdi>
                    </span>
                  ) : null}
                </span>
                {selected ? <SelectedCheckIcon /> : null}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function CategoryPlaceholderIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-4 text-muted" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <path d="M2.5 3.5h11M2.5 8h11M2.5 12.5h5" strokeLinecap="round" />
    </svg>
  );
}

function SelectedCheckIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5 shrink-0 text-primary" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden="true">
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
    </svg>
  );
}
