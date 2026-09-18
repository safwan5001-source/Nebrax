"use client";

import type {
  AvailabilityFilter,
  OptionFilter,
  PriceRangeFilter,
  ProductFiltersResponse,
} from "@spree/sdk";
import { SlidersHorizontal } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { JSX } from "react";
import { memo, useCallback, useMemo, useState } from "react";
import { AvailabilityDropdownContent } from "@/components/products/filters/AvailabilityDropdownContent";
import { FilterBarSkeleton } from "@/components/products/filters/FilterBarSkeleton";
import { FilterChips } from "@/components/products/filters/FilterChips";
import { FilterDropdown } from "@/components/products/filters/FilterDropdown";
import { MobileFilterDrawer } from "@/components/products/filters/MobileFilterDrawer";
import { OptionDropdownContent } from "@/components/products/filters/OptionDropdownContent";
import { PriceDropdownContent } from "@/components/products/filters/PriceDropdownContent";
import { SortDropdownContent } from "@/components/products/filters/SortDropdownContent";
import { getActiveFilterCount } from "@/lib/utils/filters";
import { generatePriceBuckets } from "@/lib/utils/price-buckets";
import type { ActiveFilters, AvailabilityStatus } from "@/types/filters";

interface FilterBarProps {
  filtersData: ProductFiltersResponse | null;
  filtersLoading: boolean;
  activeFilters: ActiveFilters;
  totalCount: number;
  onFilterChange: (filters: ActiveFilters) => void;
}

