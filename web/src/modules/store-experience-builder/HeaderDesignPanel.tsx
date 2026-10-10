"use client";

import { Field, selectClass, btnClass } from "./ControlPanels";
import { ColourField } from "./design/ColourField";
import type { CustomizerMessageKey } from "./messages";
import {
  HEADER_BORDER_WIDTHS,
  HEADER_HEIGHTS,
  HEADER_LAYOUTS,
  HEADER_LOGO_SIZES,
  HEADER_MOBILE_LAYOUTS,
  HEADER_SHADOWS,
  HEADER_STICKY,
  type HeaderDesign,
  headerContrastIssues,
  normalizeHeaderDesign,
  resolveHeaderDesign,
} from "./presentation/header-design";
import type { ColorRef } from "./presentation/section-design";
import type { DesignContext } from "./presentation/section-design-resolve";

const LAYOUT_LABEL: Record<(typeof HEADER_LAYOUTS)[number], CustomizerMessageKey> = {
  standard: "headerLayoutStandard",
  compact: "headerLayoutCompact",
  centered: "headerLayoutCentered",
  "two-row": "headerLayoutTwoRow",
};
const MOBILE_LABEL: Record<(typeof HEADER_MOBILE_LAYOUTS)[number], CustomizerMessageKey> = {
  "logo-centre": "headerMobileCentre",
  "logo-start": "headerMobileStart",
};
const HEIGHT_LABEL: Record<(typeof HEADER_HEIGHTS)[number], CustomizerMessageKey> = {
  compact: "headerHeightCompact",
  standard: "headerHeightStandard",
  tall: "headerHeightTall",
};
const LOGO_LABEL: Record<(typeof HEADER_LOGO_SIZES)[number], CustomizerMessageKey> = {
  sm: "headerLogoSm",
  md: "headerLogoMd",
  lg: "headerLogoLg",
  xl: "headerLogoXl",
};
const STICKY_LABEL: Record<(typeof HEADER_STICKY)[number], CustomizerMessageKey> = {
  always: "headerStickyAlways",
  "on-scroll-up": "headerStickyOnScrollUp",
  off: "headerStickyOff",
};
const BORDER_LABEL: Record<(typeof HEADER_BORDER_WIDTHS)[number], CustomizerMessageKey> = {
  none: "headerBorderNone",
  hairline: "headerBorderHairline",
  medium: "headerBorderMedium",
};
const SHADOW_LABEL: Record<(typeof HEADER_SHADOWS)[number], CustomizerMessageKey> = {
  none: "headerShadowNone",
  soft: "headerShadowSoft",
  medium: "headerShadowMedium",
};

/**
 * CUST-HV V7a — the structural header controls. Every select starts on "Default" (an empty
 * value drops the field), and the document is re-normalised on every change, so the draft can
 * never hold an invalid or empty `header.design` — clearing the last field removes the key and
 * the header renders exactly as it did before.
 */
export function HeaderDesignPanel({
  design,
  ctx,
  t,
  onChange,
}: {
  design: HeaderDesign | undefined;
  ctx: DesignContext;
  t: (key: CustomizerMessageKey) => string;
  onChange: (next: HeaderDesign | undefined) => void;
}) {
  const current = design ?? {};
  const issues = headerContrastIssues(design, ctx);
  const resolved = resolveHeaderDesign(design, ctx);
  const setColour = (key: "text" | "icon", value: ColorRef | undefined) =>
    onChange(normalizeHeaderDesign({ ...current, [key]: value }));
  const colourStatus = (field: "text" | "icon") => {
    const issue = issues.find((i) => i.field === field);
    if (issue)
      return {
        tone: "bad" as const,
        text: `${t("designContrastFail")} ${issue.ratio.toFixed(1)}:1`,
      };
    return current[field] ? { tone: "ok" as const, text: t("designContrastOk") } : null;
  };
  const set = (key: string, value: string | undefined, sub?: string) => {
    const draft: Record<string, unknown> = { ...current };
    if (sub) draft[key] = value ? { [sub]: value } : undefined;
    else draft[key] = value || undefined;
    onChange(normalizeHeaderDesign(draft));
  };

  const select = <K extends string>(
    id: string,
    label: CustomizerMessageKey,
    value: string | undefined,
    options: readonly K[],
    labels: Record<K, CustomizerMessageKey>,
    key: string,
    sub?: string,
  ) => (
    <Field label={t(label)}>
      <select
        className={selectClass}
        data-header-design={id}
        value={value ?? ""}
        onChange={(event) => set(key, event.target.value || undefined, sub)}
      >
        <option value="">{t("headerDesignDefault")}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {t(labels[option])}
          </option>
        ))}
      </select>
    </Field>
  );

  return (
    <div className="space-y-4" data-header-design-panel="">
      <div className="space-y-1">
        <h3 className="text-[12px] font-semibold tracking-wide text-muted">
          {t("headerDesignTitle")}
        </h3>
        <p className="text-[12px] leading-5 text-muted">
          {t("headerDesignHint")}
        </p>
      </div>
      {select("layout", "headerLayout", current.layout, HEADER_LAYOUTS, LAYOUT_LABEL, "layout")}
      {select("mobile-layout", "headerMobileLayout", current.mobileLayout, HEADER_MOBILE_LAYOUTS, MOBILE_LABEL, "mobileLayout")}
      {select("height", "headerHeight", current.height, HEADER_HEIGHTS, HEIGHT_LABEL, "height")}
      {select("logo-size", "headerLogoSize", current.logo?.size, HEADER_LOGO_SIZES, LOGO_LABEL, "logo", "size")}
      <ColourField
        dataName="header-bg"
        label={t("headerSurfaceBackground")}
        value={current.surface?.background}
        ctx={ctx}
        t={t}
        onChange={(background) =>
          onChange(
            normalizeHeaderDesign({
              ...current,
              surface: background ? { background } : undefined,
            }),
          )
        }
      />
      <ColourField
        dataName="header-text"
        label={t("headerTextColour")}
        value={current.text}
        ctx={ctx}
        t={t}
        automatic={
          !current.text && resolved.style?.["--hd-fg"]
            ? { hex: resolved.style["--hd-fg"], label: t("designTextAuto") }
            : undefined
        }
        status={colourStatus("text")}
        suggestion={
          issues.some((i) => i.field === "text")
            ? { label: t("headerColourUseDefault"), onApply: () => setColour("text", undefined) }
            : null
        }
        onChange={(next) => setColour("text", next)}
      />
      <ColourField
        dataName="header-icon"
        label={t("headerIconColour")}
        value={current.icon}
        ctx={ctx}
        t={t}
        status={colourStatus("icon")}
        suggestion={
          issues.some((i) => i.field === "icon")
            ? { label: t("headerColourUseDefault"), onApply: () => setColour("icon", undefined) }
            : null
        }
        onChange={(next) => setColour("icon", next)}
      />
      {select("sticky", "headerSticky", current.sticky, HEADER_STICKY, STICKY_LABEL, "sticky")}
      {select("border", "headerBorder", current.border?.width, HEADER_BORDER_WIDTHS, BORDER_LABEL, "border", "width")}
      {select("shadow", "headerShadow", current.shadow, HEADER_SHADOWS, SHADOW_LABEL, "shadow")}
      {design ? (
        <button
          type="button"
          className={btnClass}
          data-header-design-reset=""
          onClick={() => onChange(undefined)}
        >
          {t("headerDesignReset")}
        </button>
      ) : null}
    </div>
  );
}
