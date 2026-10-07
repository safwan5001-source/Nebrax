"use client";

import { useState } from "react";
import { Field, Segmented, btnClass, selectClass } from "../ControlPanels";
import { MediaRefField } from "../media/MediaRefField";
import type { BackgroundMediaBounds } from "../media/use-background-media-bounds";
import type { CustomizerMessageKey } from "../messages";
import { autoForeground } from "../presentation/contrast-engine";
import {
  ALIGNS,
  BODY_SCALES,
  BORDER_WIDTHS,
  DIRECTIONS,
  HEADING_SCALES,
  HEADING_STYLES,
  HEADING_WEIGHTS,
  LINE_HEIGHTS,
  OVERLAY_ALPHAS,
  RADII,
  REVEALS,
  SECTION_DESIGN_CAPABILITIES,
  SEPARATOR_HEIGHTS,
  SEPARATOR_KINDS,
  SHADOWS,
  STEPS,
  WIDTH_MAXES,
  type ColorRef,
  type DesignGroup,
  type MediaOverlay,
  type SectionBackground,
  type SectionDesign,
} from "../presentation/section-design";
import type { MediaRef } from "../presentation/media-ref";
import {
  type DesignContext,
  PAGE_BACKGROUND,
  SURFACE_OWNING_TYPES,
  effectiveText,
  sectionContrastIssues,
} from "../presentation/section-design-resolve";
import { resolveRoleHex } from "../presentation/palette";
import { ColourField } from "./ColourField";
import { copyDesign, pasteDesign, useDesignClipboard } from "./design-clipboard";
import { commitDesign, setGroup } from "./design-edit";

type T = (key: CustomizerMessageKey) => string;
type TextField = "body" | "heading" | "link";

const DIRECTION_LABEL: Record<(typeof DIRECTIONS)[number], CustomizerMessageKey> = {
  "to-end": "designDirToEnd",
  "to-start": "designDirToStart",
  "to-bottom": "designDirDown",
  "to-top": "designDirUp",
  "to-bottom-end": "designDirDownEnd",
  "to-bottom-start": "designDirDownStart",
  "to-top-end": "designDirUpEnd",
  "to-top-start": "designDirUpStart",
};
const STEP_LABEL: Record<(typeof STEPS)[number], CustomizerMessageKey> = {
  none: "designStepNone",
  xs: "designStepXs",
  sm: "designStepSm",
  md: "designStepMd",
  lg: "designStepLg",
  xl: "designStepXl",
};
const MAX_LABEL: Record<(typeof WIDTH_MAXES)[number], CustomizerMessageKey> = {
  narrow: "designWidthNarrow",
  standard: "designWidthStandard",
  wide: "designWidthWide",
};
const BORDER_LABEL: Record<(typeof BORDER_WIDTHS)[number], CustomizerMessageKey> = {
  none: "designBorderNone",
  hairline: "designBorderHairline",
  medium: "designBorderMedium",
};
const RADIUS_LABEL: Record<(typeof RADII)[number], CustomizerMessageKey> = {
  none: "designRadiusNone",
  sm: "designRadiusSm",
  md: "designRadiusMd",
  lg: "designRadiusLg",
  pill: "designRadiusPill",
};
const SHADOW_LABEL: Record<(typeof SHADOWS)[number], CustomizerMessageKey> = {
  none: "designShadowNone",
  soft: "designShadowSoft",
  medium: "designShadowMedium",
  strong: "designShadowStrong",
};
const SEPARATOR_LABEL: Record<(typeof SEPARATOR_KINDS)[number], CustomizerMessageKey> = {
  none: "designStepNone",
  line: "designSepLine",
  band: "designSepBand",
  wave: "designSepWave",
  angle: "designSepAngle",
  curve: "designSepCurve",
};
const SEPARATOR_HEIGHT_LABEL: Record<(typeof SEPARATOR_HEIGHTS)[number], CustomizerMessageKey> = {
  sm: "designStepSm",
  md: "designStepMd",
  lg: "designStepLg",
};
const ALIGN_LABEL: Record<(typeof ALIGNS)[number], CustomizerMessageKey> = {
  start: "designAlignStart",
  center: "designAlignCenter",
  end: "designAlignEnd",
};

