"use client";

import { useEffect, useId, useRef, useState } from "react";
import { formatDateTime } from "@/lib/formatting";
import type {
  WorkspaceOffer,
  WorkspaceOfferFieldErrors,
  WorkspaceOfferMutationFailure,
  WorkspaceOfferWrite,
} from "@/modules/commerce-workspace/workspace-offers";
import type { WorkspaceProductSummary } from "@/modules/commerce-workspace/workspace-products";
import { type CustomizerLocale, type CustomizerMessageKey } from "./messages";
import { OfferSummary, OfferThumb } from "./OfferParts";
import { offerDisplayName } from "./offers-display";
import {
  isoToLocalInput,
  localInputToIso,
  OFFER_MAX_POSITION,
  type OfferManagement,
} from "./offers-management";

/**
 * CUST-H4-7b — the configured Offers catalog, inside the Offers section's
 * Content panel (no new page, no modal): the list of configured offers with
 * select / edit / delete, an "Add offer" action, and ONE inline form for
 * create + edit (so on mobile it lives in the existing Bottom Sheet — never a
 * modal on a modal). Delete confirms inline with the same `alertdialog`
 * pattern the version manager uses.
 *
 * This is storefront-level Commerce data: it is read from / written to the
 * H4-6 workspace endpoints only, and the shared state in `ExperienceBuilder`
 * is reconciled from the server's responses. Which offers a section shows
 * (`offerIds`) stays per-section presentation content, owned by the caller
 * through `selectedIds` / `onToggle`.
 *
 * The merchant never edits price, discount, savings, tax, stock or price
 * list here — the form has no such field. A product without a genuine
 * discount is still configurable: the server evaluates it as hidden and the
 * row says why.
 */

type T = (key: CustomizerMessageKey) => string;

const buttonClass =
  "inline-flex min-h-9 items-center justify-center rounded-md border border-border px-2.5 text-xs font-medium text-text hover:bg-primary-soft disabled:opacity-50";
const primaryButtonClass =
  "inline-flex min-h-10 items-center justify-center rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50";
const fieldClass =
  "h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-text outline-none focus:border-primary focus-visible:ring-2 focus-visible:ring-primary/40 aria-[invalid=true]:border-negative";

/** Window bounds go through the central formatter (same calendar/digit guardrails as every other date). */
function formatWindowDate(iso: string, locale: CustomizerLocale): string {
  return formatDateTime(iso, locale, { fallback: iso });
}

