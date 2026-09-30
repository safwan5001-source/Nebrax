"use client";

/**
 * CUST-H2-4 — لوحة تحكم بنية صفحة التصنيف: تُعرِّف الرؤية/الترتيب لست مناطق
 * `pagePresentation.category.regions` المغلقة (`CATEGORY_PAGE_REGION_KEYS`،
 * H2-1). نسخة طبق الأصل من `ProductRegionInspector` (CUST-H2-3)، بفارق
 * جوهري واحد: **الترتيب مُقيَّدٌ** — `description` قابلة للإخفاء لكن غير
 * قابلة للنقل (العقد المعماري، "Category Page Region Contract" — عمود
 * "Reorderable" لها "No")، و`subcategories_rail` وحدها قابلة للنقل
 * ("Yes (position)"). زرّا "أعلى/أسفل" يظهران فقط على المنطقة المسموح
 * بتحريكها، لا على كل منطقة غير إلزامية كما في لوحة المنتج.
 */

import type { CategoryPageRegionKey, PageRegionInstance } from "./presentation/page-regions";
import { canMoveCategoryRegion, isFixedRequiredRegion } from "./presentation/page-region-registry";
import { Toggle, iconBtnClass } from "./ControlPanels";
import { type CustomizerLocale, type CustomizerMessageKey, customizerMessage } from "./messages";

const REGION_LABEL_KEY: Record<CategoryPageRegionKey, CustomizerMessageKey> = {
  breadcrumbs: "regionBreadcrumbs",
  identity_title: "regionIdentityTitle",
  description: "regionDescription",
  subcategories_rail: "regionSubcategoriesRail",
  filter_sort_bar: "regionFilterSortBar",
  product_grid: "regionProductGrid",
};

/** Only `subcategories_rail` may initiate a reorder — see the file header. */
const REORDERABLE_KEYS: readonly CategoryPageRegionKey[] = ["subcategories_rail"];

export function CategoryRegionInspector({
  locale,
  regions,
  selectedRegionId,
  onSelectRegion,
  onToggleVisibility,
  onMove,
  readOnly,
}: {
  locale: CustomizerLocale;
  regions: PageRegionInstance<CategoryPageRegionKey>[];
  selectedRegionId: string | null;
  onSelectRegion: (id: string) => void;
  onToggleVisibility: (id: string) => void;
  onMove: (id: string, delta: 1 | -1) => void;
  readOnly: boolean;
}) {
  const t = (key: CustomizerMessageKey) => customizerMessage(locale, key);

  return (
    <div data-category-region-inspector="" className="flex flex-col gap-3">
      <p className="text-xs leading-5 text-muted">{t("categoryRegionsHelp")}</p>
      <ul role="list" className="flex flex-col gap-1.5">
        {regions.map((region, index) => {
          const fixedRequired = isFixedRequiredRegion("category", region.key);
          const hideable = !fixedRequired;
          const reorderable = (REORDERABLE_KEYS as readonly string[]).includes(region.key);
          const selected = region.id === selectedRegionId;
          const canUp = canMoveCategoryRegion(regions, index, -1);
          const canDown = canMoveCategoryRegion(regions, index, 1);
          return (
            <li
              key={region.id}
              data-category-region-row={region.key}
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
                {fixedRequired ? (
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
              {reorderable ? (
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
