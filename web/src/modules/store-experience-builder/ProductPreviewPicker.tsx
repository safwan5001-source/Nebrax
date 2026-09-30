"use client";

/**
 * CUST-H2-3 — منتقي "معاينة منتج" في الشريط العلوي (سطح المكتب/الجهاز
 * اللوحي)، بنفس نمط `PageNavigator` بالضبط: `Dropdown` مشترك، نفس تموضع
 * `mobilePopover`. الجوال يفتح ورقة سفلية مستقلة من `ExperienceBuilder`
 * (`mobileSheet === "product-picker"`) بنفس `ProductPreviewPickerPanel` —
 * منطق واحد لا نسختان.
 */

import { useRef } from "react";
import { Dropdown } from "@/components/ui/dropdown";
import type { WorkspaceProductSummary } from "@/modules/commerce-workspace/workspace-products";
import { type CustomizerLocale, customizerMessage } from "./messages";
import { ProductPreviewPickerPanel, type ProductPickerListState } from "./ProductPreviewPickerPanel";

export function ProductPreviewPicker({
  locale,
  selectedProduct,
  listState,
  products,
  search,
  onSearchChange,
  onSelect,
  onRetry,
  onOpenChange,
}: {
  locale: CustomizerLocale;
  selectedProduct: WorkspaceProductSummary | null;
  listState: ProductPickerListState;
  products: WorkspaceProductSummary[];
  search: string;
  onSearchChange: (value: string) => void;
  onSelect: (product: WorkspaceProductSummary) => void;
  onRetry: () => void;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = (key: Parameters<typeof customizerMessage>[1]) => customizerMessage(locale, key);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <Dropdown
      align="start"
      menuLabel={t("productPickerMenuTitle")}
      triggerLabel={t("productPickerTriggerLabel")}
      triggerButtonRef={triggerRef}
      triggerClassName="h-7 min-w-0 max-w-[170px] gap-1 rounded-md px-1.5 text-[11px] text-muted hover:bg-primary-soft hover:text-primary"
      mobilePopover
      menuClassName="w-[min(20rem,calc(100vw-2rem))] p-2"
      onOpenChange={onOpenChange}
      trigger={
        <span data-product-preview-picker="" className="flex min-w-0 items-center gap-1">
          <ProductIcon />
          {/* AWJ Decision (found by this slice's own Playwright pass): at
              exactly `lg` (1024px), `PageNavigator`'s own label AND the
              pre-existing Restore/Schedule buttons all activate together —
              H2-2's own report already measured that width as having zero
              slack left. Adding this second control's full label at the
              same `lg` breakpoint measurably worsened that pre-existing
              overflow (1026px → 1139px scrollWidth on an identical 1024px
              viewport, Home vs. Product). Deferring to `xl` (1280px) — a
              real, spacious width — keeps this control icon-only through
              the entire budget-constrained 768–1279px range, contributing
              zero incremental width at the exact point that pre-existing
              finding lives, without touching that unrelated toolbar code
              at all. */}
          <span className="hidden min-w-0 truncate font-medium xl:inline">
            {selectedProduct ? <bdi>{selectedProduct.name}</bdi> : t("productPickerNoSelectionLabel")}
          </span>
          <ChevronIcon />
        </span>
      }
    >
      {({ close }) => (
        <ProductPreviewPickerPanel
          locale={locale}
          listState={listState}
          products={products}
          selectedProductId={selectedProduct?.id ?? null}
          search={search}
          onSearchChange={onSearchChange}
          onSelect={(product) => {
            onSelect(product);
            close();
            triggerRef.current?.focus();
          }}
          onRetry={onRetry}
        />
      )}
    </Dropdown>
  );
}

function ProductIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <path d="M2.5 5 8 2.5 13.5 5v6L8 13.5 2.5 11z" />
      <path d="M2.5 5 8 7.5 13.5 5M8 7.5v6" />
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
