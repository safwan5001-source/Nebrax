"use client";

/**
 * CUST-H2-3 — لوحة تحكم بنية صفحة المنتج: تُعرِّف الترتيب/الرؤية لتسع مناطق
 * `pagePresentation.product.regions` المغلقة (`PRODUCT_PAGE_REGION_KEYS`،
 * H2-1). زرّا "أعلى/أسفل" بدل السحب والإفلات (العقد المعماري، §"Reorder
 * UX" — "Drag-and-drop is optional and should not be added merely for this
 * slice"). المناطق الإلزامية الأربع الثابتة (`media_gallery`/`identity`/
 * `price`/`quantity_cta`) بلا مفتاح رؤية ولا أزرار حركة إطلاقاً — لا حتى
 * معطَّلة — لأن هذا المُنتج غير قابل للإخفاء/الحركة بنيوياً، لا مجرَّد
 * سياسة واجهة. `variant_selector` يظهر في هذه القائمة فقط حين للمنتج
 * المُعايَن الحالي متغيّرات فعلية (`hasVariants`) — راجع تعليق
 * `ExperienceBuilder`'s `effectiveProductRegions` لماذا هذا قرارٌ عرضي بحت
 * لا يُكتَب أبداً إلى المستند (`Do not persist Product-specific hasVariants
 * truth into config`).
 */

import type { PageRegionInstance, ProductPageRegionKey } from "./presentation/page-regions";
import { canMoveProductRegion, isFixedRequiredRegion } from "./presentation/page-region-registry";
import { Toggle, iconBtnClass } from "./ControlPanels";
import { type CustomizerLocale, type CustomizerMessageKey, customizerMessage } from "./messages";

const REGION_LABEL_KEY: Record<ProductPageRegionKey, CustomizerMessageKey> = {
  media_gallery: "regionMediaGallery",
  identity: "regionIdentity",
  price: "regionPrice",
  availability: "regionAvailability",
  variant_selector: "regionVariantSelector",
  quantity_cta: "regionQuantityCta",
  description: "regionDescription",
  custom_fields: "regionCustomFields",
  sku_options_details: "regionSkuOptionsDetails",
};

export function ProductRegionInspector({
  locale,
  regions,
  hasVariants,
  selectedRegionId,
  onSelectRegion,
  onToggleVisibility,
  onMove,
  readOnly,
}: {
  locale: CustomizerLocale;
  regions: PageRegionInstance<ProductPageRegionKey>[];
  hasVariants: boolean;
  selectedRegionId: string | null;
  onSelectRegion: (id: string) => void;
  onToggleVisibility: (id: string) => void;
  onMove: (id: string, delta: 1 | -1) => void;
  readOnly: boolean;
}) {
  const t = (key: CustomizerMessageKey) => customizerMessage(locale, key);
  // `variant_selector` always exists in the stored/default list (H2-1's
  // closed 9-key contract) but is only ever shown to the merchant — in both
  // this list and the Canvas — when the *currently previewed* product
  // actually has variants. Its position in `regions` is untouched either
  // way; only visibility in this UI is conditional.
  const visibleRegions = regions.filter((region) => region.key !== "variant_selector" || hasVariants);

  return (
    <div data-product-region-inspector="" className="flex flex-col gap-3">
      <p className="text-xs leading-5 text-muted">{t("productRegionsHelp")}</p>
      <ul role="list" className="flex flex-col gap-1.5">
        {visibleRegions.map((region) => {
          const index = regions.indexOf(region);
          const fixedRequired = isFixedRequiredRegion("product", region.key);
          const hideable = !fixedRequired && region.key !== "variant_selector";
          const selected = region.id === selectedRegionId;
          const canUp = canMoveProductRegion(regions, index, -1);
          const canDown = canMoveProductRegion(regions, index, 1);
          return (
            <li
              key={region.id}
              data-product-region-row={region.key}
              data-region-selected={selected ? "" : undefined}
              className={`flex items-center gap-2 rounded-md border px-2.5 py-2 ${
                selected ? "border-primary bg-primary-soft" : "border-border bg-surface"
              }`}
            >
              <button
                type="button"
                onClick={() => onSelectRegion(region.id)}
                className="flex min-w-0 flex-1 items-center gap-2 text-start"
                aria-pressed={selected}
              >
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text">
                  {t(REGION_LABEL_KEY[region.key])}
                </span>
                {fixedRequired || region.key === "variant_selector" ? (
                  <span className="shrink-0 rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-medium text-muted">
                    {t("regionRequiredBadge")}
                  </span>
                ) : null}
              </button>
              {hideable ? (
                <Toggle
                  compact
                  label={t("regionVisibleToggleLabel")}
                  checked={region.visible}
                  disabled={readOnly}
                  onChange={() => onToggleVisibility(region.id)}
                />
              ) : null}
              {!fixedRequired ? (
                <span className="flex shrink-0">
                  <button
                    type="button"
                    className={iconBtnClass}
                    aria-label={t("moveUp")}
                    disabled={readOnly || !canUp}
                    onClick={() => onMove(region.id, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className={iconBtnClass}
                    aria-label={t("moveDown")}
                    disabled={readOnly || !canDown}
                    onClick={() => onMove(region.id, 1)}
                  >
                    ↓
                  </button>
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
