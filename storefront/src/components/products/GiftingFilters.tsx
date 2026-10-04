"use client";

import { SlidersHorizontal, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import type { ListingFacets } from "@/lib/commerce/listing-facets";
import { cn } from "@/lib/utils";
import {
  clearGiftingFilters,
  countGiftingFilters,
  isDeliverToday,
  selectedBrand,
  selectedFacetSlugs,
  toggleBrand,
  toggleDeliverToday,
  toggleFacetValue,
} from "@/lib/utils/gifting-filter-url";

interface GiftingFiltersProps {
  facets: ListingFacets;
  /**
   * Whether the store offers delivery scheduling. "Deliver today" is hidden
   * otherwise (it would only ever return an empty list) unless it is already
   * active, so the shopper can always turn it off.
   */
  deliverTodayAvailable: boolean;
}

const chipClass =
  "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-store-primary";
const chipIdle =
  "border-store-border bg-store-surface text-store-foreground hover:border-store-primary hover:text-store-primary";
const chipOn =
  "border-store-primary bg-store-primary text-store-primary-foreground";

/**
 * FLOWERS-H10 — gifting filters above the product grid: occasion, recipient and
 * any other merchant facet, brand, and "Deliver today". Everything lives in the
 * URL (the server component re-renders from it); counts come from the product
 * list `meta` and already reflect the current selection. Mobile collapses the
 * groups behind one button while the active filters stay visible and
 * removable.
 */
export function GiftingFilters({
  facets,
  deliverTodayAvailable,
}: GiftingFiltersProps) {
  const t = useTranslations("products");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const panelId = useId();

  const params = new URLSearchParams(searchParams.toString());
  const active = countGiftingFilters(params);
  const deliverToday = isDeliverToday(params);
  const brandId = selectedBrand(params);
  const showDeliverToday = deliverTodayAvailable || deliverToday;

  if (
    facets.groups.length === 0 &&
    facets.brands.length === 0 &&
    !showDeliverToday &&
    active === 0
  ) {
    return null;
  }

  const go = (next: URLSearchParams) => {
    const query = next.toString();
    startTransition(() => {
      router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
    });
  };

  // Active chips: label from the API payload, falling back to the raw token so
  // a filter that no longer matches anything can still be removed.
  const chips: { key: string; label: string; remove: URLSearchParams }[] = [];
  for (const group of facets.groups) {
    for (const slug of selectedFacetSlugs(params, group.key)) {
      const value = group.values.find((entry) => entry.slug === slug);
      chips.push({
        key: `${group.key}:${slug}`,
        label: `${group.name}: ${value?.name ?? slug}`,
        remove: toggleFacetValue(params, group.key, slug),
      });
    }
  }
  if (brandId) {
    const brand = facets.brands.find((entry) => entry.id === brandId);
    chips.push({
      key: `brand:${brandId}`,
      label: `${t("giftingBrand")}: ${brand?.name ?? brandId}`,
      remove: toggleBrand(params, brandId),
    });
  }
  if (deliverToday) {
    chips.push({
      key: "deliver-today",
      label: t("giftingDeliverToday"),
      remove: toggleDeliverToday(params),
    });
  }

  return (
    <section
      aria-label={t("filters")}
      aria-busy={isPending}
      data-gifting-filters=""
      className="mb-4 space-y-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
          className={cn(chipClass, chipIdle, "md:hidden")}
        >
          <SlidersHorizontal className="size-4" aria-hidden="true" />
          <span>{t("filters")}</span>
          {active > 0 ? <span aria-hidden="true">({active})</span> : null}
        </button>

        {showDeliverToday ? (
          <button
            type="button"
            aria-pressed={deliverToday}
            onClick={() => go(toggleDeliverToday(params))}
            className={cn(chipClass, deliverToday ? chipOn : chipIdle)}
          >
            {t("giftingDeliverToday")}
          </button>
        ) : null}
      </div>

      <div
        id={panelId}
        className={cn(
          "gap-x-8 gap-y-4 md:grid-cols-2 lg:grid-cols-3",
          open ? "grid" : "hidden md:grid",
        )}
      >
        {facets.groups.map((group) => {
          const selected = selectedFacetSlugs(params, group.key);
          return (
            <fieldset key={group.key} className="min-w-0">
              <legend className="mb-2 text-sm font-extrabold text-store-foreground">
                {group.name}
              </legend>
              <ul className="flex flex-wrap gap-2">
                {group.values.map((value) => {
                  const on = selected.includes(value.slug);
                  return (
                    <li key={value.slug}>
                      <button
                        type="button"
                        aria-pressed={on}
                        data-facet-value={`${group.key}:${value.slug}`}
                        onClick={() =>
                          go(toggleFacetValue(params, group.key, value.slug))
                        }
                        className={cn(chipClass, on ? chipOn : chipIdle)}
                      >
                        <span>{value.name}</span>
                        <bdi className="text-xs opacity-80">
                          ({value.count})
                        </bdi>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          );
        })}

        {facets.brands.length > 0 ? (
          <fieldset className="min-w-0">
            <legend className="mb-2 text-sm font-extrabold text-store-foreground">
              {t("giftingBrand")}
            </legend>
            <ul className="flex flex-wrap gap-2">
              {facets.brands.map((brand) => {
                const on = brandId === brand.id;
                return (
                  <li key={brand.id}>
                    <button
                      type="button"
                      aria-pressed={on}
                      data-brand-value={brand.id}
                      onClick={() => go(toggleBrand(params, brand.id))}
                      className={cn(chipClass, on ? chipOn : chipIdle)}
                    >
                      <span>{brand.name}</span>
                      <bdi className="text-xs opacity-80">({brand.count})</bdi>
                    </button>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        ) : null}
      </div>

      {chips.length > 0 ? (
        <ul
          aria-label={t("giftingActive")}
          className="flex flex-wrap items-center gap-2"
        >
          {chips.map((chip) => (
            <li
              key={chip.key}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-store bg-store-surface-muted ps-3 pe-1 text-sm text-store-foreground"
            >
              <span>{chip.label}</span>
              <button
                type="button"
                onClick={() => go(chip.remove)}
                aria-label={t("clearFilter", { label: chip.label })}
                className="inline-flex size-8 items-center justify-center rounded-full hover:bg-store-border"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={() => go(clearGiftingFilters(params))}
              className="min-h-9 px-2 text-sm font-semibold text-store-primary underline underline-offset-2"
            >
              {t("clearAll")}
            </button>
          </li>
        </ul>
      ) : null}
    </section>
  );
}
