"use client";

import type { useTranslations } from "next-intl";
import { StageField, StageShell } from "@/components/checkout/awj/StageShell";
import type { AddressForm } from "@/components/checkout/awj/types";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/**
 * Stage 2 — where the order goes.
 *
 * Seven free-text fields, matching `PATCH store/v1/checkout/address` exactly.
 *
 * **Country and region are text inputs, not pickers, on purpose.** The
 * storefront has no country or region reference list from AWJ, and the checkout
 * stores whatever string it is given. A select populated from a bundled
 * ISO list would look authoritative while the backend validated none of it, and
 * would quietly assert which countries this store ships to — a shipping claim
 * the platform has not made. When a serving-region contract exists, these two
 * fields become selects and nothing else on this stage moves.
 *
 * There is no address book and no "save this address": `CommerceCheckout` holds
 * one address for one checkout and there is no customer identity to file it
 * under (see the design-first policy's wishlist entry, which has the same
 * missing identity at its root).
 */
export function AddressStage({
  address,
  onChange,
  t,
}: {
  address: AddressForm;
  onChange: (address: AddressForm) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <StageShell
      id="awj-checkout-address"
      title={t("address.heading")}
      description={t("address.description")}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StageField id="awj-address-country" label={t("address.country")}>
          <Input
            id="awj-address-country"
            value={address.country}
            onChange={(e) => onChange({ ...address, country: e.target.value })}
            autoComplete="country-name"
            required
          />
        </StageField>
        <StageField id="awj-address-region" label={t("address.region")}>
          <Input
            id="awj-address-region"
            value={address.region}
            onChange={(e) => onChange({ ...address, region: e.target.value })}
            autoComplete="address-level1"
          />
        </StageField>
        <StageField id="awj-address-city" label={t("address.city")}>
          <Input
            id="awj-address-city"
            value={address.city}
            onChange={(e) => onChange({ ...address, city: e.target.value })}
            autoComplete="address-level2"
            required
          />
        </StageField>
        <StageField id="awj-address-district" label={t("address.district")}>
          <Input
            id="awj-address-district"
            value={address.district}
            onChange={(e) => onChange({ ...address, district: e.target.value })}
            autoComplete="address-level3"
          />
        </StageField>
        <StageField id="awj-address-street" label={t("address.street")} span>
          <Input
            id="awj-address-street"
            value={address.street}
            onChange={(e) => onChange({ ...address, street: e.target.value })}
            autoComplete="street-address"
            required
          />
        </StageField>
        <StageField
          id="awj-address-postal-code"
          label={t("address.postalCode")}
        >
          <Input
            id="awj-address-postal-code"
            value={address.postalCode}
            onChange={(e) =>
              onChange({ ...address, postalCode: e.target.value })
            }
            autoComplete="postal-code"
            inputMode="numeric"
          />
        </StageField>
        <StageField
          id="awj-address-notes"
          label={t("address.notes")}
          hint={t("address.notesHint")}
          span
        >
          <Textarea
            id="awj-address-notes"
            rows={3}
            value={address.notes}
            onChange={(e) => onChange({ ...address, notes: e.target.value })}
          />
        </StageField>
      </div>
    </StageShell>
  );
}
