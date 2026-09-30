"use client";

/**
 * CUST-H2-4 — منتقي "معاينة تصنيف" في الشريط العلوي (سطح المكتب/الجهاز
 * اللوحي)، نسخة طبق الأصل من `ProductPreviewPicker` (CUST-H2-3): `Dropdown`
 * مشترك، نفس التموضع، ونفس تأجيل التسمية الكاملة إلى `xl` (1280px) — القرار
 * الذي كشفه تمرير Playwright الخاص بـH2-3 لقياس عرض الشريط العلوي عند
 * 1024px AR (راجع تقرير تنفيذ H2-3، "Responsive / Visual Verification") ينطبق
 * هنا حرفياً: منتقي ثانٍ بنفس الموضع يضيف نفس الضغط على نفس الميزانية
 * الضيّقة، فيُطبَّق نفس الحل دون إعادة قياسه من الصفر. الجوال يفتح ورقة سفلية
 * مستقلة من `ExperienceBuilder` (`mobileSheet === "category-picker"`) بنفس
 * `CategoryPreviewPickerPanel` — منطق واحد لا نسختان.
 */

import { useRef } from "react";
import { Dropdown } from "@/components/ui/dropdown";
import type { WorkspaceCategorySummary } from "@/modules/commerce-workspace/workspace-categories";
import { type CustomizerLocale, customizerMessage } from "./messages";
import { CategoryPreviewPickerPanel, type CategoryPickerListState } from "./CategoryPreviewPickerPanel";

export function CategoryPreviewPicker({
  locale,
  selectedCategory,
  listState,
  categories,
  search,
  onSearchChange,
  onSelect,
  onRetry,
  onOpenChange,
}: {
  locale: CustomizerLocale;
  selectedCategory: WorkspaceCategorySummary | null;
  listState: CategoryPickerListState;
  categories: WorkspaceCategorySummary[];
  search: string;
  onSearchChange: (value: string) => void;
  onSelect: (category: WorkspaceCategorySummary) => void;
  onRetry: () => void;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = (key: Parameters<typeof customizerMessage>[1]) => customizerMessage(locale, key);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <Dropdown
      align="start"
      menuLabel={t("categoryPickerMenuTitle")}
      triggerLabel={t("categoryPickerTriggerLabel")}
      triggerButtonRef={triggerRef}
      triggerClassName="h-7 min-w-0 max-w-[170px] gap-1 rounded-md px-1.5 text-[11px] text-muted hover:bg-primary-soft hover:text-primary"
      mobilePopover
      menuClassName="w-[min(20rem,calc(100vw-2rem))] p-2"
      onOpenChange={onOpenChange}
      trigger={
        <span data-category-preview-picker="" className="flex min-w-0 items-center gap-1">
          <CategoryIcon />
          {/* AWJ Decision — same finding CUST-H2-3 already measured for the
              Preview Product picker at the same toolbar position: deferring
              the full label to `xl` keeps this control icon-only through the
              entire budget-constrained 768–1279px range. */}
          <span className="hidden min-w-0 truncate font-medium xl:inline">
            {selectedCategory ? <bdi>{selectedCategory.name}</bdi> : t("categoryPickerNoSelectionLabel")}
          </span>
          <ChevronIcon />
        </span>
      }
    >
      {({ close }) => (
        <CategoryPreviewPickerPanel
          locale={locale}
          listState={listState}
          categories={categories}
          selectedCategoryId={selectedCategory?.id ?? null}
          search={search}
          onSearchChange={onSearchChange}
          onSelect={(category) => {
            onSelect(category);
            close();
            triggerRef.current?.focus();
          }}
          onRetry={onRetry}
        />
      )}
    </Dropdown>
  );
}

function CategoryIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <path d="M2.5 3.5h11M2.5 8h11M2.5 12.5h5" strokeLinecap="round" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-3 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}
