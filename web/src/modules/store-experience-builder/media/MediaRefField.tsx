"use client";

/**
 * CUST-HV V4b — one media slot inside an inspector: the selected-media card
 * (V0 §7.10). It edits **one `MediaRef`** (this usage), never the library asset.
 *
 *   thumbnail · name · dimensions · "used in N places"
 *   Edit image · Replace · Remove
 *   decorative toggle  — when on, both alt fields disappear (AMEND-10)
 *   per-usage alt AR / EN — an empty field shows what will actually be used
 *                           ("library default: …" / "required before Publish") (AMEND-14)
 *   per-usage readiness   — processing / ready / failed + Retry for *this* usage
 *
 * The document only ever receives a `MediaRef`; the signed preview URLs on
 * screen are editor-only and never stored.
 */
import { AlertTriangle, ImageOff, Loader2, Pencil, RefreshCw, Replace, Trash2 } from "lucide-react";
import { useEffect, useId, useState } from "react";
import {
  fetchStorefrontMediaAsset,
  resolveAltCoverage,
  type AltCoverage,
  type StorefrontMediaAsset,
} from "@/modules/commerce-workspace/storefront-media";
import type { CustomizerMessageKey } from "../messages";
import { MEDIA_ALT_MAX, type MediaRef } from "../presentation/media-ref";
import { MediaFramingEditor } from "./MediaFramingEditor";
import { MediaPicker } from "./MediaPicker";
import { mediaBtnClass, mediaInputClass } from "./ui";
import { useUsageReadiness } from "./use-usage-readiness";

type T = (key: CustomizerMessageKey) => string;

type AssetState =
  | { kind: "loading" }
  | { kind: "ready"; asset: StorefrontMediaAsset }
  | { kind: "stale" }
  | { kind: "error" };