export const FilterBar = memo(function FilterBar({
  filtersData,
  filtersLoading,
  activeFilters,
  totalCount,
  onFilterChange,
}: FilterBarProps): JSX.Element | null {
  const t = useTranslations("products");
  const locale = useLocale();
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const [showMobileDrawer, setShowMobileDrawer] = useState(false);

  const toggleDropdown = useCallback((id: string) => {
    setOpenDropdownId((prev) => (prev === id ? null : id));
  }, []);

  const closeDropdown = useCallback(() => {
    setOpenDropdownId(null);
  }, []);

  const handleOptionValueToggle = useCallback(
    (optionValueId: string) => {
      const newOptionValues = activeFilters.optionValues.includes(optionValueId)
        ? activeFilters.optionValues.filter((id) => id !== optionValueId)
        : [...activeFilters.optionValues, optionValueId];
      onFilterChange({ ...activeFilters, optionValues: newOptionValues });
    },
    [activeFilters, onFilterChange],
  );

  const handlePriceChange = useCallback(
    (min?: number, max?: number) => {
      onFilterChange({ ...activeFilters, priceMin: min, priceMax: max });
    },
    [activeFilters, onFilterChange],
  );

  const handleAvailabilityChange = useCallback(
    (availability?: AvailabilityStatus) => {
      onFilterChange({ ...activeFilters, availability });
    },
    [activeFilters, onFilterChange],
  );

  const handleSortChange = useCallback(
    (sortBy: string) => {
      onFilterChange({ ...activeFilters, sortBy });
      closeDropdown();
    },
    [activeFilters, onFilterChange, closeDropdown],
  );

  const clearFilters = useCallback(() => {
    onFilterChange({
      optionValues: [],
      priceMin: undefined,
      priceMax: undefined,
      availability: undefined,
      sortBy: activeFilters.sortBy,
    });
  }, [onFilterChange, activeFilters.sortBy]);

  const priceBuckets = useMemo(() => {
    if (!filtersData) return [];
    const priceFilter = filtersData.filters.find(
      (f) => f.type === "price_range",
    ) as PriceRangeFilter | undefined;
    if (!priceFilter) return [];
    return generatePriceBuckets(
      priceFilter.min,
      priceFilter.max,
      priceFilter.currency,
      { t, locale },
    );
  }, [filtersData, t, locale]);

  const optionFilters = useMemo(() => {
    if (!filtersData) return [];
    return filtersData.filters.filter(
      (f) => f.type === "option",
    ) as OptionFilter[];
  }, [filtersData]);

  const badgeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const filter of optionFilters) {
      counts[filter.id] = filter.options.filter((o) =>
        activeFilters.optionValues.includes(o.id),
      ).length;
    }
    return counts;
  }, [optionFilters, activeFilters.optionValues]);

  const priceBadge =
    activeFilters.priceMin !== undefined || activeFilters.priceMax !== undefined
      ? 1
      : 0;

  const availabilityBadge = activeFilters.availability ? 1 : 0;

  const totalActiveFilters = getActiveFilterCount(activeFilters);

  const hasActiveFilters = totalActiveFilters > 0;

  const activeSortBy = activeFilters.sortBy || filtersData?.default_sort;

  if (!filtersData) {
    if (filtersLoading) return <FilterBarSkeleton />;
    return null;
  }

  const availabilityFilter = filtersData.filters.find(
    (f) => f.type === "availability",
  ) as AvailabilityFilter | undefined;

  const hasPriceFilter =
    filtersData.filters.some((f) => f.type === "price_range") &&
    priceBuckets.length > 0;

  /** Whether the catalogue exposes anything to filter on at all. */
  const hasAnyFilter =
    hasPriceFilter || optionFilters.length > 0 || availabilityFilter != null;

  return (
    // The rule under the controls is what ties them to the grid, so it sits
    // close to both. It used to carry pb-4 + mb-6 on top of the page's own
    // vertical rhythm, which opened a gap wide enough to read as a missing
    // element between the catalogue controls and the products.
    <div className="mb-3">
      <div className="hidden items-center justify-between border-b border-store-border pb-3 md:flex">
        <div className="flex items-center gap-3">
          {optionFilters.map((filter) => (
            <FilterDropdown
              key={filter.id}
              label={filter.label}
              badgeCount={badgeCounts[filter.id]}
              isOpen={openDropdownId === filter.id}
              onToggle={() => toggleDropdown(filter.id)}
              onClose={closeDropdown}
            >
              <OptionDropdownContent
                filter={filter}
                selectedValues={activeFilters.optionValues}
                onToggle={handleOptionValueToggle}
              />
            </FilterDropdown>
          ))}

          {hasPriceFilter && (
            <FilterDropdown
              label={t("price")}
              badgeCount={priceBadge}
              isOpen={openDropdownId === "price"}
              onToggle={() => toggleDropdown("price")}
              onClose={closeDropdown}
            >
              <PriceDropdownContent
                priceBuckets={priceBuckets}
                activeFilters={activeFilters}
                onPriceChange={handlePriceChange}
              />
            </FilterDropdown>
          )}

          {availabilityFilter && (
            <FilterDropdown
              label={t("availability")}
              badgeCount={availabilityBadge}
              isOpen={openDropdownId === "availability"}
              onToggle={() => toggleDropdown("availability")}
              onClose={closeDropdown}
            >
              <AvailabilityDropdownContent
                filter={availabilityFilter}
                selected={activeFilters.availability}
                onChange={handleAvailabilityChange}
              />
            </FilterDropdown>
          )}
        </div>

        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">
            {t("productCount", { count: totalCount })}
          </span>
          <FilterDropdown
            label={t("sort")}
            isOpen={openDropdownId === "sort"}
            onToggle={() => toggleDropdown("sort")}
            onClose={closeDropdown}
            align="right"
          >
            <SortDropdownContent
              sortOptions={filtersData.sort_options}
              activeSortBy={activeSortBy}
              onSortChange={handleSortChange}
            />
          </FilterDropdown>
        </div>
      </div>

      <div className="flex items-center gap-3 border-b border-store-border pb-3 md:hidden">
        {/*
          The filter trigger appears only when the catalogue actually has facets
          to filter on. The AWJ catalog API supplies none, so rendering it
          unconditionally put a button on every phone that opened an empty
          drawer — a control that looks functional and is not.
        */}
        {hasAnyFilter && (
          <button
            type="button"
            onClick={() => setShowMobileDrawer(true)}
            className={`flex items-center gap-2 rounded-store border px-4 py-2 text-sm font-medium transition-colors ${
              hasActiveFilters
                ? "border-store-border-strong bg-store-surface-muted text-store-primary"
                : "border-store-border text-store-foreground"
            }`}
          >
            <SlidersHorizontal className="size-4" />
            <span>{t("filters")}</span>
            {hasActiveFilters && (
              <span className="flex size-5 items-center justify-center rounded-store bg-store-primary text-xs text-store-primary-foreground">
                {totalActiveFilters}
              </span>
            )}
          </button>
        )}

        <div className="ms-auto">
          <FilterDropdown
            label={t("sort")}
            isOpen={openDropdownId === "sort-mobile"}
            onToggle={() => toggleDropdown("sort-mobile")}
            onClose={closeDropdown}
            align="right"
          >
            <SortDropdownContent
              sortOptions={filtersData.sort_options}
              activeSortBy={activeSortBy}
              onSortChange={handleSortChange}
            />
          </FilterDropdown>
        </div>
      </div>

      {hasActiveFilters && (
        <FilterChips
          activeFilters={activeFilters}
          filtersData={filtersData}
          priceBuckets={priceBuckets}
          onRemoveOptionValue={(id) => handleOptionValueToggle(id)}
          onRemovePrice={() => handlePriceChange(undefined, undefined)}
          onRemoveAvailability={() => handleAvailabilityChange(undefined)}
          onClearAll={clearFilters}
        />
      )}

      <MobileFilterDrawer
        isOpen={showMobileDrawer}
        onClose={() => setShowMobileDrawer(false)}
        filtersData={filtersData}
        activeFilters={activeFilters}
        priceBuckets={priceBuckets}
        onApply={onFilterChange}
      />
    </div>
  );
});