const SCALE_LABEL: Record<string, CustomizerMessageKey> = {
  sm: "designScaleSm",
  md: "designScaleMd",
  lg: "designScaleLg",
  xl: "designScaleXl",
};
const WEIGHT_LABEL: Record<number, CustomizerMessageKey> = {
  400: "designWeight400",
  500: "designWeight500",
  700: "designWeight700",
  800: "designWeight800",
};
const LH_LABEL: Record<string, CustomizerMessageKey> = {
  tight: "designLhTight",
  normal: "designLhNormal",
  relaxed: "designLhRelaxed",
};
const HSTYLE_LABEL: Record<string, CustomizerMessageKey> = {
  bar: "designHsBar",
  plain: "designHsPlain",
  centered: "designHsCentered",
  underline: "designHsUnderline",
};

function allows(allowance: true | readonly string[] | undefined, field: string): boolean {
  return allowance === true || (Array.isArray(allowance) && allowance.includes(field));
}

/**
 * CUST-HV V5d — the Design tab of a section. It offers exactly the groups the
 * section's type declares (V0 §3.4) **and** the renderer supports today (typography
 * arrives with V5e), edits through the contract normaliser, and shows the same
 * contrast verdict the publish gate will apply (V0 §4.5.6 — one algorithm).
 */
