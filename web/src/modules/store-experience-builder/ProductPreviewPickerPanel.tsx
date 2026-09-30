"use client";

/**
 * CUST-H2-3 — محتوى منتقي "معاينة منتج"، مُعاد استعماله من موضعين بالضبط
 * كما `PageNavigatorPanel`/`VersionManagerPanel`: داخل قائمة `ProductPreviewPicker`
 * المنسدلة على سطح المكتب/الجهاز اللوحي، وداخل ورقة سفلية مستقلة على الجوال
 * (`ExperienceBuilder`). الحالة (القائمة/التحميل/البحث) تعيش في `ExperienceBuilder`
 * وحده — هذا مكوّنٌ عرضي بحت، بلا طلب شبكة خاص به.
 *
 * الاختيار **سياق محرِّر بحت** — لا يُكتَب إلى `pagePresentation`، لا يُغيِّر
 * `dirty`. راجع `ExperienceBuilder`'s `previewProductId`.
 */

import type { WorkspaceProductSummary } from "@/modules/commerce-workspace/workspace-products";
import { type CustomizerLocale, type CustomizerMessageKey, customizerMessage } from "./messages";

export type ProductPickerListState = "idle" | "loading" | "error" | "ready";

export function ProductPreviewPickerPanel({
  locale,
  listState,
  products,
  selectedProductId,
  search,
  onSearchChange,
  onSelect,
  onRetry,
}: {
  locale: CustomizerLocale;
  listState: ProductPickerListState;
  products: WorkspaceProductSummary[];
  selectedProductId: string | null;
  search: string;
  onSearchChange: (value: string) => void;
  onSelect: (product: WorkspaceProductSummary) => void;
  onRetry: () => void;
}) {
  const t = (key: CustomizerMessageKey) => customizerMessage(locale, key);

  return (
    <div data-product-picker-panel="" className="flex flex-col gap-2">
      <label className="sr-only" htmlFor="product-picker-search">
        {t("productPickerSearchLabel")}
      </label>
      <input
        id="product-picker-search"
        type="search"
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder={t("productPickerSearchPlaceholder")}
        className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      />
      <div role="listbox" aria-label={t("productPickerMenuTitle")} className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
        {listState === "loading" ? (
          <p data-product-picker-loading="" className="px-3 py-4 text-center text-sm text-muted">
            {t("productPickerLoading")}
          </p>
        ) : listState === "error" ? (
          <div data-product-picker-error="" className="flex flex-col items-center gap-2 px-3 py-4 text-center text-sm text-muted">
            <span>{t("productPickerLoadFailed")}</span>
            <button
              type="button"
              onClick={onRetry}
              className="rounded-md border border-border px-3 py-1 text-xs font-medium text-text hover:bg-primary-soft"
            >
              {t("retry")}
            </button>
          </div>
        ) : products.length === 0 ? (
          <p data-product-picker-empty="" className="px-3 py-4 text-center text-sm text-muted">
            {t("productPickerEmpty")}
          </p>
        ) : (
          products.map((product) => {
            const selected = product.id === selectedProductId;
            return (
              <button
                key={product.id}
                type="button"
                role="option"
                aria-selected={selected}
                data-product-option={product.id}
                onClick={() => onSelect(product)}
                className={`flex min-h-11 w-full items-center gap-2.5 rounded-md px-2 text-start text-sm ${
                  selected ? "bg-primary-soft font-medium text-primary" : "text-text hover:bg-primary-soft"
                }`}
              >
                <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-muted">
                  {product.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- thumbnail source is an untrusted external tenant media URL, not a static/optimizable asset
                    <img src={product.thumbnailUrl} alt="" className="size-full object-cover" />
                  ) : (
                    <ProductPlaceholderIcon />
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  <bdi>{product.name}</bdi>
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

function ProductPlaceholderIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-4 text-muted" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <path d="M2.5 5 8 2.5 13.5 5v6L8 13.5 2.5 11z" />
      <path d="M2.5 5 8 7.5 13.5 5M8 7.5v6" />
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
