"use client";

import { MapPin } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { AccountEmptyState } from "@/components/account/AccountEmptyState";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { AccountAddress, AddressInput } from "@/lib/commerce/account";
import { deleteAddress, listAddresses, saveAddress } from "@/lib/data/customer";

type Draft = {
  label: string;
  recipient_name: string;
  phone: string;
  city: string;
  district: string;
  street: string;
  building_no: string;
  additional_number: string;
  postal_code: string;
  delivery_notes: string;
  is_default_shipping: boolean;
};

const EMPTY: Draft = {
  label: "",
  recipient_name: "",
  phone: "",
  city: "",
  district: "",
  street: "",
  building_no: "",
  additional_number: "",
  postal_code: "",
  delivery_notes: "",
  is_default_shipping: false,
};

/** Arabic-Indic / Persian digits -> 0-9: the Saudi National Address fields are digit-only and checked server-side. */
function latinDigits(value: string): string {
  return value
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

function toDraft(address: AccountAddress): Draft {
  return {
    label: address.label ?? "",
    recipient_name: address.recipientName,
    phone: address.phone,
    city: address.city,
    district: address.district ?? "",
    street: address.street,
    building_no: address.buildingNo ?? "",
    additional_number: address.additionalNumber ?? "",
    postal_code: address.postalCode ?? "",
    delivery_notes: address.deliveryNotes ?? "",
    is_default_shipping: address.isDefaultShipping,
  };
}

/**
 * The signed-in customer's saved delivery addresses. Everything is read from and written to the owner-scoped API
 * (`account/addresses`): the browser never sends an owner id, and another customer's address is indistinguishable from a
 * missing one. Addresses are Saudi National Address shaped (district, building no., additional no., postal code) because
 * this store delivers in Saudi Arabia; the API enforces the digit rules and this form mirrors them for fast feedback.
 */
export function AccountAddresses() {
  const t = useTranslations("account");
  const tr = useTranslations("retailAccount");
  const [addresses, setAddresses] = useState<AccountAddress[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<{
    id: string | null;
    draft: Draft;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await listAddresses();
    if (result.kind === "ok") {
      setAddresses(result.data);
      setFailed(false);
    } else {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    const d = editing.draft;
    setError(null);
    if (
      !/^\d{4}$/.test(d.building_no) ||
      !/^\d{4}$/.test(d.additional_number) ||
      !/^\d{5}$/.test(d.postal_code)
    ) {
      setError(tr("addressDigits"));
      return;
    }
    setBusy(true);
    const input: AddressInput = {
      ...d,
      country: "SA",
    };
    const result = await saveAddress(input, editing.id ?? undefined);
    if (result.kind === "ok") {
      setEditing(null);
      await load();
    } else {
      setError(tr("addressSaveFailed"));
    }
    setBusy(false);
  };

  const remove = async (id: string) => {
    setBusy(true);
    const result = await deleteAddress(id);
    setConfirmDelete(null);
    if (result.kind !== "ok") setError(tr("addressDeleteFailed"));
    await load();
    setBusy(false);
  };

  const set = (key: keyof Draft, value: string | boolean) =>
    setEditing((current) =>
      current
        ? { ...current, draft: { ...current.draft, [key]: value } }
        : current,
    );

  return (
    <div>
      <header className="flex flex-wrap items-end justify-between gap-3 lg:border-b lg:border-store-border lg:pb-5">
        <h1 className="text-xl font-bold text-store-foreground lg:text-2xl">
          {t("addresses")}
        </h1>
        {!editing && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setError(null);
              setEditing({ id: null, draft: EMPTY });
            }}
          >
            {t("addNewAddress")}
          </Button>
        )}
      </header>

      {error && !editing && (
        <Alert variant="destructive" className="mt-4" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {failed && (
        <p role="alert" className="mt-4 text-sm text-store-destructive">
          {tr("addressLoadFailed")}
        </p>
      )}

      {editing && (
        <form
          onSubmit={submit}
          className="mt-5 space-y-4 rounded-store border border-store-border bg-store-surface p-4"
          data-testid="address-form"
        >
          <h2 className="text-base font-semibold text-store-foreground">
            {editing.id ? tr("editAddress") : t("addNewAddress")}
          </h2>
          {error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="addr-recipient">
                {tr("recipientName")}
              </FieldLabel>
              <Input
                id="addr-recipient"
                autoComplete="name"
                value={editing.draft.recipient_name}
                onChange={(e) => set("recipient_name", e.target.value)}
                required
                maxLength={255}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="addr-phone">{tr("phone")}</FieldLabel>
              <Input
                id="addr-phone"
                type="tel"
                inputMode="tel"
                dir="ltr"
                autoComplete="tel"
                value={editing.draft.phone}
                onChange={(e) => set("phone", latinDigits(e.target.value))}
                required
                maxLength={32}
                placeholder="+9665XXXXXXXX"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="addr-city">{tr("city")}</FieldLabel>
              <Input
                id="addr-city"
                autoComplete="address-level2"
                value={editing.draft.city}
                onChange={(e) => set("city", e.target.value)}
                required
                maxLength={255}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="addr-district">{tr("district")}</FieldLabel>
              <Input
                id="addr-district"
                value={editing.draft.district}
                onChange={(e) => set("district", e.target.value)}
                required
                maxLength={255}
              />
            </Field>
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="addr-street">{tr("street")}</FieldLabel>
              <Input
                id="addr-street"
                autoComplete="address-line1"
                value={editing.draft.street}
                onChange={(e) => set("street", e.target.value)}
                required
                maxLength={255}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="addr-building">
                {tr("buildingNo")}
              </FieldLabel>
              <Input
                id="addr-building"
                inputMode="numeric"
                dir="ltr"
                value={editing.draft.building_no}
                onChange={(e) =>
                  set("building_no", latinDigits(e.target.value))
                }
                required
                maxLength={4}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="addr-additional">
                {tr("additionalNo")}
              </FieldLabel>
              <Input
                id="addr-additional"
                inputMode="numeric"
                dir="ltr"
                value={editing.draft.additional_number}
                onChange={(e) =>
                  set("additional_number", latinDigits(e.target.value))
                }
                required
                maxLength={4}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="addr-postal">{tr("postalCode")}</FieldLabel>
              <Input
                id="addr-postal"
                inputMode="numeric"
                dir="ltr"
                autoComplete="postal-code"
                value={editing.draft.postal_code}
                onChange={(e) =>
                  set("postal_code", latinDigits(e.target.value))
                }
                required
                maxLength={5}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="addr-label">{tr("addressLabel")}</FieldLabel>
              <Input
                id="addr-label"
                value={editing.draft.label}
                onChange={(e) => set("label", e.target.value)}
                maxLength={255}
                placeholder={tr("addressLabelPlaceholder")}
              />
            </Field>
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="addr-notes">
                {tr("deliveryNotes")}
              </FieldLabel>
              <Input
                id="addr-notes"
                value={editing.draft.delivery_notes}
                onChange={(e) => set("delivery_notes", e.target.value)}
                maxLength={1000}
              />
            </Field>
          </div>
          <label
            htmlFor="addr-default"
            className="flex min-h-11 items-center gap-2 text-sm text-store-foreground"
          >
            <input
              id="addr-default"
              type="checkbox"
              className="size-4"
              checked={editing.draft.is_default_shipping}
              onChange={(e) => set("is_default_shipping", e.target.checked)}
            />
            {t("setAsDefault")}
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="submit"
              size="lg"
              disabled={busy}
              className="sm:flex-1"
            >
              {busy ? tr("saving") : tr("saveAddress")}
            </Button>
            <Button
              type="button"
              size="lg"
              variant="outline"
              disabled={busy}
              className="sm:flex-1"
              onClick={() => {
                setEditing(null);
                setError(null);
              }}
            >
              {tr("cancel")}
            </Button>
          </div>
        </form>
      )}

      {addresses && addresses.length === 0 && !editing && (
        <div className="mt-5">
          <AccountEmptyState
            icon={MapPin}
            title={t("noAddresses")}
            description={tr("noAddressesBody")}
          />
        </div>
      )}

      {addresses && addresses.length > 0 && (
        <ul
          className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2"
          data-testid="address-list"
        >
          {addresses.map((address) => (
            <li
              key={address.id}
              className="rounded-store border border-store-border bg-store-surface p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium text-store-foreground">
                  {address.label ?? address.recipientName}
                </p>
                {address.isDefaultShipping && (
                  <span className="rounded-store bg-store-surface-muted px-2 py-0.5 text-xs text-store-muted-foreground">
                    {t("defaultAddress")}
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-store-muted-foreground">
                {address.recipientName} · <bdi dir="ltr">{address.phone}</bdi>
              </p>
              <p className="mt-1 text-sm leading-relaxed text-store-foreground">
                {[
                  address.street,
                  address.district,
                  address.city,
                  address.postalCode,
                ]
                  .filter(Boolean)
                  .join("، ")}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setError(null);
                    setEditing({ id: address.id, draft: toDraft(address) });
                  }}
                >
                  {tr("edit")}
                </Button>
                {confirmDelete === address.id ? (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => remove(address.id)}
                    >
                      {tr("confirmDelete")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => setConfirmDelete(null)}
                    >
                      {tr("cancel")}
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => setConfirmDelete(address.id)}
                  >
                    {tr("delete")}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
