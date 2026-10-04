"use client";

/**
 * FLOWERS-H9c / ADR-21 — editors for the three data-backed home sections
 * (`productShelf`, `discovery`, `deliveryPromise`).
 *
 * They edit *references and text only*: a collection slug or a facet
 * key + value, a facet dimension (or brands), the deliver-today switch, a
 * limit and optional copy. The pickers read the merchant's real collections and
 * facets from the Merchandising API; nothing resolved (products, prices,
 * counts, delivery dates) is ever written into the document.
 *
 * Every edit goes through the builder's normalizer, which drops content that is
 * not usable yet (e.g. a shelf with no source). Each editor therefore keeps its
 * own draft (keyed by the section id by the caller) so half-finished choices —
 * "Collection" picked but no collection chosen yet — are not lost, and commits
 * `undefined` content until the choice is complete, with an explicit warning.
 */

import { useCallback, useEffect, useState } from "react";
import {
  type Collection,
  type Facet,
  loadCollections,
  loadFacets,
} from "@/modules/commerce-workspace/merchandising/client";
import { Field, Toggle, inputClass, selectClass } from "./ControlPanels";
import type { CustomizerLocale, CustomizerMessageKey } from "./messages";
import {
  type DeliveryPromiseContent,
  type DiscoveryContent,
  DISCOVERY_DISPLAYS,
  type DiscoveryDisplay,
  MAX_DELIVERY_PROMISE_BODY_LENGTH,
  MAX_SECTION_TITLE_LENGTH,
  type ProductShelfContent,
  SHELF_LIMIT_DEFAULT,
  SHELF_LIMIT_MAX,
  SHELF_LIMIT_MIN,
  type ShelfSource,
} from "./presentation/section-content";

type T = (key: CustomizerMessageKey) => string;

type Remote<A> =
  | { state: "loading" }
  | { state: "error" }
  | { state: "ready"; data: A };

function useRemote<A>(load: () => Promise<A | null>): [Remote<A>, () => void] {
  const [remote, setRemote] = useState<Remote<A>>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setRemote({ state: "loading" });
    load()
      .then((data) => {
        if (cancelled) return;
        setRemote(data === null ? { state: "error" } : { state: "ready", data });
      })
      .catch(() => {
        if (!cancelled) setRemote({ state: "error" });
      });
    return () => {
      cancelled = true;
    };
    // `load` is a stable module function; only a retry re-runs the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);
  return [remote, useCallback(() => setAttempt((n) => n + 1), [])];
}

function RemoteStatus({
  remote,
  retry,
  t,
}: {
  remote: Remote<unknown>;
  retry: () => void;
  t: T;
}) {
  if (remote.state === "loading") {
    return (
      <p role="status" className="text-xs text-neutral-500">
        {t("dataLoading")}
      </p>
    );
  }
  if (remote.state === "error") {
    return (
      <p role="alert" className="flex items-center gap-2 text-xs text-red-700">
        <span>{t("dataLoadFailed")}</span>
        <button type="button" className="font-medium underline" onClick={retry}>
          {t("dataRetry")}
        </button>
      </p>
    );
  }
  return null;
}

function localized(
  name: string,
  nameEn: string | null,
  locale: CustomizerLocale,
): string {
  return locale === "en" && nameEn ? nameEn : name;
}

function Incomplete({ message }: { message: string }) {
  return (
    <p
      role="note"
      data-section-incomplete=""
      className="border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900"
    >
      {message}
    </p>
  );
}

