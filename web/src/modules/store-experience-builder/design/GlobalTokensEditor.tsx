"use client";

import { Field, btnClass, selectClass } from "../ControlPanels";
import type { CustomizerMessageKey } from "../messages";
import {
  type ButtonContext,
  GLOBAL_BODY_SCALES,
  GLOBAL_BODY_WEIGHTS,
  GLOBAL_BORDER_WIDTHS,
  GLOBAL_BUTTON_COLOURS,
  GLOBAL_BUTTON_HOVERS,
  GLOBAL_BUTTON_SIZES,
  GLOBAL_BUTTON_STYLES,
  GLOBAL_BUTTON_TEXT_CASES,
  GLOBAL_BUTTON_TEXT_WEIGHTS,
  GLOBAL_CONTENT_WIDTHS,
  GLOBAL_DURATIONS,
  GLOBAL_EASINGS,
  GLOBAL_HEADING_SCALES,
  GLOBAL_HEADING_WEIGHTS,
  GLOBAL_LINE_HEIGHTS,
  GLOBAL_RADII,
  GLOBAL_SECTION_HEADINGS,
  GLOBAL_SHADOWS,
  type GlobalTokensDoc,
  buttonContrastIssues,
} from "../presentation/global-tokens";

type T = (key: CustomizerMessageKey) => string;

const SCALE: Record<string, CustomizerMessageKey> = {
  sm: "designScaleSm",
  md: "designScaleMd",
  lg: "designScaleLg",
};
const WEIGHT: Record<number, CustomizerMessageKey> = {
  400: "designWeight400",
  500: "designWeight500",
  700: "designWeight700",
  800: "designWeight800",
};
const LINE_HEIGHT: Record<string, CustomizerMessageKey> = {
  tight: "designLhTight",
  normal: "designLhNormal",
  relaxed: "designLhRelaxed",
};
const HEADING_STYLE: Record<string, CustomizerMessageKey> = {
  bar: "designHsBar",
  plain: "designHsPlain",
  centered: "designHsCentered",
  underline: "designHsUnderline",
};
const RADIUS: Record<string, CustomizerMessageKey> = {
  none: "designRadiusNone",
  sm: "designRadiusSm",
  md: "designRadiusMd",
  lg: "designRadiusLg",
  pill: "designRadiusPill",
};
const BORDER: Record<string, CustomizerMessageKey> = {
  none: "designBorderNone",
  hairline: "designBorderHairline",
  medium: "designBorderMedium",
};
const SHADOW: Record<string, CustomizerMessageKey> = {
  none: "designShadowNone",
  soft: "designShadowSoft",
  medium: "designShadowMedium",
  strong: "designShadowStrong",
};
const WIDTH: Record<string, CustomizerMessageKey> = {
  narrow: "designWidthNarrow",
  standard: "designWidthStandard",
  wide: "designWidthWide",
};
const DURATION: Record<string, CustomizerMessageKey> = {
  instant: "gtDurInstant",
  fast: "gtDurFast",
  base: "gtDurBase",
  slow: "gtDurSlow",
};
const BUTTON_STYLE: Record<string, CustomizerMessageKey> = {
  solid: "gtBtnSolid",
  soft: "gtBtnSoft",
  outline: "gtBtnOutline",
  link: "gtBtnLink",
};
const BUTTON_COLOUR: Record<string, CustomizerMessageKey> = {
  brand: "designRoleBrand",
  accent: "designRoleAccent",
  text: "designRoleText",
};
const BUTTON_HOVER: Record<string, CustomizerMessageKey> = {
  darken: "gtHoverDarken",
  lift: "gtHoverLift",
  underline: "gtHoverUnderline",
  none: "gtHoverNone",
};
const BUTTON_CASE: Record<string, CustomizerMessageKey> = {
  normal: "gtCaseNormal",
  upper: "gtCaseUpper",
};
const EASING: Record<string, CustomizerMessageKey> = {
  standard: "gtEaseStandard",
  emphasized: "gtEaseEmphasized",
};

type GroupKey = keyof GlobalTokensDoc;