export function DesignInspector({
  type,
  design,
  ctx,
  t,
  onChange,
  locale = "ar",
  bounds,
}: {
  type: string;
  design: SectionDesign | undefined;
  ctx: DesignContext;
  t: T;
  onChange: (next: SectionDesign | undefined) => void;
  locale?: "ar" | "en";
  /** V6b-4b — why a picture is (not yet) provable: still measuring vs. no valid measurement. */
  bounds?: BackgroundMediaBounds;
}) {
  const capability = SECTION_DESIGN_CAPABILITIES[type];
  const clipboard = useDesignClipboard();
  const [confirmReset, setConfirmReset] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // "Picture" was chosen but none is picked yet: a picture background without a picture does not
  // exist in the document (the contract drops it), so the choice lives here until one is selected.
  const [pendingImage, setPendingImage] = useState(false);
  const current = design ?? {};

  if (!capability) {
    return (
      <p data-design-inspector="" className="text-xs leading-relaxed text-muted">
        {t("designNoOptions")}
      </p>
    );
  }

  const issues = sectionContrastIssues(current, ctx, type);
  const text = effectiveText(current, ctx, type);
  const hasBackground = !!current.background;
  const ownsSurface = SURFACE_OWNING_TYPES.has(type) && !hasBackground;
  const activeSeparatorKinds = [current.separator?.top, current.separator?.bottom].filter(
    (kind): kind is Exclude<(typeof SEPARATOR_KINDS)[number], "none"> => !!kind && kind !== "none",
  );
  const hasSeparator = activeSeparatorKinds.length > 0;
  const hasDesignBackground = current.background?.kind === "solid" || current.background?.kind === "gradient";
  // The colour a separator takes when the merchant picks none — exactly the resolver's defaults:
  // a line follows the border role, a band the brand, a shape the page behind it (brand when the section has no designed background, so it is visible). Mixed edges
  // (e.g. a line above and a wave below) have different defaults, so the field says so rather
  // than showing one swatch for both.
  const separatorDefaults = new Set(
    activeSeparatorKinds.map((kind) =>
      kind === "line" ? "border" : kind === "band" || !hasDesignBackground ? "brand" : "page",
    ),
  );
  const separatorAutomatic =
    separatorDefaults.size === 1 && separatorDefaults.has("border")
      ? { hex: resolveRoleHex("border", ctx), label: t("designRoleBorder") }
      : separatorDefaults.size === 1 && separatorDefaults.has("brand")
        ? { hex: resolveRoleHex("brand", ctx), label: t("designRoleBrand") }
        : separatorDefaults.size === 1
          ? { hex: PAGE_BACKGROUND, label: t("designSepAutoColour") }
          : { label: t("designSepAutoMixed") };
  const bleedsBand = current.width?.mode === "full" && current.background?.kind === "solid";
  const set = <K extends DesignGroup>(group: K, value: SectionDesign[K] | undefined) =>
    onChange(setGroup(type, design, group, value));

  // ── background ────────────────────────────────────────────────────────────
  const bgKind: "none" | "solid" | "gradient" | "media" =
    current.background?.kind ?? (pendingImage ? "media" : "none");
  const setBgKind = (kind: "none" | "solid" | "gradient" | "media") => {
    if (kind === "media") {
      if (current.background?.kind === "media") return;
      setPendingImage(true);
      return set("background", undefined);
    }
    setPendingImage(false);
    if (kind === "none") return set("background", undefined);
    if (kind === "solid")
      return set("background", {
        kind: "solid",
        color: current.background?.kind === "solid" ? current.background.color : { role: "brand" },
      });
    set("background", {
      kind: "gradient",
      from: current.background?.kind === "gradient" ? current.background.from : { role: "brand" },
      to: current.background?.kind === "gradient" ? current.background.to : { role: "accent" },
      direction: current.background?.kind === "gradient" ? current.background.direction : "to-end",
    });
  };
  const mediaBg = current.background?.kind === "media" ? current.background : null;
  const setMediaBg = (next: { media?: MediaRef | null; mobile?: MediaRef | null; overlay?: MediaOverlay | null }) => {
    const media = next.media === undefined ? mediaBg?.media : next.media;
    if (!media) {
      setPendingImage(true);
      return set("background", undefined);
    }
    const mobile = next.mobile === undefined ? mediaBg?.mobile : next.mobile;
    const overlay = next.overlay === undefined ? mediaBg?.overlay : next.overlay;
    const background: SectionBackground = {
      kind: "media",
      media,
      ...(mobile ? { mobile } : {}),
      ...(overlay ? { overlay } : {}),
    };
    setPendingImage(false);
    set("background", background);
  };
  const pictureStates = mediaBg
    ? [mediaBg.media, mediaBg.mobile].filter((ref): ref is MediaRef => !!ref).map((ref) => bounds?.stateOf(ref) ?? "unavailable")
    : [];
  const pictureStatus: "checking" | "noEvidence" | "unprovable" | "ok" | null = !mediaBg
    ? null
    : pictureStates.includes("loading")
      ? "checking"
      : pictureStates.includes("unavailable")
        ? "noEvidence"
        : issues.some((issue) => issue.field === "background")
          ? "unprovable"
          : "ok";

  // ── text ──────────────────────────────────────────────────────────────────
  const textField = (field: TextField, label: string) => {
    if (!allows(capability.text, field)) return null;
    const value = current.text?.[field];
    const issue = issues.find((i) => i.field === field);
    const judged = text.judged;
    const suggest = judged ? autoForeground(judged) : null;
    const status = ownsSurface
      ? null
      : issue
        ? { tone: "bad" as const, text: `${t("designContrastFail")} ${issue.ratio.toFixed(1)}:1` }
        : value && judged
          ? { tone: "ok" as const, text: t("designContrastOk") }
          : null;
    return (
      <ColourField
        key={field}
        dataName={`text-${field}`}
        label={label}
        value={value}
        ctx={ctx}
        t={t}
        disabled={ownsSurface}
        automatic={
          field !== "link" && text[field] && !value
            ? { hex: text[field] as string, label: t("designTextAuto") }
            : undefined
        }
        onChange={(next: ColorRef | undefined) =>
          set("text", { ...current.text, [field]: next })
        }
        status={status}
        suggestion={
          status?.tone === "bad" && suggest
            ? {
                label: t("designSuggestForeground"),
                onApply: () =>
                  set("text", { ...current.text, [field]: { hex: suggest } }),
              }
            : null
        }
      />
    );
  };

  const unsetOption = <option value="">{t("designUnset")}</option>;
  const stepSelect = (key: "top" | "bottom" | "inner", label: CustomizerMessageKey) => (
    <Field label={t(label)}>
      <select
        className={selectClass}
        value={current.spacing?.[key] ?? ""}
        onChange={(event) =>
          set("spacing", {
            ...current.spacing,
            [key]: (event.target.value || undefined) as (typeof STEPS)[number] | undefined,
          })
        }
      >
        {unsetOption}
        {STEPS.map((step) => (
          <option key={step} value={step}>
            {t(STEP_LABEL[step])}
          </option>
        ))}
      </select>
    </Field>
  );

  // ── typography (named steps only) ───────────────────────────────────────────
  const typoSelect = <V extends string | number>(
    field: keyof NonNullable<SectionDesign["typography"]>,
    label: CustomizerMessageKey,
    options: readonly V[],
    optionLabel: (value: V) => string,
  ) => {
    if (!allows(capability.typography, field)) return null;
    const value = current.typography?.[field] as V | undefined;
    return (
      <Field key={field} label={t(label)}>
        <select
          className={selectClass}
          value={value === undefined ? "" : String(value)}
          onChange={(event) => {
            const raw = event.target.value;
            const next = raw === "" ? undefined : (options.find((o) => String(o) === raw) as V);
            set("typography", { ...current.typography, [field]: next });
          }}
        >
          {unsetOption}
          {options.map((option) => (
            <option key={String(option)} value={String(option)}>
              {optionLabel(option)}
            </option>
          ))}
        </select>
      </Field>
    );
  };

  const backgroundIssue = issues.find((i) => i.field === "background");
  const canBleed = !!capability.width && current.background?.kind === "solid";

  return (
    <div data-design-inspector={type} className="space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            data-design-copy=""
            disabled={!design}
            onClick={() => {
              if (copyDesign(type, design)) setNotice(t("designCopied"));
            }}
            className={`${btnClass} disabled:opacity-50`}
          >
            {t("designCopy")}
          </button>
          <button
            type="button"
            data-design-paste=""
            disabled={!clipboard}
            onClick={() => {
              const next = pasteDesign(type);
              if (!next) return setNotice(t("designPasteNothing"));
              onChange(commitDesign(type, next));
              setNotice(t("designPasted"));
            }}
            className={`${btnClass} disabled:opacity-50`}
          >
            {t("designPaste")}
          </button>
          {confirmReset ? (
            <>
              <button
                type="button"
                data-design-reset-confirm=""
                onClick={() => {
                  onChange(undefined);
                  setConfirmReset(false);
                  setNotice(t("designResetDone"));
                }}
                className={`${btnClass} border-negative text-negative`}
              >
                {t("designResetConfirm")}
              </button>
              <button type="button" onClick={() => setConfirmReset(false)} className={btnClass}>
                {t("designResetCancel")}
              </button>
            </>
          ) : (
            <button
              type="button"
              data-design-reset=""
              disabled={!design}
              onClick={() => setConfirmReset(true)}
              className={`${btnClass} disabled:opacity-50`}
            >
              {t("designReset")}
            </button>
          )}
        </div>
        <p role="status" aria-live="polite" className="min-h-4 text-[12px] text-muted">
          {notice}
        </p>
      </div>

      {capability.background ? (
        <fieldset className="min-w-0 space-y-3">
          <legend className="mb-1 text-[12px] font-semibold tracking-wide text-muted">
            {t("designBackground")}
          </legend>
          <Segmented
            value={bgKind}
            onChange={setBgKind}
            options={[
              { id: "none", label: t("designBgNone") },
              { id: "solid", label: t("designBgSolid") },
              { id: "gradient", label: t("designBgGradient") },
              ...(allows(capability.background, "media") ? [{ id: "media" as const, label: t("designBgImage") }] : []),
            ]}
          />
          {current.background?.kind === "solid" ? (
            <ColourField
              dataName="bg-color"
              label={t("designColour")}
              value={current.background.color}
              ctx={ctx}
              t={t}
              clearable={false}
              onChange={(color) =>
                color && set("background", { kind: "solid", color })
              }
            />
          ) : null}
          {current.background?.kind === "gradient" ? (
            <>
              <ColourField
                dataName="bg-from"
                label={t("designGradFrom")}
                value={current.background.from}
                ctx={ctx}
                t={t}
                clearable={false}
                onChange={(from) =>
                  from && current.background?.kind === "gradient" &&
                  set("background", { ...current.background, from })
                }
              />
              <ColourField
                dataName="bg-to"
                label={t("designGradTo")}
                value={current.background.to}
                ctx={ctx}
                t={t}
                clearable={false}
                onChange={(to) =>
                  to && current.background?.kind === "gradient" &&
                  set("background", { ...current.background, to })
                }
                status={
                  backgroundIssue
                    ? { tone: "bad", text: t("designContrastUnprovable") }
                    : null
                }
              />
              <Field label={t("designGradDirection")}>
                <select
                  className={selectClass}
                  value={current.background.direction}
                  onChange={(event) =>
                    current.background?.kind === "gradient" &&
                    set("background", {
                      ...current.background,
                      direction: event.target.value as (typeof DIRECTIONS)[number],
                    })
                  }
                >
                  {DIRECTIONS.map((direction) => (
                    <option key={direction} value={direction}>
                      {t(DIRECTION_LABEL[direction])}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          ) : null}
          {bgKind === "media" ? (
            <div data-design-picture="" className="space-y-3">
              <MediaRefField
                slot="section-background"
                label={t("designBgImageDefault")}
                value={mediaBg?.media ?? null}
                onChange={(media) => setMediaBg({ media })}
                t={t}
                locale={locale}
                decorativeOnly
              />
              {mediaBg ? (
                <>
                  <MediaRefField
                    slot="section-background-phone"
                    label={t("designBgImagePhone")}
                    hint={t("designBgImagePhoneHint")}
                    value={mediaBg.mobile ?? null}
                    onChange={(mobile) => setMediaBg({ mobile })}
                    t={t}
                    locale={locale}
                    decorativeOnly
                  />
                  <Field label={t("designOverlayStrength")}>
                    <select
                      className={selectClass}
                      data-design-overlay-alpha=""
                      value={mediaBg.overlay?.alpha ?? 0}
                      onChange={(event) => {
                        const alpha = Number(event.target.value);
                        setMediaBg({
                          overlay:
                            alpha === 0
                              ? null
                              : { color: mediaBg.overlay?.color ?? { role: "overlay" }, alpha: alpha as MediaOverlay["alpha"] },
                        });
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
                  {mediaBg.overlay ? (
                    <ColourField
                      dataName="overlay-color"
                      label={t("designOverlayColour")}
                      value={mediaBg.overlay.color}
                      ctx={ctx}
                      t={t}
                      clearable={false}
                      onChange={(color) =>
                        color && mediaBg.overlay && setMediaBg({ overlay: { color, alpha: mediaBg.overlay.alpha } })
                      }
                    />
                  ) : null}
                  <p
                    data-picture-status={pictureStatus ?? undefined}
                    role={pictureStatus === "ok" || pictureStatus === "checking" ? "status" : "alert"}
                    className={`flex flex-wrap items-center gap-2 text-[12px] leading-5 ${
                      pictureStatus === "ok" ? "text-positive" : pictureStatus === "checking" ? "text-muted" : "text-negative"
                    }`}
                  >
                    <span>
                      {pictureStatus === "ok"
                        ? t("designPictureOk")
                        : pictureStatus === "checking"
                          ? t("designPictureChecking")
                          : pictureStatus === "noEvidence"
                            ? t("designPictureNoEvidence")
                            : t("designPictureUnprovable")}
                    </span>
                    {pictureStatus === "unprovable" && (mediaBg.overlay?.alpha ?? 0) < 90 ? (
                      <button
                        type="button"
                        data-design-overlay-darker=""
                        className="border border-border bg-surface px-2 py-0.5 text-[12px] font-medium text-text hover:bg-background"
                        onClick={() =>
                          setMediaBg({
                            overlay: {
                              color: mediaBg.overlay?.color ?? { role: "overlay" },
                              alpha: Math.min(90, (mediaBg.overlay?.alpha ?? 20) + 20) as MediaOverlay["alpha"],
                            },
                          })
                        }
                      >
                        {t("designPictureDarker")}
                      </button>
                    ) : null}
                  </p>
                </>
              ) : null}
            </div>
          ) : null}
        </fieldset>
      ) : null}

      {capability.text ? (
        <fieldset className="min-w-0 space-y-3">
          <legend className="mb-1 text-[12px] font-semibold tracking-wide text-muted">
            {t("designText")}
          </legend>
          {ownsSurface ? (
            <p data-design-needs-background="" className="text-[12px] leading-5 text-muted">
              {t("designTextNeedsBackground")}
            </p>
          ) : null}
          {textField("body", t("designTextBody"))}
          {textField("heading", t("designTextHeading"))}
          {textField("link", t("designTextLink"))}
        </fieldset>
      ) : null}

      {allows(capability.text, "align") ? (
        <Field label={t("designAlign")}>
          <Segmented
            value={current.text?.align ?? "unset"}
            onChange={(id) =>
              set("text", { ...current.text, align: id === "unset" ? undefined : id })
            }
            options={[
              { id: "unset", label: t("designUnset") },
              ...ALIGNS.map((a) => ({ id: a, label: t(ALIGN_LABEL[a]) })),
            ]}
          />
        </Field>
      ) : null}

      {capability.align ? (
        <Field label={t("designBlockAlign")}>
          <Segmented
            value={current.align ?? "unset"}
            onChange={(id) => set("align", id === "unset" ? undefined : id)}
            options={[
              { id: "unset", label: t("designUnset") },
              ...ALIGNS.map((a) => ({ id: a, label: t(ALIGN_LABEL[a]) })),
            ]}
          />
        </Field>
      ) : null}

      {capability.typography ? (
        <fieldset className="min-w-0 space-y-3">
          <legend className="mb-1 text-[12px] font-semibold tracking-wide text-muted">
            {t("designTypography")}
          </legend>
          {typoSelect("headingScale", "designHeadingScale", HEADING_SCALES, (v) => t(SCALE_LABEL[v]))}
          {typoSelect("bodyScale", "designBodyScale", BODY_SCALES, (v) => t(SCALE_LABEL[v]))}
          {typoSelect("headingWeight", "designHeadingWeight", HEADING_WEIGHTS, (v) => t(WEIGHT_LABEL[v]))}
          {typoSelect("lineHeight", "designLineHeight", LINE_HEIGHTS, (v) => t(LH_LABEL[v]))}
          {typoSelect("headingStyle", "designHeadingStyle", HEADING_STYLES, (v) => t(HSTYLE_LABEL[v]))}
        </fieldset>
      ) : null}

      {capability.spacing ? (
        <fieldset className="min-w-0 space-y-3">
          <legend className="mb-1 text-[12px] font-semibold tracking-wide text-muted">
            {t("designSpacing")}
          </legend>
          {stepSelect("top", "designSpacingTop")}
          {stepSelect("bottom", "designSpacingBottom")}
          {stepSelect("inner", "designSpacingInner")}
        </fieldset>
      ) : null}

      {capability.width ? (
        <fieldset className="min-w-0 space-y-3">
          <legend className="mb-1 text-[12px] font-semibold tracking-wide text-muted">
            {t("designWidth")}
          </legend>
          <Field label={t("designWidthMax")}>
            <select
              className={selectClass}
              value={current.width?.max ?? ""}
              onChange={(event) =>
                set("width", {
                  ...current.width,
                  max: (event.target.value || undefined) as (typeof WIDTH_MAXES)[number] | undefined,
                })
              }
            >
              {unsetOption}
              {WIDTH_MAXES.map((max) => (
                <option key={max} value={max}>
                  {t(MAX_LABEL[max])}
                </option>
              ))}
            </select>
          </Field>
          {canBleed && allows(capability.width, "mode") ? (
            <label className="flex items-center gap-2 text-[12px] text-text">
              <input
                type="checkbox"
                data-design-bleed=""
                checked={current.width?.mode === "full"}
                onChange={(event) =>
                  set("width", {
                    ...current.width,
                    mode: event.target.checked ? "full" : undefined,
                  })
                }
              />
              <span>{t("designWidthFull")}</span>
            </label>
          ) : null}
        </fieldset>
      ) : null}

      {capability.border ? (
        <fieldset className="min-w-0 space-y-3">
          <legend className="mb-1 text-[12px] font-semibold tracking-wide text-muted">
            {t("designBorder")}
          </legend>
          <Segmented
            value={current.border?.width ?? "unset"}
            onChange={(width) =>
              set(
                "border",
                width === "unset"
                  ? undefined
                  : { ...current.border, width, ...(width === "none" ? { color: undefined } : {}) },
              )
            }
            options={[
              { id: "unset", label: t("designUnset") },
              ...BORDER_WIDTHS.map((w) => ({ id: w, label: t(BORDER_LABEL[w]) })),
            ]}
          />
          {current.border && current.border.width !== "none" ? (
            <ColourField
              dataName="border-color"
              label={t("designColour")}
              value={current.border.color}
              ctx={ctx}
              t={t}
              automatic={{ hex: resolveRoleHex("border", ctx), label: t("designRoleBorder") }}
              onChange={(color) =>
                current.border && set("border", { ...current.border, color })
              }
            />
          ) : null}
        </fieldset>
      ) : null}

      {capability.radius ? (
        <Field label={t("designRadius")}>
          <select
            className={selectClass}
            value={current.radius ?? ""}
            onChange={(event) =>
              set("radius", (event.target.value || undefined) as (typeof RADII)[number] | undefined)
            }
          >
            {unsetOption}
            {RADII.map((r) => (
              <option key={r} value={r}>
                {t(RADIUS_LABEL[r])}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      {capability.shadow ? (
        <Field label={t("designShadow")}>
          <select
            className={selectClass}
            value={current.shadow ?? ""}
            onChange={(event) =>
              set("shadow", (event.target.value || undefined) as (typeof SHADOWS)[number] | undefined)
            }
          >
            {unsetOption}
            {SHADOWS.map((s) => (
              <option key={s} value={s}>
                {t(SHADOW_LABEL[s])}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      {capability.separator ? (
        <fieldset className="min-w-0 space-y-3" data-design-group="separator">
          <legend className="mb-1 text-[12px] font-semibold tracking-wide text-muted">
            {t("designSeparator")}
          </legend>
          {(["top", "bottom"] as const).map((edge) => (
            <Field key={edge} label={t(edge === "top" ? "designSepTop" : "designSepBottom")}>
              <select
                data-design-field={`separator.${edge}`}
                className={selectClass}
                value={current.separator?.[edge] ?? ""}
                onChange={(event) => {
                  const next = {
                    ...current.separator,
                    [edge]: (event.target.value || undefined) as (typeof SEPARATOR_KINDS)[number] | undefined,
                  };
                  // no active edge left ⇒ drop the whole group: a stranded colour / height would
                  // stay in the saved document, render nothing and have no control to clear it
                  const active = [next.top, next.bottom].some((kind) => kind && kind !== "none");
                  set("separator", active ? next : undefined);
                }}
              >
                {unsetOption}
                {SEPARATOR_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {t(SEPARATOR_LABEL[kind])}
                  </option>
                ))}
              </select>
            </Field>
          ))}
          {hasSeparator ? (
            <>
              <ColourField
                dataName="separator-color"
                label={t("designColour")}
                value={current.separator?.color}
                ctx={ctx}
                t={t}
                automatic={separatorAutomatic}
                onChange={(color) => set("separator", { ...current.separator, color })}
              />
              <Field label={t("designSepHeight")}>
                <select
                  data-design-field="separator.height"
                  className={selectClass}
                  value={current.separator?.height ?? ""}
                  onChange={(event) =>
                    set("separator", {
                      ...current.separator,
                      height: (event.target.value || undefined) as (typeof SEPARATOR_HEIGHTS)[number] | undefined,
                    })
                  }
                >
                  {unsetOption}
                  {SEPARATOR_HEIGHTS.map((size) => (
                    <option key={size} value={size}>
                      {t(SEPARATOR_HEIGHT_LABEL[size])}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          ) : null}
          {bleedsBand && hasSeparator ? (
            <p data-design-sep-bleed="" className="text-[12px] leading-5 text-muted">
              {t("designSepBleedNote")}
            </p>
          ) : null}
        </fieldset>
      ) : null}

      {allows(capability.motion, "reveal") ? (
        <Field label={t("designReveal")}>
          <select
            data-design-field="motion.reveal"
            className={selectClass}
            value={current.motion?.reveal ?? ""}
            onChange={(event) => {
              const reveal = (event.target.value || undefined) as (typeof REVEALS)[number] | undefined;
              set("motion", reveal ? { reveal } : undefined);
            }}
          >
            {unsetOption}
            {REVEALS.map((value) => (
              <option key={value} value={value}>
                {t(value === "none" ? "designStepNone" : "designRevealFadeUp")}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[12px] leading-5 text-muted">{t("designRevealNote")}</p>
        </Field>
      ) : null}
    </div>
  );
}
