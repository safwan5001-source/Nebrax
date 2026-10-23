"use client";

/**
 * P3-A-05 — the merchant control for the document-level `StorefrontBackground` (P3-A-02 contract),
 * inside the existing Appearance panel. It replaces the old single «Store background» colour field,
 * which wrote only the legacy `backgroundColor` and so silently lost to any `background` object.
 *
 * Three types — solid, gradient, image — and one rule (see `presentation/background-edit.ts`): a solid
 * is the legacy colour with no `background` object. «Restore default» is a different action from
 * switching type: it drops any gradient/image *and* returns the default colour.
 *
 * Publish readiness (P3-A-06): a gradient or image is published only when the contrast policy proves the page text readable
 * over it (`presentation/global-background-contrast.ts`, the twin of the server's `GlobalBackgroundContrast`). The panel shows the
 * predicted verdict — ready, or exactly why not — while the preview and the draft stay fully usable; the server re-judges at publish.
 * The document receives colours, enums and `MediaRef`s — never a URL, CSS string or resolved media.
 */
import { useEffect, useId, useState } from "react";
import { Field, Segmented, btnClass, inputClass, selectClass } from "./ControlPanels";
import { ColourField } from "./design/ColourField";
import { DIRECTION_LABEL } from "./design/DesignInspector";
import { MediaRefField } from "./media/MediaRefField";
import { useAnyAnimated } from "./media/use-animated-refs";
import { useBackgroundMediaBounds } from "./media/use-background-media-bounds";
import { FOCAL_SNAPS } from "./media/framing";
import type { CustomizerMessageKey } from "./messages";
import {
  type BackgroundType,
  type MediaBackgroundEdit,
  backgroundType,
  effectiveSolidHex,
  isBackgroundDefault,
  resetBackground,
  setGradient,
  setMediaBackground,
  setSolidColor,
  switchBackgroundType,
  withFocal,
} from "./presentation/background-edit";
import type { StorefrontPresentationConfig } from "./presentation/config";
import {
  type GlobalBackgroundVerdict,
  type GlobalForegroundRole,
  globalBackgroundVerdict,
  suggestLightOverlay,
} from "./presentation/global-background-contrast";
import type { MediaRef } from "./presentation/media-ref";
import { DIRECTIONS, OVERLAY_ALPHAS, type MediaOverlay } from "./presentation/section-design";
import type { DesignContext } from "./presentation/section-design-resolve";
import { resolveStorefrontBackgroundStyle } from "./presentation/storefront-background-render";
import { isSafeHexColor } from "./presentation/tokens";

type T = (key: CustomizerMessageKey) => string;
type Config = StorefrontPresentationConfig;

const FOREGROUND_LABEL: Record<GlobalForegroundRole, CustomizerMessageKey> = {
  text: "storeBackgroundFgText",
  muted: "storeBackgroundFgMuted",
  brand: "storeBackgroundFgBrand",
};

/**
 * What the server will decide about this background's contrast. «Ready» is claimed only when the policy proves it (and says
 * so about *this background*, not the whole document); otherwise the exact foregrounds that fail are listed. Never a heuristic.
 */
