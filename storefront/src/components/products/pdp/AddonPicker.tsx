"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";
import { formatMoney } from "@/lib/commerce/mappers";
import type { AddonOption } from "@/lib/commerce/pdp-gifting";

export function addonKey(addon: Pick<AddonOption, "productId" | "variantId">) {
  return `${addon.productId}:${addon.variantId ?? ""}`;
}

/**
 * FLOWERS-H11 — optional extras the merchant lets shoppers attach (ADR-18: a
 * card, a chocolate box, a vase). The listed price is informational — the
 * server re-prices every add-on line on add-to-cart — and an extra that is out
 * of stock is shown as unavailable rather than hidden. A selected extra's
 * quantity is a choice bounded by the API's own per-add-on maximum.
 */
export function AddonPicker({
  addons,
  quantities,
  onChange,
}: {
  addons: readonly AddonOption[];
  /** addonKey → chosen quantity (absent / 0 = not selected). */
  quantities: Readonly<Record<string, number>>;
  onChange: (key: string, quantity: number) => void;
}) {
  const t = useTranslations("products");
  const baseId = useId();
  if (addons.length === 0) return null;

  return (
    <fieldset
      data-addons=""
      className="mt-5 min-w-0 border-t border-store-border pt-5"
    >
      <legend className="text-sm font-bold text-store-foreground">
        {t("addonsTitle")}
      </legend>
      <p className="mb-3 text-xs text-store-muted-foreground">
        {t("addonsHint")}
      </p>
      <ul className="space-y-2">
        {addons.map((addon) => {
          const key = addonKey(addon);
          const id = `${baseId}-${key}`;
          const quantity = quantities[key] ?? 0;
          const unavailable = addon.inStock === false;
          return (
            <li
              key={key}
              data-addon={key}
              className="flex items-center gap-3 rounded-store border border-store-border bg-store-surface px-3 py-2"
            >
              <input
                id={id}
                type="checkbox"
                checked={quantity > 0}
                disabled={unavailable}
                onChange={(event) =>
                  onChange(key, event.target.checked ? 1 : 0)
                }
                className="size-5 shrink-0 accent-(--store-primary)"
                aria-label={t("addonAdd", { name: addon.name })}
              />
              <label
                htmlFor={id}
                className="flex min-w-0 flex-1 items-baseline justify-between gap-2 text-sm text-store-foreground"
              >
                <span className="min-w-0 break-words font-medium">
                  {addon.name}
                </span>
                <span className="shrink-0 text-xs text-store-muted-foreground">
                  {unavailable ? (
                    t("addonUnavailable")
                  ) : (
                    <bdi>{formatMoney(addon.amountMinor, addon.currency)}</bdi>
                  )}
                </span>
              </label>
              {quantity > 0 && addon.maxQuantity > 1 ? (
                <select
                  value={quantity}
                  aria-label={t("addonQuantity", { name: addon.name })}
                  onChange={(event) =>
                    onChange(key, Number(event.target.value))
                  }
                  className="min-h-9 rounded-store border border-store-border bg-store-surface px-2 text-sm"
                >
                  {Array.from(
                    { length: addon.maxQuantity },
                    (_, i) => i + 1,
                  ).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              ) : null}
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
