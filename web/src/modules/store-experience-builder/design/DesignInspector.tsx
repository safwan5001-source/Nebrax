"use client";

import { useState } from "react";
import { Field, Segmented, btnClass, selectClass } from "../ControlPanels";
import type { CustomizerMessageKey } from "../messages";
import { autoForeground } from "../presentation/contrast-engine";
import {
  ALIGNS,
  BORDER_WIDTHS,
  DIRECTIONS,
  RADII,
  SECTION_DESIGN_CAPABILITIES,
  SHADOWS,
  STEPS,
  WIDTH_MAXES,
  type ColorRef,
  type DesignGroup,
  type SectionDesign,
} from "../presentation/section-design";
import {
  type DesignContext,
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
const ALIGN_LABEL: Record<(typeof ALIGNS)[number], CustomizerMessageKey> = {
  start: "designAlignStart",
  center: "designAlignCenter",
  end: "designAlignEnd",
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
}: {
  type: string;
  design: SectionDesign | undefined;
  ctx: DesignContext;
  t: T;
  onChange: (next: SectionDesign | undefined) => void;
}) {
  const capability = SECTION_DESIGN_CAPABILITIES[type];
  const clipboard = useDesignClipboard();
  const [confirmReset, setConfirmReset] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
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
  const set = <K extends DesignGroup>(group: K, value: SectionDesign[K] | undefined) =>
    onChange(setGroup(type, design, group, value));

  // ── background ────────────────────────────────────────────────────────────
  const bgKind = current.background?.kind ?? "none";
  const setBgKind = (kind: "none" | "solid" | "gradient") => {
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

  const alignAllowedInText = allows(capability.text, "align");
  const alignValue = alignAllowedInText ? current.text?.align : current.align;
  const setAlign = (value: (typeof ALIGNS)[number] | undefined) =>
    alignAllowedInText
      ? set("text", { ...current.text, align: value })
      : set("align", value);

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

      {capability.text || capability.align ? (
        <Field label={t("designAlign")}>
          <Segmented
            value={alignValue ?? "unset"}
            onChange={(id) => setAlign(id === "unset" ? undefined : id)}
            options={[
              { id: "unset", label: t("designUnset") },
              ...ALIGNS.map((a) => ({ id: a, label: t(ALIGN_LABEL[a]) })),
            ]}
          />
        </Field>
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
    </div>
  );
}