function TitleField({
  value,
  onChange,
  t,
}: {
  value: string;
  onChange: (value: string) => void;
  t: T;
}) {
  return (
    <Field label={t("dataTitleLabel")}>
      <input
        className={inputClass}
        value={value}
        maxLength={MAX_SECTION_TITLE_LENGTH}
        placeholder={t("dataTitlePlaceholder")}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

// ── productShelf ────────────────────────────────────────────────────────

type ShelfKind = "none" | "collection" | "facet";

function kindOf(source: ShelfSource | undefined): ShelfKind {
  return source?.kind ?? "none";
}

export function ProductShelfFields({
  content,
  locale,
  t,
  onChange,
}: {
  content: ProductShelfContent;
  locale: CustomizerLocale;
  t: T;
  /** `undefined` while the choice is incomplete (nothing usable to store). */
  onChange: (content: ProductShelfContent | undefined) => void;
}) {
  const [title, setTitle] = useState(content.title);
  const [kind, setKind] = useState<ShelfKind>(kindOf(content.source));
  const [slug, setSlug] = useState(
    content.source?.kind === "collection" ? content.source.slug : "",
  );
  const [facetKey, setFacetKey] = useState(
    content.source?.kind === "facet" ? content.source.key : "",
  );
  const [facetValue, setFacetValue] = useState(
    content.source?.kind === "facet" ? content.source.value : "",
  );
  const [deliverToday, setDeliverToday] = useState(content.deliverToday);
  const [limit, setLimit] = useState(content.limit);

  const [collections, retryCollections] = useRemote(loadCollections);
  const [facets, retryFacets] = useRemote(loadFacets);

  const commit = (next: {
    title?: string;
    kind?: ShelfKind;
    slug?: string;
    facetKey?: string;
    facetValue?: string;
    deliverToday?: boolean;
    limit?: number;
  }) => {
    const nextKind = next.kind ?? kind;
    const nextTitle = next.title ?? title;
    const nextSlug = next.slug ?? slug;
    const nextFacetKey = next.facetKey ?? facetKey;
    const nextFacetValue = next.facetValue ?? facetValue;
    const nextDeliver = next.deliverToday ?? deliverToday;
    const nextLimit = next.limit ?? limit;
    if (next.title !== undefined) setTitle(next.title);
    if (next.kind !== undefined) setKind(next.kind);
    if (next.slug !== undefined) setSlug(next.slug);
    if (next.facetKey !== undefined) setFacetKey(next.facetKey);
    if (next.facetValue !== undefined) setFacetValue(next.facetValue);
    if (next.deliverToday !== undefined) setDeliverToday(next.deliverToday);
    if (next.limit !== undefined) setLimit(next.limit);

    let source: ShelfSource | undefined;
    if (nextKind === "collection" && nextSlug) {
      source = { kind: "collection", slug: nextSlug };
    } else if (nextKind === "facet" && nextFacetKey && nextFacetValue) {
      source = { kind: "facet", key: nextFacetKey, value: nextFacetValue };
    }
    if (!source && !nextDeliver) {
      onChange(undefined);
      return;
    }
    onChange({
      title: nextTitle,
      ...(source ? { source } : {}),
      deliverToday: nextDeliver,
      limit: nextLimit,
    });
  };

  const activeCollections =
    collections.state === "ready"
      ? collections.data.filter((collection: Collection) => collection.status === "active")
      : [];
  const activeFacets =
    facets.state === "ready"
      ? facets.data.filter((facet: Facet) => facet.isActive)
      : [];
  const selectedFacet = activeFacets.find((facet) => facet.key === facetKey);
  const complete =
    deliverToday ||
    (kind === "collection" && slug !== "") ||
    (kind === "facet" && facetKey !== "" && facetValue !== "");

  return (
    <div className="space-y-4" data-data-section="productShelf">
      <TitleField value={title} onChange={(value) => commit({ title: value })} t={t} />

      <Field label={t("shelfSourceLabel")}>
        <select
          className={selectClass}
          value={kind}
          onChange={(event) => commit({ kind: event.target.value as ShelfKind })}
        >
          <option value="none">{t("shelfSourceNone")}</option>
          <option value="collection">{t("shelfSourceCollection")}</option>
          <option value="facet">{t("shelfSourceFacet")}</option>
        </select>
      </Field>

      {kind === "collection" ? (
        <div className="space-y-2">
          <RemoteStatus remote={collections} retry={retryCollections} t={t} />
          {collections.state === "ready" ? (
            activeCollections.length === 0 && slug === "" ? (
              <p className="text-xs text-neutral-500">{t("shelfNoCollections")}</p>
            ) : (
              <Field label={t("shelfCollectionLabel")}>
                <select
                  className={selectClass}
                  value={slug}
                  onChange={(event) => commit({ slug: event.target.value })}
                >
                  <option value="">{t("shelfCollectionPlaceholder")}</option>
                  {slug !== "" &&
                  !activeCollections.some((collection) => collection.slug === slug) ? (
                    <option value={slug}>{slug}</option>
                  ) : null}
                  {activeCollections.map((collection) => (
                    <option key={collection.id} value={collection.slug}>
                      {localized(collection.title, collection.titleEn, locale)}
                    </option>
                  ))}
                </select>
              </Field>
            )
          ) : null}
        </div>
      ) : null}

      {kind === "facet" ? (
        <div className="space-y-2">
          <RemoteStatus remote={facets} retry={retryFacets} t={t} />
          {facets.state === "ready" ? (
            activeFacets.length === 0 && facetKey === "" ? (
              <p className="text-xs text-neutral-500">{t("shelfNoFacets")}</p>
            ) : (
              <>
                <Field label={t("shelfFacetLabel")}>
                  <select
                    className={selectClass}
                    value={facetKey}
                    onChange={(event) =>
                      commit({ facetKey: event.target.value, facetValue: "" })
                    }
                  >
                    <option value="">{t("shelfFacetPlaceholder")}</option>
                    {facetKey !== "" && !selectedFacet ? (
                      <option value={facetKey}>{facetKey}</option>
                    ) : null}
                    {activeFacets.map((facet) => (
                      <option key={facet.id} value={facet.key}>
                        {localized(facet.name, facet.nameEn, locale)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t("shelfFacetValueLabel")}>
                  <select
                    className={selectClass}
                    value={facetValue}
                    disabled={facetKey === ""}
                    onChange={(event) => commit({ facetValue: event.target.value })}
                  >
                    <option value="">{t("shelfFacetValuePlaceholder")}</option>
                    {facetValue !== "" &&
                    !selectedFacet?.values.some((value) => value.slug === facetValue) ? (
                      <option value={facetValue}>{facetValue}</option>
                    ) : null}
                    {(selectedFacet?.values ?? [])
                      .filter((value) => value.isActive)
                      .map((value) => (
                        <option key={value.id} value={value.slug}>
                          {localized(value.name, value.nameEn, locale)}
                        </option>
                      ))}
                  </select>
                </Field>
              </>
            )
          ) : null}
        </div>
      ) : null}

      <Toggle
        label={t("shelfDeliverToday")}
        checked={deliverToday}
        onChange={(value) => commit({ deliverToday: value })}
      />
      <p className="text-xs leading-5 text-neutral-500">{t("shelfDeliverTodayHint")}</p>

      <Field label={t("shelfLimitLabel")}>
        <select
          className={selectClass}
          value={limit}
          onChange={(event) => commit({ limit: Number(event.target.value) })}
        >
          {Array.from(
            { length: SHELF_LIMIT_MAX - SHELF_LIMIT_MIN + 1 },
            (_, i) => SHELF_LIMIT_MIN + i,
          ).map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </Field>

      {!complete ? <Incomplete message={t("shelfIncomplete")} /> : null}
    </div>
  );
}

// ── discovery ───────────────────────────────────────────────────────────

export function DiscoveryFields({
  content,
  locale,
  t,
  onChange,
}: {
  content: DiscoveryContent;
  locale: CustomizerLocale;
  t: T;
  onChange: (content: DiscoveryContent | undefined) => void;
}) {
  const [title, setTitle] = useState(content.title);
  const [axis, setAxis] = useState(content.axis);
  const [dimension, setDimension] = useState(content.dimension ?? "");
  const [display, setDisplay] = useState<DiscoveryDisplay>(content.display);
  const [facets, retryFacets] = useRemote(loadFacets);

  const commit = (next: {
    title?: string;
    axis?: DiscoveryContent["axis"];
    dimension?: string;
    display?: DiscoveryDisplay;
  }) => {
    const nextAxis = next.axis ?? axis;
    const nextDimension = next.dimension ?? dimension;
    const nextTitle = next.title ?? title;
    const nextDisplay = next.display ?? display;
    if (next.title !== undefined) setTitle(next.title);
    if (next.axis !== undefined) setAxis(next.axis);
    if (next.dimension !== undefined) setDimension(next.dimension);
    if (next.display !== undefined) setDisplay(next.display);

    if (nextAxis === "facet" && nextDimension === "") {
      onChange(undefined);
      return;
    }
    onChange({
      title: nextTitle,
      axis: nextAxis,
      ...(nextAxis === "facet" ? { dimension: nextDimension } : {}),
      display: nextDisplay,
    });
  };

  const activeFacets =
    facets.state === "ready"
      ? facets.data.filter((facet: Facet) => facet.isActive)
      : [];
  const complete = axis === "brand" || dimension !== "";

  return (
    <div className="space-y-4" data-data-section="discovery">
      <TitleField value={title} onChange={(value) => commit({ title: value })} t={t} />

      <Field label={t("discoveryAxisLabel")}>
        <select
          className={selectClass}
          value={axis}
          onChange={(event) =>
            commit({ axis: event.target.value as DiscoveryContent["axis"] })
          }
        >
          <option value="facet">{t("discoveryAxisFacet")}</option>
          <option value="brand">{t("discoveryAxisBrand")}</option>
        </select>
      </Field>

      {axis === "facet" ? (
        <div className="space-y-2">
          <RemoteStatus remote={facets} retry={retryFacets} t={t} />
          {facets.state === "ready" ? (
            activeFacets.length === 0 && dimension === "" ? (
              <p className="text-xs text-neutral-500">{t("shelfNoFacets")}</p>
            ) : (
              <Field label={t("discoveryDimensionLabel")}>
                <select
                  className={selectClass}
                  value={dimension}
                  onChange={(event) => commit({ dimension: event.target.value })}
                >
                  <option value="">{t("shelfFacetPlaceholder")}</option>
                  {dimension !== "" &&
                  !activeFacets.some((facet) => facet.key === dimension) ? (
                    <option value={dimension}>{dimension}</option>
                  ) : null}
                  {activeFacets.map((facet) => (
                    <option key={facet.id} value={facet.key}>
                      {localized(facet.name, facet.nameEn, locale)}
                    </option>
                  ))}
                </select>
              </Field>
            )
          ) : null}
        </div>
      ) : null}

      <Field label={t("discoveryDisplayLabel")}>
        <select
          className={selectClass}
          value={display}
          onChange={(event) =>
            commit({ display: event.target.value as DiscoveryDisplay })
          }
        >
          {DISCOVERY_DISPLAYS.map((value) => (
            <option key={value} value={value}>
              {value === "tiles" ? t("discoveryDisplayTiles") : t("discoveryDisplayChips")}
            </option>
          ))}
        </select>
      </Field>

      {!complete ? <Incomplete message={t("discoveryIncomplete")} /> : null}
    </div>
  );
}

// ── deliveryPromise ─────────────────────────────────────────────────────

export function DeliveryPromiseFields({
  content,
  t,
  onChange,
}: {
  content: DeliveryPromiseContent;
  t: T;
  onChange: (content: DeliveryPromiseContent | undefined) => void;
}) {
  const [title, setTitle] = useState(content.title);
  const [body, setBody] = useState(content.body);

  const commit = (nextTitle: string, nextBody: string) => {
    setTitle(nextTitle);
    setBody(nextBody);
    onChange(
      nextTitle.trim() === "" && nextBody.trim() === ""
        ? undefined
        : { title: nextTitle, body: nextBody },
    );
  };

  return (
    <div className="space-y-4" data-data-section="deliveryPromise">
      <p className="text-xs leading-5 text-neutral-500">{t("deliveryPromiseNote")}</p>
      <TitleField value={title} onChange={(value) => commit(value, body)} t={t} />
      <Field label={t("deliveryPromiseBodyLabel")}>
        <textarea
          className={`${inputClass} h-16 py-2`}
          value={body}
          maxLength={MAX_DELIVERY_PROMISE_BODY_LENGTH}
          onChange={(event) => commit(title, event.target.value)}
        />
      </Field>
    </div>
  );
}

export { SHELF_LIMIT_DEFAULT };