export function MediaRefField({
  label,
  hint,
  value,
  onChange,
  t,
  slot,
  locale,
  decorativeOnly = false,
}: {
  label: string;
  hint?: string;
  value: MediaRef | null;
  onChange: (next: MediaRef | null) => void;
  t: T;
  /** Stable id for tests / evidence (`logo`, `compactLogo`, `favicon`, …). */
  slot: string;
  locale: "ar" | "en";
  /**
   * CUST-HV V6b-4b — a section-background picture is decoration by contract (the normaliser makes it
   * `decorative`, drops its alt): the decorative toggle and the alt fields are not offered.
   */
  decorativeOnly?: boolean;
}) {
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [assetState, setAssetState] = useState<AssetState>({ kind: "loading" });
  const readiness = useUsageReadiness(value);
  const id = useId();
  const mediaId = value?.mediaId ?? null;

  useEffect(() => {
    if (!mediaId) return;
    const controller = new AbortController();
    setAssetState({ kind: "loading" });
    fetchStorefrontMediaAsset(mediaId, controller.signal)
      .then((asset) => {
        if (controller.signal.aborted) return;
        setAssetState(asset ? { kind: "ready", asset } : { kind: "stale" });
      })
      .catch(() => {
        if (!controller.signal.aborted) setAssetState({ kind: "error" });
      });
    return () => controller.abort();
  }, [mediaId]);

  const asset = assetState.kind === "ready" ? assetState.asset : null;

  function select(next: StorefrontMediaAsset) {
    setPicking(false);
    // A different image invalidates the framing and the alt written for the old
    // one; only the (semantic) decorative choice survives a replacement.
    onChange({ mediaId: next.id, ...(value?.decorative ? { decorative: true as const } : {}) });
  }

  function setAlt(locale: "ar" | "en", text: string) {
    if (!value) return;
    const alt = { ...(value.alt ?? {}) };
    if (text === "") delete alt[locale];
    else alt[locale] = text;
    const next: MediaRef = { ...value };
    if (alt.ar === undefined && alt.en === undefined) delete next.alt;
    else next.alt = alt;
    onChange(next);
  }

  function setDecorative(on: boolean) {
    if (!value) return;
    const next: MediaRef = { ...value };
    if (on) next.decorative = true;
    else delete next.decorative;
    onChange(next);
  }

  const thumb = readiness.previewUrl ?? asset?.thumbnailUrl ?? asset?.previewUrl ?? null;

  return (
    <div className="space-y-2" data-media-field={slot}>
      <span className="block text-[12px] font-medium text-muted">{label}</span>

      {!value ? (
        <button type="button" className={mediaBtnClass} onClick={() => setPicking(true)} data-media-pick={slot}>
          {t("mediaPick")}
        </button>
      ) : (
        <div className="space-y-3 border border-border bg-surface p-3">
          <div className="flex items-start gap-3">
            <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden border border-border bg-background">
              {assetState.kind === "loading" ? (
                <Loader2 aria-hidden="true" className="size-4 animate-spin text-muted" />
              ) : thumb ? (
                // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived workspace URL
                <img src={thumb} alt="" className="size-full object-contain" />
              ) : (
                <ImageOff aria-hidden="true" className="size-5 text-muted" />
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-0.5">
              {assetState.kind === "stale" ? (
                <p role="alert" className="text-[12px] leading-5 text-negative" data-media-stale="">
                  <span className="font-medium">{t("mediaRemovedPlaceholder")}.</span> {t("mediaStale")}
                </p>
              ) : assetState.kind === "error" ? (
                <p role="alert" className="text-[12px] leading-5 text-negative">{t("mediaNetworkError")}</p>
              ) : (
                <>
                  <p className="truncate text-[13px] font-medium text-text" dir="auto" title={asset?.name}>
                    {asset?.name ?? "…"}
                  </p>
                  {asset ? (
                    <p className="text-[11px] tabular-nums text-muted" dir="ltr">
                      {asset.width}×{asset.height}
                      {asset.usageCount ? ` · ${t("mediaUsedIn")} ${asset.usageCount} ${t("mediaPlaces")}` : ""}
                    </p>
                  ) : null}
                </>
              )}
              <ReadinessLine state={readiness.state} t={t} onRetry={readiness.retry} />
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              className={mediaBtnClass}
              disabled={!asset || asset.variantsState !== "ready"}
              onClick={() => setEditing(true)}
              data-media-edit={slot}
            >
              <Pencil aria-hidden="true" className="size-3.5" />
              {t("mediaEditImage")}
            </button>
            <button type="button" className={mediaBtnClass} onClick={() => setPicking(true)}>
              <Replace aria-hidden="true" className="size-3.5" />
              {t("mediaReplace")}
            </button>
            <button type="button" className={mediaBtnClass} onClick={() => onChange(null)} data-media-remove={slot}>
              <Trash2 aria-hidden="true" className="size-3.5" />
              {t("mediaRemove")}
            </button>
          </div>

          {decorativeOnly ? null : (
          <label className="flex min-h-11 cursor-pointer items-start gap-2 text-[13px] text-text md:min-h-9" htmlFor={`${id}-deco`}>
            <input
              id={`${id}-deco`}
              type="checkbox"
              checked={value.decorative === true}
              onChange={(e) => setDecorative(e.target.checked)}
              className="mt-0.5 size-4 accent-[var(--primary)]"
            />
            <span>
              {t("mediaDecorative")}
              {value.decorative ? (
                <span className="mt-0.5 block text-[12px] leading-5 text-muted">{t("mediaDecorativeHint")}</span>
              ) : null}
            </span>
          </label>
          )}

          {decorativeOnly || value.decorative ? null : (
            <div className="space-y-3">
              {(["ar", "en"] as const).map((locale) => (
                <AltField
                  key={locale}
                  id={`${id}-alt-${locale}`}
                  locale={locale}
                  label={locale === "ar" ? t("mediaAltAr") : t("mediaAltEn")}
                  value={value.alt?.[locale] ?? ""}
                  coverage={resolveAltCoverage(value, asset, locale)}
                  onChange={(text) => setAlt(locale, text)}
                  t={t}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {hint ? <p className="text-[12px] leading-5 text-muted">{hint}</p> : null}

      <MediaPicker open={picking} onClose={() => setPicking(false)} onSelect={select} t={t} locale={locale} />
      {value && asset ? (
        <MediaFramingEditor
          // A fresh editor per opening: it seeds its draft framing from `value`.
          key={editing ? "open" : "closed"}
          open={editing}
          onClose={() => setEditing(false)}
          value={value}
          asset={asset}
          onApply={(next) => {
            setEditing(false);
            onChange(next);
          }}
          t={t}
          locale={locale}
          coverOnly={decorativeOnly}
        />
      ) : null}
    </div>
  );
}

function AltField({
  id,
  locale,
  label,
  value,
  coverage,
  onChange,
  t,
}: {
  id: string;
  locale: "ar" | "en";
  label: string;
  value: string;
  coverage: AltCoverage;
  onChange: (text: string) => void;
  t: T;
}) {
  const missing = coverage.kind === "missing";
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-[12px] font-medium text-muted">
        {label}
      </label>
      <input
        id={id}
        value={value}
        maxLength={MEDIA_ALT_MAX}
        dir={locale === "ar" ? "rtl" : "ltr"}
        lang={locale}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={`${id}-cov`}
        aria-invalid={missing || undefined}
        className={mediaInputClass}
        data-media-alt={locale}
      />
      <p
        id={`${id}-cov`}
        className={`text-[12px] leading-5 ${missing ? "text-negative" : "text-muted"}`}
        data-alt-coverage={coverage.kind}
      >
        {coverage.kind === "library" ? (
          <>
            {t("mediaAltLibrary")}{" "}
            <span dir={locale === "ar" ? "rtl" : "ltr"} lang={locale}>
              “{coverage.text}”
            </span>
          </>
        ) : null}
        {missing ? t("mediaAltMissing") : null}
      </p>
    </div>
  );
}

function ReadinessLine({
  state,
  t,
  onRetry,
}: {
  state: ReturnType<typeof useUsageReadiness>["state"];
  t: T;
  onRetry: () => void;
}) {
  if (state === "none") return null;
  if (state === "failed") {
    return (
      <div className="flex flex-wrap items-center gap-2" data-media-readiness="failed">
        <span role="alert" className="flex items-center gap-1 text-[12px] text-negative">
          <AlertTriangle aria-hidden="true" className="size-3.5" />
          {t("mediaUsageFailed")}
        </span>
        <button type="button" className={mediaBtnClass} onClick={onRetry} data-media-retry="">
          <RefreshCw aria-hidden="true" className="size-3.5" />
          {t("mediaUsageRetry")}
        </button>
      </div>
    );
  }
  if (state === "ready") {
    return (
      <p className="text-[12px] text-muted" data-media-readiness="ready">
        {t("mediaUsageReady")}
      </p>
    );
  }
  return (
    <p role="status" className="flex items-center gap-1 text-[12px] text-muted" data-media-readiness={state}>
      <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
      {t("mediaUsageProcessing")}
    </p>
  );
}