function PublishReadiness({
  verdict,
  blockedKey,
  t,
}: {
  verdict: GlobalBackgroundVerdict;
  blockedKey: CustomizerMessageKey;
  t: T;
}) {
  if (verdict.status === "ready") {
    return (
      <p role="status" data-global-bg-readiness="ready" className="border border-positive bg-surface px-2.5 py-2 text-[12px] leading-5 text-positive">
        {t("storeBackgroundReady")}
      </p>
    );
  }
  const failing = [
    ...verdict.failing.map((role) => t(FOREGROUND_LABEL[role])),
    ...(verdict.sectionText.length > 0 ? [t("storeBackgroundFgSection")] : []),
  ];
  return (
    <div role="note" data-global-bg-readiness="blocked" className={`${DRAFT_ONLY_NOTE_CLASS} space-y-1`}>
      <p>{t(blockedKey)}</p>
      {failing.length > 0 ? (
        <p data-global-bg-failing="">
          {t("storeBackgroundFailsFor")} {failing.join(" · ")}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The picture's predicted publish readiness. «Ready» only once the pixel evidence of every picture is in and the policy proves
 * it; while evidence is still being read it says so (never ready by default); an animated asset is named as such.
 */
function ImageReadiness({
  config,
  refs,
  bounds,
  animated,
  onApplyOverlay,
  t,
}: {
  config: Config;
  refs: MediaRef[];
  bounds: ReturnType<typeof useBackgroundMediaBounds>;
  animated: boolean;
  onApplyOverlay: (alpha: (typeof OVERLAY_ALPHAS)[number]) => void;
  t: T;
}) {
  if (animated) {
    return (
      <p role="note" data-global-bg-readiness="blocked" data-global-bg-reason="animated" className={DRAFT_ONLY_NOTE_CLASS}>
        {t("storeBackgroundImageAnimated")}
      </p>
    );
  }
  if (refs.some((ref) => bounds.stateOf(ref) === "loading")) {
    return (
      <p role="status" data-global-bg-readiness="checking" className="text-[12px] leading-5 text-muted">
        {t("storeBackgroundImageChecking")}
      </p>
    );
  }
  const verdict = globalBackgroundVerdict(config, bounds.lookup);
  if (verdict.status === "ready") return <PublishReadiness verdict={verdict} blockedKey="storeBackgroundImageInsufficient" t={t} />;
  if (verdict.status === "unproven" || verdict.status === "unresolved") {
    return (
      <p role="note" data-global-bg-readiness="blocked" data-global-bg-reason="unproven" className={DRAFT_ONLY_NOTE_CLASS}>
        {t("storeBackgroundImageUnproven")}
      </p>
    );
  }
  const suggestion = suggestLightOverlay(config, bounds.lookup);
  return (
    <div className="space-y-2">
      <PublishReadiness verdict={verdict} blockedKey="storeBackgroundImageInsufficient" t={t} />
      {suggestion !== null ? (
        <div className="flex flex-wrap items-center gap-2 text-[12px] leading-5 text-muted" data-global-bg-overlay-suggestion="">
          <span>
            {t("storeBackgroundImageSuggest")} <span dir="ltr">{suggestion}%</span>
          </span>
          <button type="button" className={btnClass} onClick={() => onApplyOverlay(suggestion)} data-global-bg-apply-overlay="">
            {t("storeBackgroundImageApplyOverlay")}
          </button>
        </div>
      ) : (
        <p className="text-[12px] leading-5 text-muted" data-global-bg-overlay-suggestion="none">
          {t("storeBackgroundImageNoOverlayFix")}
        </p>
      )}
    </div>
  );
}

const DRAFT_ONLY_NOTE_CLASS = "border border-warning bg-warning-soft px-2.5 py-2 text-[12px] leading-5 text-warning";

const ROW_KEYS = ["mediaRowTop", "mediaRowMiddle", "mediaRowBottom"] as const;
const COL_KEYS = ["mediaColLeft", "mediaColCenter", "mediaColRight"] as const;

export function GlobalBackgroundField({
  config,
  onReplace,
  t,
  locale,
}: {
  config: Config;
  /** A whole config: removing `background` cannot be expressed as a partial patch. */
  onReplace: (next: Config) => void;
  t: T;
  locale: "ar" | "en";
}) {
  const dir = locale === "en" ? "ltr" : "rtl";
  const ctx: DesignContext = {
    primaryColor: config.primaryColor,
    accentColor: config.accentColor,
    palette: config.palette,
    dir,
  };
  // «Image» has nothing to store until a picture is picked, so choosing the tab is UI state. It is tied to the
  // `background` it was chosen over (by identity): any real change to the document — an undo, a pick — ends it.
  const [pendingOver, setPendingOver] = useState<{ background: Config["background"] } | null>(null);
  const pendingImage = pendingOver !== null && pendingOver.background === config.background;
  const type: BackgroundType = pendingImage ? "media" : backgroundType(config);
  const legendId = useId();
  const resetHintId = useId();

  const replace = (next: Config) => {
    if (next !== config) onReplace(next);
  };
  const chooseType = (next: BackgroundType) => {
    if (next === type) return;
    if (next === "media") {
      setPendingOver({ background: config.background });
      return;
    }
    setPendingOver(null);
    replace(switchBackgroundType(config, next));
  };
  const editMedia = (edit: MediaBackgroundEdit) => {
    const next = setMediaBackground(config, edit);
    // Clearing the main image falls back to the legacy colour but keeps the Image tab open for a new pick.
    setPendingOver(next.background ? null : { background: next.background });
    replace(next);
  };
  const reset = () => {
    setPendingOver(null);
    replace(resetBackground(config));
  };

  const mediaBg = config.background?.kind === "media" ? config.background : null;
  const gradient = config.background?.kind === "gradient" ? config.background : null;
  // The pictures of the global background need proven pixel bounds (the numbers the publish gate uses) — read-only.
  const globalRefs = mediaBg ? [mediaBg.media, ...(mediaBg.mobile ? [mediaBg.mobile] : [])] : [];
  const bounds = useBackgroundMediaBounds([], globalRefs);
  const animated = useAnyAnimated(globalRefs);

  return (
    <fieldset className="min-w-0 space-y-3" data-global-background="" aria-labelledby={legendId}>
      <legend id={legendId} className="text-[12px] font-medium text-muted">
        {t("storeBackground")}
      </legend>
      <p className="text-[12px] leading-5 text-muted">{t("storeBackgroundHint")}</p>

      <div role="group" aria-label={t("storeBackgroundType")}>
        <Segmented<BackgroundType>
          value={type}
          onChange={chooseType}
          options={[
            { id: "solid", label: t("storeBackgroundSolid") },
            { id: "gradient", label: t("storeBackgroundGradient") },
            { id: "media", label: t("storeBackgroundImage") },
          ]}
        />
      </div>

      {type === "solid" ? (
        <SolidColour hex={effectiveSolidHex(config)} onCommit={(hex) => replace(setSolidColor(config, hex))} t={t} />
      ) : null}

      {type === "gradient" && gradient ? (
        <div className="space-y-3" data-global-bg-panel="gradient">
          <ColourField
            dataName="global-bg-from"
            label={t("designGradFrom")}
            value={gradient.from}
            ctx={ctx}
            t={t}
            clearable={false}
            onChange={(from) => from && replace(setGradient(config, { from }))}
          />
          <ColourField
            dataName="global-bg-to"
            label={t("designGradTo")}
            value={gradient.to}
            ctx={ctx}
            t={t}
            clearable={false}
            onChange={(to) => to && replace(setGradient(config, { to }))}
          />
          <Field label={t("designGradDirection")}>
            <select
              className={selectClass}
              data-global-bg-direction=""
              value={gradient.direction}
              onChange={(event) =>
                replace(setGradient(config, { direction: event.target.value as (typeof DIRECTIONS)[number] }))
              }
            >
              {DIRECTIONS.map((direction) => (
                <option key={direction} value={direction}>
                  {t(DIRECTION_LABEL[direction])}
                </option>
              ))}
            </select>
          </Field>
          {/* Painted by the same resolver as the canvas and the storefront, so it cannot drift from them. */}
          <div
            role="img"
            aria-label={t("storeBackgroundGradientPreview")}
            data-global-bg-gradient-preview=""
            className="h-10 border border-border"
            style={resolveStorefrontBackgroundStyle(config, dir)}
          />
          <PublishReadiness verdict={globalBackgroundVerdict(config)} blockedKey="storeBackgroundGradientInsufficient" t={t} />
        </div>
      ) : null}

      {type === "media" ? (
        <div className="space-y-3" data-global-bg-panel="image">
          <MediaRefField
            slot="global-background"
            label={t("designBgImageDefault")}
            value={mediaBg?.media ?? null}
            onChange={(media) => editMedia({ media })}
            t={t}
            locale={locale}
            decorativeOnly
            framing={false}
          />
          {mediaBg ? (
            <>
              <FocalGrid
                label={t("storeBackgroundFocalDesktop")}
                value={mediaBg.media.focal}
                onChange={(point) => editMedia({ media: withFocal(mediaBg.media, point) })}
                t={t}
                slot="desktop"
              />
              <MediaRefField
                slot="global-background-phone"
                label={t("designBgImagePhone")}
                hint={t("designBgImagePhoneHint")}
                value={mediaBg.mobile ?? null}
                onChange={(mobile) => editMedia({ mobile })}
                t={t}
                locale={locale}
                decorativeOnly
                framing={false}
              />
              {mediaBg.mobile ? (
                <FocalGrid
                  label={t("storeBackgroundFocalPhone")}
                  value={mediaBg.mobile.focal}
                  onChange={(point) => mediaBg.mobile && editMedia({ mobile: withFocal(mediaBg.mobile, point) })}
                  t={t}
                  slot="phone"
                />
              ) : null}
              <OverlayControls overlay={mediaBg.overlay} onChange={(overlay) => editMedia({ overlay })} ctx={ctx} t={t} />
            </>
          ) : (
            <p role="status" data-global-bg-pending="" className="text-[12px] leading-5 text-muted">
              {t("storeBackgroundImagePending")}
            </p>
          )}
          {mediaBg ? (
            <ImageReadiness
              config={config}
              refs={globalRefs}
              bounds={bounds}
              animated={animated}
              onApplyOverlay={(alpha) => editMedia({ overlay: { color: { role: "surface" }, alpha } })}
              t={t}
            />
          ) : null}
        </div>
      ) : null}

      <div className="space-y-1.5 border-t border-t-border pt-3">
        <button
          type="button"
          className={`${btnClass} disabled:opacity-50`}
          data-global-bg-reset=""
          aria-describedby={resetHintId}
          onClick={reset}
          disabled={isBackgroundDefault(config) && !pendingImage}
        >
          {t("storeBackgroundReset")}
        </button>
        <p id={resetHintId} className="text-[12px] leading-5 text-muted">
          {t("storeBackgroundResetHint")}
        </p>
      </div>
    </fieldset>
  );
}

/** The existing colour picker + HEX box, now committing only a valid HEX (the box keeps the draft while typing). */
function SolidColour({ hex, onCommit, t }: { hex: string; onCommit: (hex: string) => void; t: T }) {
  const [draft, setDraft] = useState(hex);
  useEffect(() => setDraft(hex), [hex]);
  const invalid = draft.trim() !== "" && !isSafeHexColor(draft);
  const errorId = useId();
  return (
    <div className="space-y-1.5" data-global-bg-panel="solid">
      <div className="flex items-stretch gap-2">
        <label className="relative size-10 shrink-0 cursor-pointer overflow-hidden border border-border">
          <span className="absolute inset-0" style={{ background: hex }} />
          <input
            type="color"
            aria-label={t("storeBackground")}
            value={hex}
            onChange={(event) => onCommit(event.target.value)}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>
        <input
          aria-label={t("storeBackground")}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          dir="ltr"
          className={`${inputClass} font-mono uppercase tracking-wide`}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            if (isSafeHexColor(event.target.value)) onCommit(event.target.value);
          }}
        />
      </div>
      {invalid ? (
        <p id={errorId} role="alert" className="text-[12px] leading-5 text-negative">
          {t("storeBackgroundHexInvalid")}
        </p>
      ) : null}
    </div>
  );
}

function OverlayControls({
  overlay,
  onChange,
  ctx,
  t,
}: {
  overlay: MediaOverlay | undefined;
  onChange: (next: MediaOverlay | null) => void;
  ctx: DesignContext;
  t: T;
}) {
  return (
    <>
      <Field label={t("designOverlayStrength")}>
        <select
          className={selectClass}
          data-global-bg-overlay-alpha=""
          value={overlay?.alpha ?? 0}
          onChange={(event) => {
            const alpha = Number(event.target.value);
            onChange(
              alpha === 0 ? null : { color: overlay?.color ?? { role: "overlay" }, alpha: alpha as MediaOverlay["alpha"] },
            );
          }}
        >
          <option value={0}>{t("designOverlayNone")}</option>
          {OVERLAY_ALPHAS.map((alpha) => (
            <option key={alpha} value={alpha}>
              {alpha}%
            </option>
          ))}
        </select>
      </Field>
      {overlay ? (
        <ColourField
          dataName="global-bg-overlay-color"
          label={t("designOverlayColour")}
          value={overlay.color}
          ctx={ctx}
          t={t}
          clearable={false}
          onChange={(color) => color && onChange({ color, alpha: overlay.alpha })}
        />
      ) : null}
    </>
  );
}

/** 3×3 focal point for one picture — the same snap grid as the framing editor, without its crop/rotate (the global layer paints only focal). */
function FocalGrid({
  label,
  value,
  onChange,
  t,
  slot,
}: {
  label: string;
  value: MediaRef["focal"];
  onChange: (point: { x: number; y: number }) => void;
  t: T;
  slot: "desktop" | "phone";
}) {
  const current = value ?? { x: 50, y: 50 };
  return (
    <fieldset className="space-y-1.5" data-global-bg-focal={slot}>
      <legend className="mb-1 text-[12px] font-medium text-muted">{label}</legend>
      {/* Focal x/y are physical image coordinates (object-position), so the grid stays left-to-right in an RTL page:
          the «right» cell must sit on the right, where the picture's right edge is. */}
      <div dir="ltr" className="grid w-fit grid-cols-3 gap-1" data-global-bg-focal-grid="">
        {FOCAL_SNAPS.map(([x, y], index) => {
          const active = current.x === x && current.y === y;
          return (
            <button
              key={`${x}-${y}`}
              type="button"
              aria-pressed={active}
              aria-label={`${label}: ${t(ROW_KEYS[Math.floor(index / 3)])} ${t(COL_KEYS[index % 3])}`}
              onClick={() => onChange({ x, y })}
              className={`flex size-9 items-center justify-center border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                active ? "border-primary bg-primary-soft" : "border-border bg-surface hover:bg-background"
              }`}
            >
              <span aria-hidden="true" className={`size-2 rounded-full ${active ? "bg-primary" : "bg-border"}`} />
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