export function OfferCatalog({
  offers,
  state,
  onRetry,
  selectedIds,
  atMaxSelected,
  onToggle,
  locale,
  t,
  management,
}: {
  offers: WorkspaceOffer[];
  state: "idle" | "loading" | "error" | "ready";
  onRetry?: () => void;
  selectedIds: string[];
  atMaxSelected: boolean;
  onToggle: (id: string) => void;
  locale: CustomizerLocale;
  t: T;
  management?: OfferManagement;
}) {
  const pending = state === "idle" || state === "loading";
  const [mode, setMode] = useState<{ kind: "list" } | { kind: "create" } | { kind: "edit"; id: string }>({ kind: "list" });
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const listLabelId = useId();
  const restoreFocusRef = useRef<string | null>(null);
  const lastEditedRef = useRef<WorkspaceOffer | null>(null);

  // Return focus to the control that opened the form / confirmation once it closes.
  useEffect(() => {
    if (mode.kind !== "list" || !restoreFocusRef.current) return;
    const selector = restoreFocusRef.current;
    restoreFocusRef.current = null;
    const el = document.querySelector<HTMLElement>(selector);
    el?.focus();
  }, [mode]);

  const maxOffers = management?.maxOffers ?? null;
  const atCap = maxOffers !== null && offers.length >= maxOffers;

  if (management && mode.kind !== "list") {
    // The form keeps working from the last-seen row even if a re-read drops it
    // (deleted elsewhere): saving then answers 404 and the merchant is told,
    // instead of the form silently vanishing under their hands.
    const found = mode.kind === "edit" ? offers.find((offer) => offer.id === mode.id) : undefined;
    if (found) lastEditedRef.current = found;
    const editing = mode.kind === "edit" ? (found ?? lastEditedRef.current ?? undefined) : undefined;
    if (mode.kind === "edit" && !editing) return null;
    return (
      <OfferForm
        key={mode.kind === "edit" ? mode.id : "create"}
        offer={editing}
        offers={offers}
        management={management}
        locale={locale}
        t={t}
        onClose={() => {
          restoreFocusRef.current =
            mode.kind === "edit" ? `[data-offer-edit="${mode.id}"]` : "[data-offer-add], [data-offer-create-empty]";
          setMode({ kind: "list" });
        }}
      />
    );
  }

  async function confirmDelete(id: string) {
    if (!management || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    const result = await management.remove(id);
    setDeleting(false);
    if (result.ok) {
      setConfirmDeleteId(null);
      return;
    }
    setDeleteError(
      result.reason === "forbidden" ? t("offerErrForbidden") : t("offerErrFailed"),
    );
  }

  return (
    <div className="space-y-2 border-t border-border pt-3">
      <div className="flex items-center justify-between gap-2">
        <p id={listLabelId} className="text-xs font-medium text-text">
          {t("offersListLabel")}
        </p>
        <button
          type="button"
          className="text-xs text-muted underline-offset-2 hover:underline"
          disabled={pending}
          onClick={onRetry}
        >
          {t("offersRefresh")}
        </button>
      </div>

      {management && offers.length > 0 && !pending && state !== "error" ? (
        <div>
          <button
            type="button"
            data-offer-add=""
            className={`${buttonClass} w-full`}
            disabled={atCap}
            aria-describedby={atCap ? `${listLabelId}-cap` : undefined}
            onClick={() => setMode({ kind: "create" })}
          >
            + {t("offersAdd")}
          </button>
          {atCap ? (
            <p id={`${listLabelId}-cap`} data-offers-cap="" className="mt-1.5 text-xs text-muted">
              {t("offersMaxConfigured").replace("{n}", String(maxOffers))}
            </p>
          ) : null}
        </div>
      ) : null}

      <div aria-labelledby={listLabelId} role="group" className="flex flex-col gap-1">
        {pending ? (
          <p data-offers-picker-loading="" className="px-2 py-3 text-center text-xs text-muted">
            {t("offersLoading")}
          </p>
        ) : state === "error" ? (
          <div
            data-offers-picker-error=""
            className="flex flex-col items-center gap-2 px-2 py-3 text-center text-xs text-muted"
          >
            <span>{t("offersLoadFailed")}</span>
            <button type="button" onClick={onRetry} className={buttonClass}>
              {t("retry")}
            </button>
          </div>
        ) : offers.length === 0 ? (
          <div data-offers-picker-empty="" className="flex flex-col items-center gap-3 px-2 py-4 text-center">
            <p className="text-xs text-muted">{t("offersEmpty")}</p>
            {management ? (
              <button
                type="button"
                data-offer-create-empty=""
                className={primaryButtonClass}
                onClick={() => setMode({ kind: "create" })}
              >
                {t("offersCreateAction")}
              </button>
            ) : null}
          </div>
        ) : (
          <ul className="flex max-h-[28rem] flex-col gap-1 overflow-y-auto">
            {offers.map((offer) => {
              const selected = selectedIds.includes(offer.id);
              const disabled = !selected && atMaxSelected;
              const name = offerDisplayName(offer, locale) ?? t("offersUnavailable");
              const confirming = confirmDeleteId === offer.id;
              return (
                <li key={offer.id} className="shrink-0">
                  <div
                    className={`flex items-stretch gap-1 rounded-md ${selected ? "bg-primary-soft" : ""}`}
                  >
                    <button
                      type="button"
                      aria-pressed={selected}
                      aria-label={`${t("offersToggleAria")}: ${name}`}
                      disabled={disabled}
                      data-offers-option={offer.id}
                      onClick={() => onToggle(offer.id)}
                      className={`flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-start disabled:opacity-40 ${
                        selected ? "text-primary" : "text-text hover:bg-primary-soft"
                      }`}
                    >
                      <OfferThumb offer={offer} />
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <OfferSummary offer={offer} t={t} locale={locale} />
                        {offer.startsAt || offer.endsAt ? (
                          <span data-offer-window="" className="text-[11px] text-muted">
                            {offer.startsAt ? (
                              <span>
                                {t("offersWindowFrom")}: <bdi>{formatWindowDate(offer.startsAt, locale)}</bdi>
                              </span>
                            ) : null}
                            {offer.startsAt && offer.endsAt ? " · " : null}
                            {offer.endsAt ? (
                              <span>
                                {t("offersWindowTo")}: <bdi>{formatWindowDate(offer.endsAt, locale)}</bdi>
                              </span>
                            ) : null}
                          </span>
                        ) : null}
                      </span>
                      {selected ? <span aria-hidden="true">✓</span> : null}
                    </button>
                    {management ? (
                      <div className="flex shrink-0 flex-col justify-center gap-1 py-1 pe-1">
                        <button
                          type="button"
                          data-offer-edit={offer.id}
                          aria-label={`${t("offersEditAria")}: ${name}`}
                          className={buttonClass}
                          onClick={() => {
                            setDeleteError(null);
                            setConfirmDeleteId(null);
                            lastEditedRef.current = offer;
                            setMode({ kind: "edit", id: offer.id });
                          }}
                        >
                          {t("offersEdit")}
                        </button>
                        <button
                          type="button"
                          data-offer-delete={offer.id}
                          aria-label={`${t("offersDeleteAria")}: ${name}`}
                          className={buttonClass}
                          onClick={() => {
                            setDeleteError(null);
                            setConfirmDeleteId(offer.id);
                          }}
                        >
                          {t("offersDelete")}
                        </button>
                      </div>
                    ) : null}
                  </div>
                  {confirming ? (
                    <DeleteConfirm
                      name={name}
                      t={t}
                      busy={deleting}
                      error={deleteError}
                      onConfirm={() => void confirmDelete(offer.id)}
                      onCancel={() => {
                        setConfirmDeleteId(null);
                        setDeleteError(null);
                        document.querySelector<HTMLElement>(`[data-offer-delete="${offer.id}"]`)?.focus();
                      }}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function DeleteConfirm({
  name,
  t,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  name: string;
  t: T;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);
  return (
    <div
      role="alertdialog"
      aria-label={t("offerDeleteTitle")}
      data-offer-delete-confirm=""
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) {
          event.stopPropagation();
          onCancel();
        }
      }}
      className="mt-1 rounded-md border border-negative/30 bg-negative/5 p-2 text-[11px]"
    >
      <p className="font-medium text-negative">
        {t("offerDeleteTitle")} <bdi>{name}</bdi>
      </p>
      <p className="mt-1 text-muted">{t("offerDeleteBody")}</p>
      {error ? (
        <p role="alert" data-offer-delete-error="" className="mt-1 font-medium text-negative">
          {error}
        </p>
      ) : null}
      <div className="mt-2 flex items-center gap-1.5">
        <button
          type="button"
          data-offer-delete-confirm-button=""
          disabled={busy}
          onClick={onConfirm}
          className="inline-flex min-h-9 items-center rounded-md bg-negative px-2.5 text-[11px] font-semibold text-surface disabled:opacity-50"
        >
          {busy ? t("offerDeleting") : t("offerDeleteConfirm")}
        </button>
        <button
          ref={cancelRef}
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="inline-flex min-h-9 items-center rounded-md border border-border px-2.5 text-[11px] text-text disabled:opacity-50"
        >
          {t("offerFormCancel")}
        </button>
      </div>
    </div>
  );
}

type FieldKey = "product_id" | "starts_at" | "ends_at" | "position";

function OfferForm({
  offer,
  offers,
  management,
  locale,
  t,
  onClose,
}: {
  offer: WorkspaceOffer | undefined;
  offers: WorkspaceOffer[];
  management: OfferManagement;
  locale: CustomizerLocale;
  t: T;
  onClose: () => void;
}) {
  const uid = useId();
  const editing = offer !== undefined;
  const initial = {
    productId: offer?.productId ?? null,
    active: offer?.isActive ?? true,
    starts: isoToLocalInput(offer?.startsAt ?? null),
    ends: isoToLocalInput(offer?.endsAt ?? null),
    position: offer ? String(offer.position) : "",
  };

  const [productId, setProductId] = useState<string | null>(initial.productId);
  const [product, setProduct] = useState<{ name: string; thumbnailUrl: string | null } | null>(
    offer?.product ? { name: offerDisplayName(offer, locale) ?? offer.product.name, thumbnailUrl: offer.product.thumbnailUrl } : null,
  );
  const [changingProduct, setChangingProduct] = useState(!editing);
  const [active, setActive] = useState(initial.active);
  const [starts, setStarts] = useState(initial.starts);
  const [ends, setEnds] = useState(initial.ends);
  const [position, setPosition] = useState(initial.position);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  // Opening the form moves keyboard / screen-reader focus into it (the button
  // that opened it has just unmounted), so Escape and Tab work from the start.
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  // Basic UX guard only: the server remains the authority (409 on a duplicate).
  const takenProductIds = new Set(offers.filter((row) => row.id !== offer?.id).map((row) => row.productId));

  function failure(result: WorkspaceOfferMutationFailure) {
    const server: WorkspaceOfferFieldErrors = result.fieldErrors;
    const next: Partial<Record<FieldKey, string>> = {};
    if (server.product_id) next.product_id = server.product_id;
    if (server.starts_at) next.starts_at = server.starts_at;
    if (server.ends_at) next.ends_at = server.ends_at;
    if (server.position) next.position = server.position;
    setFieldErrors(next);
    if (result.reason === "conflict") {
      setFieldErrors({ product_id: t("offerErrConflict") });
      setFormError(t("offerErrReview"));
    } else if (result.reason === "validation") {
      setFormError(Object.keys(next).length > 0 ? t("offerErrReview") : result.message || t("offerErrFailed"));
    } else if (result.reason === "not_found") {
      setFormError(t("offerErrNotFound"));
    } else if (result.reason === "forbidden") {
      setFormError(t("offerErrForbidden"));
    } else {
      setFormError(t("offerErrFailed"));
    }
    // Move attention to the summary so the failure is announced and reachable.
    queueMicrotask(() => formRef.current?.querySelector<HTMLElement>("[data-offer-form-error]")?.focus());
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    const errors: Partial<Record<FieldKey, string>> = {};
    if (!productId) errors.product_id = t("offerFormProductRequired");
    const trimmedPosition = position.trim();
    let parsedPosition: number | null = null;
    if (trimmedPosition !== "") {
      const value = Number(trimmedPosition);
      if (!Number.isInteger(value) || value < 0 || value > OFFER_MAX_POSITION) {
        errors.position = t("offerFormPositionInvalid");
      } else {
        parsedPosition = value;
      }
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setFormError(t("offerErrReview"));
      queueMicrotask(() => formRef.current?.querySelector<HTMLElement>("[data-offer-form-error]")?.focus());
      return;
    }
    setFieldErrors({});
    setFormError(null);

    let input: WorkspaceOfferWrite;
    if (editing) {
      // PATCH carries only what changed; `null` clears a bound.
      input = {};
      if (productId !== initial.productId) input.productId = productId as string;
      if (active !== initial.active) input.isActive = active;
      if (starts !== initial.starts) input.startsAt = localInputToIso(starts);
      if (ends !== initial.ends) input.endsAt = localInputToIso(ends);
      if (trimmedPosition !== initial.position && parsedPosition !== null) input.position = parsedPosition;
      if (Object.keys(input).length === 0) {
        onClose();
        return;
      }
    } else {
      input = { productId: productId as string, isActive: active, position: parsedPosition };
      const startsIso = localInputToIso(starts);
      const endsIso = localInputToIso(ends);
      if (startsIso) input.startsAt = startsIso;
      if (endsIso) input.endsAt = endsIso;
    }

    setSubmitting(true);
    const result = editing ? await management.update((offer as WorkspaceOffer).id, input) : await management.create(input);
    setSubmitting(false);
    if (result.ok) {
      onClose();
      return;
    }
    failure(result);
  }

  const err = (field: FieldKey) => fieldErrors[field];
  const describedBy = (field: FieldKey, extra?: string) =>
    [err(field) ? `${uid}-${field}-error` : null, extra].filter(Boolean).join(" ") || undefined;

  return (
    <form
      ref={formRef}
      data-offer-form={editing ? "edit" : "create"}
      aria-labelledby={`${uid}-title`}
      noValidate
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !submitting) {
          event.stopPropagation();
          onClose();
        }
      }}
      className="space-y-4 border-t border-border pt-3"
    >
      <h3 ref={titleRef} tabIndex={-1} id={`${uid}-title`} className="text-sm font-semibold text-text outline-none">
        {editing ? t("offerFormEditTitle") : t("offerFormCreateTitle")}
      </h3>

      {formError ? (
        <p
          role="alert"
          tabIndex={-1}
          data-offer-form-error=""
          className="rounded-md border border-negative/30 bg-negative/5 px-2 py-1.5 text-xs font-medium text-negative outline-none"
        >
          {formError}
        </p>
      ) : null}

      <p className="text-xs leading-relaxed text-muted">{t("offerFormPriceNote")}</p>

      <ProductField
        uid={uid}
        t={t}
        management={management}
        selectedId={productId}
        selected={product}
        changing={changingProduct}
        onStartChange={() => setChangingProduct(true)}
        takenProductIds={takenProductIds}
        error={err("product_id")}
        errorId={`${uid}-product_id-error`}
        onPick={(picked) => {
          setProductId(picked.id);
          setProduct({ name: (locale === "en" && picked.nameEn) || picked.name, thumbnailUrl: picked.thumbnailUrl });
          setChangingProduct(false);
          setFieldErrors((prev) => ({ ...prev, product_id: undefined }));
        }}
        locale={locale}
      />

      <label className="flex min-h-10 items-center gap-2 text-sm text-text">
        <input
          type="checkbox"
          data-offer-active=""
          checked={active}
          onChange={(event) => setActive(event.target.checked)}
          className="size-5 shrink-0 accent-primary"
        />
        <span>{t("offerFormActive")}</span>
      </label>

      <DateField
        id={`${uid}-starts`}
        label={t("offerFormStarts")}
        clearLabel={t("offerFormClearDate")}
        value={starts}
        onChange={setStarts}
        error={err("starts_at")}
        errorId={`${uid}-starts_at-error`}
        describedBy={describedBy("starts_at")}
        dataAttr="data-offer-starts"
      />
      <DateField
        id={`${uid}-ends`}
        label={t("offerFormEnds")}
        clearLabel={t("offerFormClearDate")}
        value={ends}
        onChange={setEnds}
        error={err("ends_at")}
        errorId={`${uid}-ends_at-error`}
        describedBy={describedBy("ends_at")}
        dataAttr="data-offer-ends"
      />

      <div className="space-y-1">
        <label htmlFor={`${uid}-position`} className="block text-xs font-medium text-text">
          {t("offerFormPosition")}
        </label>
        <input
          id={`${uid}-position`}
          data-offer-position=""
          type="number"
          inputMode="numeric"
          min={0}
          max={OFFER_MAX_POSITION}
          step={1}
          dir="ltr"
          value={position}
          onChange={(event) => setPosition(event.target.value)}
          aria-invalid={err("position") ? true : undefined}
          aria-describedby={describedBy("position", `${uid}-position-hint`)}
          className={fieldClass}
        />
        <p id={`${uid}-position-hint`} className="text-[11px] text-muted">
          {t("offerFormPositionHint")}
        </p>
        {err("position") ? (
          <p id={`${uid}-position-error`} data-offer-field-error="position" className="text-xs font-medium text-negative">
            {err("position")}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" data-offer-submit="" disabled={submitting} className={primaryButtonClass}>
          {submitting ? t("offerFormSaving") : editing ? t("offerFormSave") : t("offerFormCreate")}
        </button>
        <button type="button" data-offer-cancel="" disabled={submitting} onClick={onClose} className={buttonClass}>
          {t("offerFormCancel")}
        </button>
      </div>
    </form>
  );
}

function DateField({
  id,
  label,
  clearLabel,
  value,
  onChange,
  error,
  errorId,
  describedBy,
  dataAttr,
}: {
  id: string;
  label: string;
  clearLabel: string;
  value: string;
  onChange: (value: string) => void;
  error: string | undefined;
  errorId: string;
  describedBy: string | undefined;
  dataAttr: string;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs font-medium text-text">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          {...{ [dataAttr]: "" }}
          type="datetime-local"
          dir="ltr"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={`${fieldClass} min-w-0 flex-1`}
        />
        {value ? (
          <button
            type="button"
            className="inline-flex min-h-10 shrink-0 items-center rounded-md px-2 text-xs text-muted underline-offset-2 hover:underline"
            onClick={() => onChange("")}
          >
            {clearLabel}
            <span className="sr-only">: {label}</span>
          </button>
        ) : null}
      </div>
      {error ? (
        <p id={errorId} data-offer-field-error={dataAttr.replace("data-offer-", "") + "_at"} className="text-xs font-medium text-negative">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ProductField({
  uid,
  t,
  management,
  selectedId,
  selected,
  changing,
  onStartChange,
  takenProductIds,
  error,
  errorId,
  onPick,
  locale,
}: {
  uid: string;
  t: T;
  management: OfferManagement;
  selectedId: string | null;
  selected: { name: string; thumbnailUrl: string | null } | null;
  changing: boolean;
  onStartChange: () => void;
  takenProductIds: Set<string>;
  error: string | undefined;
  errorId: string;
  onPick: (product: WorkspaceProductSummary) => void;
  locale: CustomizerLocale;
}) {
  const [search, setSearch] = useState("");
  const [list, setList] = useState<WorkspaceProductSummary[]>([]);
  const [listState, setListState] = useState<"loading" | "error" | "ready">("loading");
  const [retry, setRetry] = useState(0);
  const searchFn = management.searchProducts;
  const searchRef = useRef(searchFn);
  searchRef.current = searchFn;

  // The real workspace product source (same read the Featured picker uses).
  // Aborts the superseded request so a slow earlier search can never overwrite
  // a newer one.
  useEffect(() => {
    if (!changing) return;
    const controller = new AbortController();
    setListState("loading");
    const handle = setTimeout(async () => {
      const result = await searchRef.current(search.trim(), controller.signal);
      if (controller.signal.aborted) return;
      if (!result.ok) {
        setListState("error");
        setList([]);
        return;
      }
      setList(result.data);
      setListState("ready");
    }, search ? 250 : 0);
    return () => {
      clearTimeout(handle);
      controller.abort();
    };
  }, [changing, search, retry]);

  return (
    <fieldset className="min-w-0 space-y-2" aria-describedby={error ? errorId : undefined}>
      <legend className="text-xs font-medium text-text">{t("offerFormProduct")}</legend>

      {!changing ? (
        <div data-offer-selected-product="" className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5">
          <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-muted">
            {selected?.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- thumbnail is an untrusted tenant media URL, not a static asset
              <img src={selected.thumbnailUrl} alt="" className="size-full object-cover" />
            ) : null}
          </span>
          <span className="line-clamp-2 min-w-0 flex-1 break-words text-sm">
            <bdi>{selected?.name ?? t("offersUnavailable")}</bdi>
          </span>
          <button type="button" data-offer-product-change="" className={buttonClass} onClick={onStartChange}>
            {t("offerFormProductChange")}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {selected && selectedId ? (
            <p data-offer-selected-product="" className="text-xs text-muted">
              <bdi className="font-medium text-text">{selected.name}</bdi>
            </p>
          ) : (
            <p className="text-xs text-muted">{t("offerFormProductNone")}</p>
          )}
          <label htmlFor={`${uid}-product-search`} className="sr-only">
            {t("offerFormProductSearch")}
          </label>
          <input
            id={`${uid}-product-search`}
            data-offer-product-search=""
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("offerFormProductSearchPlaceholder")}
            aria-invalid={error ? true : undefined}
            className={fieldClass}
          />
          <div
            role="listbox"
            aria-label={t("offerFormProductResults")}
            className="flex max-h-56 flex-col gap-0.5 overflow-y-auto"
          >
            {listState === "loading" ? (
              <p data-offer-product-loading="" className="px-2 py-3 text-center text-xs text-muted">
                {t("offerFormProductLoading")}
              </p>
            ) : listState === "error" ? (
              <div data-offer-product-error="" className="flex flex-col items-center gap-2 px-2 py-3 text-center text-xs text-muted">
                <span>{t("offerFormProductError")}</span>
                <button type="button" className={buttonClass} onClick={() => setRetry((n) => n + 1)}>
                  {t("retry")}
                </button>
              </div>
            ) : list.length === 0 ? (
              <p data-offer-product-empty="" className="px-2 py-3 text-center text-xs text-muted">
                {t("offerFormProductEmpty")}
              </p>
            ) : (
              list.map((candidate) => {
                const variant = candidate.isVariantManaged;
                const taken = takenProductIds.has(candidate.id);
                const disabled = variant || taken;
                const name = (locale === "en" && candidate.nameEn) || candidate.name;
                return (
                  <button
                    key={candidate.id}
                    type="button"
                    role="option"
                    aria-selected={candidate.id === selectedId}
                    aria-disabled={disabled || undefined}
                    disabled={disabled}
                    data-offer-product-option={candidate.id}
                    onClick={() => onPick(candidate)}
                    className={`flex min-h-11 w-full shrink-0 items-center gap-2 rounded-md px-2 py-1 text-start disabled:opacity-60 ${
                      candidate.id === selectedId ? "bg-primary-soft text-primary" : "text-text hover:bg-primary-soft"
                    }`}
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center self-start overflow-hidden rounded-md bg-surface-muted">
                      {candidate.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- thumbnail is an untrusted tenant media URL, not a static asset
                        <img src={candidate.thumbnailUrl} alt="" className="size-full object-cover" />
                      ) : null}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="line-clamp-2 break-words text-sm">
                        <bdi>{name}</bdi>
                      </span>
                      {variant ? <span className="text-[11px] text-muted">{t("offerFormProductVariant")}</span> : null}
                      {!variant && taken ? <span className="text-[11px] text-muted">{t("offerFormProductTaken")}</span> : null}
                    </span>
                    {candidate.id === selectedId ? <span aria-hidden="true">✓</span> : null}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}

      {error ? (
        <p id={errorId} data-offer-field-error="product_id" className="text-xs font-medium text-negative">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