/**
 * CUST-HV V5e-2a — the document-level design controls: typography, card surfaces, content
 * width and motion. Every control is a select of NAMED steps (V0 §5.2 — never a pixel input);
 * the empty choice means "as today" and removes the field, so a merchant who never touches
 * this panel keeps a document byte-identical to before.
 */
export function GlobalTokensEditor({
  config,
  t,
  patch,
  colours,
}: {
  config: GlobalTokensDoc;
  t: T;
  patch: (partial: Partial<GlobalTokensDoc>) => void;
  /** The document's palette inputs — lets the editor warn about a button colour the page cannot prove. */
  colours?: ButtonContext;
}) {
  /** Writes one field of one group; an emptied group is removed from the document. */
  const setField = (group: GroupKey, field: string, value: unknown) => {
    const next: Record<string, unknown> = {
      ...((config[group] as Record<string, unknown> | undefined) ?? {}),
    };
    if (value === undefined) delete next[field];
    else next[field] = value;
    patch({ [group]: Object.keys(next).length > 0 ? next : undefined } as Partial<GlobalTokensDoc>);
  };

  const select = <V extends string | number>(
    group: GroupKey,
    field: string,
    label: CustomizerMessageKey,
    options: readonly V[],
    optionLabel: (value: V) => string,
    current: V | undefined,
    toValue: (value: V) => unknown = (value) => value,
  ) => (
    <Field label={t(label)}>
      <select
        data-gt-field={`${group}.${field}`}
        className={selectClass}
        value={current === undefined ? "" : String(current)}
        onChange={(event) => {
          const raw = event.target.value;
          const picked = raw === "" ? undefined : options.find((option) => String(option) === raw);
          setField(group, field, picked === undefined ? undefined : toValue(picked));
        }}
      >
        <option value="">{t("designUnset")}</option>
        {options.map((option) => (
          <option key={String(option)} value={String(option)}>
            {optionLabel(option)}
          </option>
        ))}
      </select>
    </Field>
  );

  /** `typography.buttonText` is a nested object; this writes one of its two fields. */
  const setButtonText = (field: "weight" | "case", value: unknown) => {
    const next: Record<string, unknown> = { ...(config.typography?.buttonText ?? {}) };
    if (value === undefined) delete next[field];
    else next[field] = value;
    setField("typography", "buttonText", Object.keys(next).length > 0 ? next : undefined);
  };

  const ty = config.typography;
  const bt = config.buttons;
  const su = config.surfaces;
  const mo = config.motion;
  const dirty = Boolean(ty || bt || su || config.layout || mo);
  const contrastIssue = colours ? buttonContrastIssues(config, colours).length > 0 : false;

  return (
    <div data-global-tokens="" className="space-y-6">
      <fieldset className="min-w-0 space-y-4">
        <legend className="mb-1 text-[12px] font-semibold tracking-wide text-muted">{t("gtTypography")}</legend>
        {select("typography", "headingScale", "designHeadingScale", GLOBAL_HEADING_SCALES, (v) => t(SCALE[v]), ty?.headingScale)}
        {select("typography", "bodyScale", "designBodyScale", GLOBAL_BODY_SCALES, (v) => t(SCALE[v]), ty?.bodyScale)}
        {select("typography", "headingWeight", "designHeadingWeight", GLOBAL_HEADING_WEIGHTS, (v) => t(WEIGHT[v]), ty?.headingWeight, Number)}
        {select("typography", "bodyWeight", "gtBodyWeight", GLOBAL_BODY_WEIGHTS, (v) => t(WEIGHT[v]), ty?.bodyWeight, Number)}
        {select("typography", "lineHeight", "designLineHeight", GLOBAL_LINE_HEIGHTS, (v) => t(LINE_HEIGHT[v]), ty?.lineHeight)}
        {select("typography", "sectionHeading", "gtSectionHeading", GLOBAL_SECTION_HEADINGS, (v) => t(HEADING_STYLE[v]), ty?.sectionHeading)}
      </fieldset>

      <fieldset className="min-w-0 space-y-4">
        <legend className="mb-1 text-[12px] font-semibold tracking-wide text-muted">{t("gtButtons")}</legend>
        {select("buttons", "style", "gtButtonStyle", GLOBAL_BUTTON_STYLES, (v) => t(BUTTON_STYLE[v]), bt?.style)}
        {select("buttons", "colour", "gtButtonColour", GLOBAL_BUTTON_COLOURS, (v) => t(BUTTON_COLOUR[v]), bt?.colour)}
        {contrastIssue ? (
          <p role="alert" data-gt-button-contrast="" className="text-[12px] leading-5 text-negative">
            {t("gtButtonContrastWarn")}
          </p>
        ) : null}
        {select("buttons", "size", "gtButtonSize", GLOBAL_BUTTON_SIZES, (v) => t(SCALE[v]), bt?.size)}
        {select("buttons", "radius", "gtButtonRadius", GLOBAL_RADII, (v) => t(RADIUS[v]), bt?.radius)}
        {select("buttons", "hover", "gtButtonHover", GLOBAL_BUTTON_HOVERS, (v) => t(BUTTON_HOVER[v]), bt?.hover)}
        <Field label={t("gtButtonTextWeight")}>
          <select
            data-gt-field="typography.buttonText.weight"
            className={selectClass}
            value={ty?.buttonText?.weight === undefined ? "" : String(ty.buttonText.weight)}
            onChange={(event) =>
              setButtonText("weight", event.target.value === "" ? undefined : Number(event.target.value))
            }
          >
            <option value="">{t("designUnset")}</option>
            {GLOBAL_BUTTON_TEXT_WEIGHTS.map((weight) => (
              <option key={weight} value={String(weight)}>
                {t(WEIGHT[weight])}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("gtButtonTextCase")}>
          <select
            data-gt-field="typography.buttonText.case"
            className={selectClass}
            value={ty?.buttonText?.case ?? ""}
            onChange={(event) => setButtonText("case", event.target.value === "" ? undefined : event.target.value)}
          >
            <option value="">{t("designUnset")}</option>
            {GLOBAL_BUTTON_TEXT_CASES.map((value) => (
              <option key={value} value={value}>
                {t(BUTTON_CASE[value])}
              </option>
            ))}
          </select>
        </Field>
        <p className="text-[12px] leading-5 text-muted">{t("gtButtonsNote")}</p>
      </fieldset>

      <fieldset className="min-w-0 space-y-4">
        <legend className="mb-1 text-[12px] font-semibold tracking-wide text-muted">{t("gtSurfaces")}</legend>
        {select("surfaces", "radius", "gtSurfaceRadius", GLOBAL_RADII, (v) => t(RADIUS[v]), su?.radius)}
        {su?.radius ? <p className="text-[12px] leading-5 text-muted">{t("gtRadiusNote")}</p> : null}
        {select("surfaces", "border", "gtSurfaceBorder", GLOBAL_BORDER_WIDTHS, (v) => t(BORDER[v]), su?.border?.width, (width) => ({ width }))}
        {select("surfaces", "shadow", "designShadow", GLOBAL_SHADOWS, (v) => t(SHADOW[v]), su?.shadow)}
      </fieldset>

      <fieldset className="min-w-0 space-y-4">
        <legend className="mb-1 text-[12px] font-semibold tracking-wide text-muted">{t("gtLayout")}</legend>
        {select("layout", "contentWidth", "gtContentWidth", GLOBAL_CONTENT_WIDTHS, (v) => t(WIDTH[v]), config.layout?.contentWidth)}
      </fieldset>

      <fieldset className="min-w-0 space-y-4">
        <legend className="mb-1 text-[12px] font-semibold tracking-wide text-muted">{t("gtMotion")}</legend>
        {select("motion", "duration", "gtMotionDuration", GLOBAL_DURATIONS, (v) => t(DURATION[v]), mo?.duration)}
        {select("motion", "easing", "gtMotionEasing", GLOBAL_EASINGS, (v) => t(EASING[v]), mo?.easing)}
        <p className="text-[12px] leading-5 text-muted">{t("gtMotionNote")}</p>
      </fieldset>

      <button
        type="button"
        data-gt-reset=""
        disabled={!dirty}
        onClick={() =>
          patch({ typography: undefined, buttons: undefined, surfaces: undefined, layout: undefined, motion: undefined })
        }
        className={`${btnClass} disabled:opacity-50`}
      >
        {t("gtReset")}
      </button>
    </div>
  );
}
