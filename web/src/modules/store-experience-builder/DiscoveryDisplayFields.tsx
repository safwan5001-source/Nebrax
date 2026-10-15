"use client";

/**
 * AWJ-VD-H1 / VD-4c — the discovery section's display controls (the optional keys of the VD-4a contract) and their
 * live preview.
 *
 * Every control follows one rule (D-08 + VD-4a): **a key is written only when the merchant sets it**. Each control
 * therefore shows its *effective* value and where that comes from — explicit, the template, or the system default —
 * and a "reset to inherited" action that deletes the key. Choosing a template writes only its id. `shape`, `size` and
 * `showLabel` are different in kind: set explicitly they override every value's own look in the section, so they default
 * to "don't force" and carry a warning once set.
 *
 * The panel owns no state of its own about the document: it edits an options object through the pure helpers of
 * `discovery-display-edit.ts` (which route every change through the builder's section normalizer) and reports the
 * result to the caller.
 */

import {
  ChevronDown,
  GalleryHorizontal,
  Grid3x3,
  GalleryVertical,
  Info,
  List,
  RotateCcw,
  Shapes,
  TriangleAlert,
} from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";
import type { Facet } from "@/modules/commerce-workspace/merchandising/client";
import { DiscoveryPanelPreview } from "./DiscoveryPanelPreview";
import {
  DISCOVERY_DEVICES,
  DISCOVERY_TEMPLATE_ORDER,
  type DiscoveryDevice,
  type DiscoveryDisplayOptions,
  type DiscoveryOptionKey,
  type DiscoverySource,
  discoveryRowsApply,
  discoverySource,
  explicitDiscoveryOptionCount,
  explicitVisualOverrides,
  resetAllDiscoveryOptions,
  resetDiscoveryOption,
  selectDiscoveryTemplate,
  setDiscoveryColumn,
  setDiscoveryOption,
} from "./discovery-display-edit";
import type { CustomizerLocale, CustomizerMessageKey } from "./messages";
import {
  DISCOVERY_DISPLAY_DEFAULTS,
  discoveryTemplateOf,
  resolveDiscoveryDisplay,
} from "./presentation/discovery-templates";
import {
  FACET_VISUAL_DEFAULTS,
  FACET_VISUAL_SHAPES,
  FACET_VISUAL_SHAPE_LABELS,
  FACET_VISUAL_SIZES,
  type FacetVisualShape,
  type FacetVisualSize,
} from "./presentation/facet-visual";
import {
  DISCOVERY_ALIGNS,
  DISCOVERY_CARD_STYLES,
  DISCOVERY_COLUMN_RANGES,
  DISCOVERY_CONTENT_SEQUENCES,
  DISCOVERY_GAPS,
  DISCOVERY_LAYOUTS,
  DISCOVERY_MAX_ITEMS_MAX,
  DISCOVERY_MAX_ITEMS_MIN,
  DISCOVERY_ROWS_MAX,
  DISCOVERY_ROWS_MIN,
  DISCOVERY_TEXT_POSITIONS,
  DISCOVERY_VALUE_SORTS,
  type DiscoveryContent,
  type DiscoveryLayout,
} from "./presentation/section-content";

type T = (key: CustomizerMessageKey) => string;

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";

const LAYOUT_ICONS = {
  "image-grid": Grid3x3,
  "image-cards": GalleryVertical,
  carousel: GalleryHorizontal,
  "icon-grid": Shapes,
  "text-list": List,
} as const satisfies Record<DiscoveryLayout, typeof Grid3x3>;

const SEQUENCE_KEY = {
  "media-first": "ddContentSequence_media",
  "label-first": "ddContentSequence_label",
} as const;

// ── primitives ──────────────────────────────────────────────────────────

function Group({
  title,
  count,
  open,
  onToggle,
  t,
  children,
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  t: T;
  children: ReactNode;
}) {
  const bodyId = useId();
  return (
    <div className="border border-border" data-dd-group="">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onToggle}
        className={cn(
          "flex min-h-11 w-full items-center justify-between gap-2 px-3 text-start text-[13px] font-semibold text-text hover:bg-primary-soft",
          focusRing,
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">{title}</span>
          {count > 0 ? (
            <span
              title={`${t("ddGroupExplicit")}: ${count}`}
              className="inline-flex min-w-5 items-center justify-center bg-primary-soft px-1.5 text-[11px] font-semibold leading-5 text-primary"
            >
              <span aria-hidden="true">{count}</span>
              <span className="sr-only">
                {t("ddGroupExplicit")}: {count}
              </span>
            </span>
          ) : null}
        </span>
        <ChevronDown
          aria-hidden="true"
          strokeWidth={1.6}
          className={cn("size-4 shrink-0 text-muted transition-transform", open && "rotate-180")}
        />
      </button>
      <div id={bodyId} hidden={!open} className="space-y-4 border-t border-border px-3 py-3">
        {children}
      </div>
    </div>
  );
}

/** Where a control's effective value comes from, in words (never colour alone). */
function SourceText({
  source,
  t,
  templateName,
  notForced = false,
}: {
  source: DiscoverySource;
  t: T;
  templateName?: string;
  /** shape / size / label: a non-explicit value is not applied to values at all. */
  notForced?: boolean;
}) {
  let text: string;
  if (source.kind === "explicit") text = t("ddSrcExplicit");
  else if (notForced) text = t("ddSrcNotForced");
  else if (source.kind === "template") text = `${t("ddSrcTemplate")}: ${templateName ?? source.templateId}`;
  else if (source.kind === "legacy") text = t("ddSrcLegacy");
  else text = t("ddSrcSystem");
  return (
    <span
      data-source={source.kind}
      className={cn(
        "text-[11px] leading-4",
        source.kind === "explicit" ? "font-semibold text-primary" : "text-muted",
      )}
    >
      {text}
    </span>
  );
}

/**
 * Keyboard focus after a reset (WCAG 2.4.3). A reset button disappears once its control is back to inherited, which
 * would drop focus to `<body>`; the host moves focus to the control's first remaining control instead.
 */
const FocusAfterReset = createContext<(from: Element | null) => void>(() => undefined);

const FOCUSABLE =
  "button:not([data-dd-reset]):not(:disabled):not([aria-disabled='true']), select:not(:disabled)";

function ResetButton({
  label,
  t,
  visible,
  onReset,
}: {
  label: string;
  t: T;
  visible: boolean;
  onReset: () => void;
}) {
  const refocus = useContext(FocusAfterReset);
  if (!visible) return null;
  return (
    <button
      type="button"
      onClick={(event) => {
        const container = event.currentTarget.closest("[data-dd-control]");
        onReset();
        refocus(container);
      }}
      aria-label={`${label}: ${t("ddReset")}`}
      title={t("ddReset")}
      data-dd-reset=""
      className={cn(
        "inline-flex size-11 shrink-0 items-center justify-center text-muted hover:bg-primary-soft hover:text-primary",
        focusRing,
      )}
    >
      <RotateCcw aria-hidden="true" className="size-4" strokeWidth={1.6} />
    </button>
  );
}

function ControlHead({
  id,
  label,
  source,
  templateName,
  notForced,
  resetVisible,
  onReset,
  t,
}: {
  id: string;
  label: string;
  source: DiscoverySource;
  templateName?: string;
  notForced?: boolean;
  resetVisible: boolean;
  onReset: () => void;
  t: T;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <span id={id} className="block text-[12px] font-medium text-text">
          {label}
        </span>
        <SourceText source={source} t={t} templateName={templateName} notForced={notForced} />
      </div>
      <ResetButton label={label} t={t} visible={resetVisible} onReset={onReset} />
    </div>
  );
}

interface ChoiceOption<V extends string> {
  id: V;
  label: string;
  icon?: typeof Grid3x3;
}

/**
 * Buttons for a short closed list. `explicit` is pressed; `effective` (when nothing is explicit) is marked with a
 * dashed outline and `data-effective`, so the inherited value is visible without pretending it was chosen.
 */
function ChoiceButtons<V extends string>({
  labelledBy,
  options,
  explicit,
  effective,
  onSelect,
  disabled = false,
  columns = options.length,
  leading,
  inheritedText,
}: {
  labelledBy: string;
  options: ReadonlyArray<ChoiceOption<V>>;
  explicit: V | undefined;
  effective: V | undefined;
  onSelect: (id: V) => void;
  disabled?: boolean;
  columns?: number;
  /** An extra first button that means "no explicit value" (pressed while nothing is explicit). */
  leading?: { label: string; onSelect: () => void };
  /** Spoken marker for the inherited (not pressed) option: the dashed outline is visual only. */
  inheritedText: string;
}) {
  return (
    <div
      role="group"
      aria-labelledby={labelledBy}
      className="grid gap-1"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {leading ? (
        <button
          type="button"
          aria-pressed={explicit === undefined}
          disabled={disabled}
          onClick={leading.onSelect}
          className={cn(
            "min-h-11 border px-2 text-[12px] font-medium leading-4 disabled:opacity-50",
            focusRing,
            explicit === undefined
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border text-text hover:bg-primary-soft",
          )}
          style={{ gridColumn: `span ${Math.min(2, columns)}` }}
        >
          {leading.label}
        </button>
      ) : null}
      {options.map(({ id, label, icon: Icon }) => {
        const pressed = explicit === id;
        const inherited = explicit === undefined && effective === id;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={pressed}
            // The dashed outline is visual only: the inherited state is spoken too (the name still contains the label).
            aria-label={inherited ? `${label} ${inheritedText}` : undefined}
            data-effective={inherited ? "inherited" : undefined}
            disabled={disabled}
            onClick={() => onSelect(id)}
            className={cn(
              "flex min-h-11 flex-col items-center justify-center gap-1 border px-1.5 py-1 text-[12px] font-medium leading-4 disabled:opacity-50",
              focusRing,
              pressed
                ? "border-primary bg-primary text-primary-foreground"
                : inherited
                  ? "border-dashed border-primary text-primary hover:bg-primary-soft"
                  : "border-border text-text hover:bg-primary-soft",
            )}
          >
            {Icon ? <Icon aria-hidden="true" className="size-4" strokeWidth={1.6} /> : null}
            <span className="break-words text-center">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

const selectClassName = cn(
  "h-11 w-full border border-border bg-surface px-2 text-sm text-text disabled:opacity-50",
  focusRing,
);

/** A number or shape picked from a list: the first option is "inherited (effective value)" and deletes the key. */
function InheritSelect({
  id,
  label,
  value,
  inheritedLabel,
  options,
  onChange,
  disabled = false,
  describedBy,
}: {
  id: string;
  label: string;
  value: string;
  inheritedLabel: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
  disabled?: boolean;
  describedBy?: string;
}) {
  return (
    <select
      id={id}
      aria-label={label}
      aria-describedby={describedBy}
      className={selectClassName}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{inheritedLabel}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function Notice({
  tone,
  children,
  role = "note",
  ...rest
}: {
  tone: "warning" | "info";
  children: ReactNode;
  role?: "note" | "status";
} & Record<`data-${string}`, string>) {
  const Icon = tone === "warning" ? TriangleAlert : Info;
  return (
    <p
      role={role}
      {...rest}
      className={cn(
        "flex items-start gap-2 border px-2.5 py-2 text-[12px] leading-5 text-text",
        tone === "warning" ? "border-warning/40 bg-warning/10" : "border-border bg-primary-soft",
      )}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" strokeWidth={1.6} />
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}

// ── the panel ───────────────────────────────────────────────────────────

export function DiscoveryDisplayFields({
  base,
  options,
  onOptionsChange,
  locale,
  t,
  facets,
  storeVars,
}: {
  /** The four keys the host panel edits; used for the preview and for resolving the effective display. */
  base: Pick<DiscoveryContent, "title" | "axis" | "dimension" | "display">;
  /** The optional display settings, as stored. */
  options: DiscoveryDisplayOptions;
  /** Called with the normalized options after every edit. */
  onOptionsChange: (options: DiscoveryDisplayOptions) => void;
  locale: CustomizerLocale;
  t: T;
  facets: readonly Facet[] | null;
  storeVars?: CSSProperties;
}) {
  const uid = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [refocus, setRefocus] = useState<{ from: Element | null; n: number } | null>(null);
  // After a reset the control's reset button is gone: put focus on the control's first remaining button/select,
  // else on its group header, so it never falls back to <body>.
  useEffect(() => {
    if (!refocus) return;
    const root = rootRef.current;
    const from = refocus.from;
    if (root && from && root.contains(from)) {
      const target =
        from.querySelector<HTMLElement>(FOCUSABLE) ??
        from.closest("[data-dd-group]")?.querySelector<HTMLElement>(":scope > button");
      target?.focus();
    }
    setRefocus(null);
  }, [refocus]);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ layout: true });
  const toggle = (group: string) => setOpenGroups((prev) => ({ ...prev, [group]: !prev[group] }));

  const content: DiscoveryContent = { ...base, ...options };
  const display = resolveDiscoveryDisplay(content);
  const template = discoveryTemplateOf(options.template);
  const templateName = options.template
    ? t(`ddTemplateName_${options.template}` as const)
    : undefined;
  const src = (key: DiscoveryOptionKey, device?: DiscoveryDevice) =>
    discoverySource(options, key, device);
  const has = (key: DiscoveryOptionKey) => options[key] !== undefined;
  const set = onOptionsChange;
  const labelOf = (key: string) => t(key as CustomizerMessageKey);

  const visualOverrides = explicitVisualOverrides(options);
  const rowsApply = discoveryRowsApply(options);

  // Group badges: how many settings the merchant set explicitly in each.
  const countIn = (keys: readonly DiscoveryOptionKey[]) =>
    keys.reduce(
      (sum, key) =>
        sum +
        (key === "columns"
          ? Object.keys(options.columns ?? {}).length
          : has(key)
            ? 1
            : 0),
      0,
    );
  const total = explicitDiscoveryOptionCount(options);
  // Explicit settings that actually override the template: not the template itself, and not a stored `rows` the
  // resolver ignores while the layout is not a carousel.
  const overridingTemplate = total - (has("template") ? 1 : 0) - (has("rows") && !rowsApply ? 1 : 0);

  /** What a value falls back to when it has no look of its own (template, then system) — shown when not forced. */
  const visualFallbackText = (what: "shape" | "size" | "showLabel") => {
    if (has(what)) return null;
    let text: string;
    if (what === "shape") {
      const value = (template?.shape ?? FACET_VISUAL_DEFAULTS.shape) as FacetVisualShape;
      text = FACET_VISUAL_SHAPE_LABELS[value][locale];
    } else if (what === "size") {
      text = labelOf(`ddSize_${(template?.size ?? FACET_VISUAL_DEFAULTS.size) as FacetVisualSize}`);
    } else {
      text = t("ddShow");
    }
    const from =
      what !== "showLabel" && template?.[what] !== undefined
        ? `${t("ddSrcTemplate")}: ${templateName}`
        : t("ddSrcSystem");
    return (
      <span className="block text-[11px] leading-4 text-muted" data-visual-fallback={what}>
        {t("ddVisualFallback")}: {text} ({from})
      </span>
    );
  };

  // ── generic builders ────────────────────────────────────────────────
  const enumControl = <K extends "gap" | "textPosition" | "cardStyle" | "align" | "valueSort" | "contentSequence">(
    key: K,
    list: ReadonlyArray<NonNullable<DiscoveryDisplayOptions[K]>>,
    labelKey: (id: NonNullable<DiscoveryDisplayOptions[K]>) => CustomizerMessageKey,
    effective: NonNullable<DiscoveryDisplayOptions[K]>,
    title: string,
  ) => {
    const id = `${uid}-${key}`;
    return (
      <div className="space-y-1.5" data-dd-control={key}>
        <ControlHead
          id={id}
          label={title}
          source={src(key)}
          templateName={templateName}
          resetVisible={has(key)}
          onReset={() => set(resetDiscoveryOption(options, key))}
          t={t}
        />
        <ChoiceButtons
            inheritedText={t("ddInheritedSr")}
          labelledBy={id}
          options={list.map((value) => ({ id: value, label: t(labelKey(value)) }))}
          explicit={options[key] as NonNullable<DiscoveryDisplayOptions[K]> | undefined}
          effective={effective}
          onSelect={(value) => set(setDiscoveryOption(options, key, value))}
          columns={list.length === 4 ? 2 : list.length}
        />
      </div>
    );
  };

  const boolControl = (key: "showLabel" | "showCounts", title: string, effective: boolean | undefined) => {
    const id = `${uid}-${key}`;
    const explicit = options[key];
    return (
      <div className="space-y-1.5" data-dd-control={key}>
        <ControlHead
          id={id}
          label={title}
          source={src(key)}
          notForced={key === "showLabel"}
          resetVisible={has(key)}
          onReset={() => set(resetDiscoveryOption(options, key))}
          t={t}
        />
        <ChoiceButtons
            inheritedText={t("ddInheritedSr")}
          labelledBy={id}
          options={[
            { id: "show", label: t("ddShow") },
            { id: "hide", label: t("ddHide") },
          ]}
          explicit={explicit === undefined ? undefined : explicit ? "show" : "hide"}
          effective={effective === undefined ? undefined : effective ? "show" : "hide"}
          onSelect={(value) => set(setDiscoveryOption(options, key, value === "show"))}
          columns={2}
        />
        {key === "showLabel" ? visualFallbackText("showLabel") : null}
      </div>
    );
  };

  const numberOptions = (min: number, max: number) =>
    Array.from({ length: max - min + 1 }, (_, i) => ({
      value: String(min + i),
      label: String(min + i),
    }));

  const shapeId = `${uid}-shape`;
  const sizeId = `${uid}-size`;
  const templateId = `${uid}-template`;
  const layoutId = `${uid}-layout`;
  const rowsId = `${uid}-rows`;
  const maxItemsId = `${uid}-maxItems`;
  const rowsNoteId = `${uid}-rows-note`;

  return (
    <FocusAfterReset.Provider value={(from) => setRefocus({ from, n: Date.now() })}>
    <div ref={rootRef} className="space-y-3" data-discovery-display="">
      <div className="space-y-1">
        <h3 className="text-[12px] font-semibold tracking-wide text-muted">{t("ddSectionTitle")}</h3>
        <p className="text-[12px] leading-5 text-muted">{t("ddIntro")}</p>
      </div>

      <DiscoveryPanelPreview
        content={content}
        locale={locale}
        t={t}
        facets={facets}
        storeVars={storeVars}
      />

      {/* ── Layout ─────────────────────────────────────────────── */}
      <Group
        title={t("ddGroupLayout")}
        count={countIn(["template", "layout", "columns", "rows"])}
        open={!!openGroups.layout}
        onToggle={() => toggle("layout")}
        t={t}
      >
        <div className="space-y-1.5" data-dd-control="template">
          <ControlHead
            id={templateId}
            label={t("ddTemplate")}
            source={has("template") ? { kind: "explicit" } : { kind: "system" }}
            resetVisible={has("template")}
            onReset={() => set(selectDiscoveryTemplate(options, undefined))}
            t={t}
          />
          <div role="group" aria-labelledby={templateId} className="grid gap-1">
            <button
              type="button"
              aria-pressed={!has("template")}
              onClick={() => set(selectDiscoveryTemplate(options, undefined))}
              className={cn(
                "min-h-11 border px-2.5 py-1.5 text-start text-[12px] font-medium",
                focusRing,
                !has("template")
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-text hover:bg-primary-soft",
              )}
            >
              {t("ddTemplateNone")}
            </button>
            {DISCOVERY_TEMPLATE_ORDER.map((id) => {
              const pressed = options.template === id;
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={pressed}
                  data-template={id}
                  onClick={() => set(selectDiscoveryTemplate(options, id))}
                  className={cn(
                    "min-h-11 border px-2.5 py-1.5 text-start",
                    focusRing,
                    pressed
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-text hover:bg-primary-soft",
                  )}
                >
                  <span className="block text-[12px] font-semibold leading-4">
                    {labelOf(`ddTemplateName_${id}`)}
                  </span>
                  <span
                    className={cn(
                      "block text-[11px] leading-4",
                      pressed ? "text-primary-foreground" : "text-muted",
                    )}
                  >
                    {labelOf(`ddTemplateDesc_${id}`)}
                  </span>
                </button>
              );
            })}
          </div>
          <span className="block text-[11px] leading-4 text-muted">{t("ddTemplateNote")}</span>
          {has("template") && overridingTemplate > 0 ? (
            <span className="block text-[11px] leading-4 text-muted" data-template-overridden="">
              {t("ddTemplateOverridden")}: {overridingTemplate}
            </span>
          ) : null}
        </div>

        <div className="space-y-1.5" data-dd-control="layout">
          <ControlHead
            id={layoutId}
            label={t("ddLayout")}
            source={src("layout")}
            templateName={templateName}
            resetVisible={has("layout")}
            onReset={() => set(resetDiscoveryOption(options, "layout"))}
            t={t}
          />
          <ChoiceButtons
            inheritedText={t("ddInheritedSr")}
            labelledBy={layoutId}
            options={DISCOVERY_LAYOUTS.map((id) => ({
              id,
              label: labelOf(`ddLayout_${id}`),
              icon: LAYOUT_ICONS[id],
            }))}
            explicit={options.layout}
            effective={display.layout ?? undefined}
            onSelect={(id) => set(setDiscoveryOption(options, "layout", id))}
            columns={2}
            leading={{
              label: template ? t("ddLayoutFromTemplate") : t("ddLayoutLegacy"),
              onSelect: () => set(resetDiscoveryOption(options, "layout")),
            }}
          />
        </div>

        <fieldset className="space-y-1.5" data-dd-control="columns">
          <legend className="text-[12px] font-medium text-text">{t("ddColumns")}</legend>
          {display.layout === "carousel" ? (
            <span className="block text-[11px] leading-4 text-muted" data-columns-carousel-note="">
              {t("ddColumnsCarouselNote")}
            </span>
          ) : null}
          <div className="space-y-2">
            {DISCOVERY_DEVICES.map((device) => {
              const [min, max] = DISCOVERY_COLUMN_RANGES[device];
              const explicit = options.columns?.[device];
              const source = src("columns", device);
              const name = labelOf(`ddDevice_${device}`);
              return (
                <div
                  key={device}
                  className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-2 gap-y-0.5"
                  data-dd-device={device}
                >
                  <span className="text-[12px] text-text">{name}</span>
                  <InheritSelect
                    id={`${uid}-cols-${device}`}
                    label={`${t("ddColumns")}: ${name}`}
                    value={explicit === undefined ? "" : String(explicit)}
                    inheritedLabel={`${t("ddInherited")} (${display.columns[device]})`}
                    options={numberOptions(min, max)}
                    onChange={(value) =>
                      set(setDiscoveryColumn(options, device, value === "" ? undefined : Number(value)))
                    }
                  />
                  <span />
                  <SourceText source={source} t={t} templateName={templateName} />
                </div>
              );
            })}
          </div>
        </fieldset>

        <div className="space-y-1.5" data-dd-control="rows">
          <ControlHead
            id={rowsId}
            label={t("ddRows")}
            source={src("rows")}
            templateName={templateName}
            resetVisible={has("rows")}
            onReset={() => set(resetDiscoveryOption(options, "rows"))}
            t={t}
          />
          <InheritSelect
            id={`${uid}-rows-select`}
            label={t("ddRows")}
            describedBy={rowsApply ? undefined : rowsNoteId}
            value={options.rows === undefined ? "" : String(options.rows)}
            inheritedLabel={`${t("ddInherited")} (${display.rows})`}
            options={numberOptions(DISCOVERY_ROWS_MIN, DISCOVERY_ROWS_MAX)}
            onChange={(value) =>
              set(
                value === ""
                  ? resetDiscoveryOption(options, "rows")
                  : setDiscoveryOption(options, "rows", Number(value)),
              )
            }
            disabled={!rowsApply}
          />
          {rowsApply ? null : (
            <span id={rowsNoteId} className="block text-[11px] leading-4 text-muted" data-rows-note="">
              {t("ddRowsCarouselOnly")}
              {has("rows") ? ` (${t("ddRowsStored")}: ${options.rows})` : ""}
            </span>
          )}
        </div>
      </Group>

      {/* ── Look ───────────────────────────────────────────────── */}
      <Group
        title={t("ddGroupLook")}
        count={countIn(["shape", "size", "showLabel", "cardStyle", "textPosition"])}
        open={!!openGroups.look}
        onToggle={() => toggle("look")}
        t={t}
      >
        <Notice tone="info" data-dd-visual-hint="">
          {t("ddVisualHint")}
        </Notice>
        {visualOverrides.length > 0 ? (
          <Notice tone="warning" data-dd-visual-warning="">
            {t("ddVisualOverrideWarning")}
          </Notice>
        ) : null}

        <div className="space-y-1.5" data-dd-control="shape">
          <ControlHead
            id={shapeId}
            label={t("ddShape")}
            source={src("shape")}
            templateName={templateName}
            notForced
            resetVisible={has("shape")}
            onReset={() => set(resetDiscoveryOption(options, "shape"))}
            t={t}
          />
          <InheritSelect
            id={`${uid}-shape-select`}
            label={t("ddShape")}
            value={options.shape ?? ""}
            inheritedLabel={t("ddShapeNone")}
            options={FACET_VISUAL_SHAPES.map((shape) => ({
              value: shape,
              label: FACET_VISUAL_SHAPE_LABELS[shape][locale],
            }))}
            onChange={(value) =>
              set(
                value === ""
                  ? resetDiscoveryOption(options, "shape")
                  : setDiscoveryOption(options, "shape", value as FacetVisualShape),
              )
            }
          />
          {visualFallbackText("shape")}
        </div>

        <div className="space-y-1.5" data-dd-control="size">
          <ControlHead
            id={sizeId}
            label={t("ddSize")}
            source={src("size")}
            templateName={templateName}
            notForced
            resetVisible={has("size")}
            onReset={() => set(resetDiscoveryOption(options, "size"))}
            t={t}
          />
          <ChoiceButtons
            inheritedText={t("ddInheritedSr")}
            labelledBy={sizeId}
            options={FACET_VISUAL_SIZES.map((size) => ({ id: size, label: labelOf(`ddSize_${size}`) }))}
            explicit={options.size}
            effective={undefined}
            onSelect={(size) => set(setDiscoveryOption(options, "size", size))}
          />
          {visualFallbackText("size")}
        </div>

        {boolControl("showLabel", t("ddShowLabel"), undefined)}

        {enumControl("textPosition", DISCOVERY_TEXT_POSITIONS, (id) => `ddTextPosition_${id}` as const, display.textPosition, t("ddTextPosition"))}
        {enumControl("cardStyle", DISCOVERY_CARD_STYLES, (id) => `ddCardStyle_${id}` as const, display.cardStyle, t("ddCardStyle"))}
      </Group>

      {/* ── Content ────────────────────────────────────────────── */}
      <Group
        title={t("ddGroupContent")}
        count={countIn(["valueSort", "showCounts", "maxItems"])}
        open={!!openGroups.content}
        onToggle={() => toggle("content")}
        t={t}
      >
        {enumControl("valueSort", DISCOVERY_VALUE_SORTS, (id) => `ddValueSort_${id}` as const, display.valueSort, t("ddValueSort"))}
        {boolControl("showCounts", t("ddShowCounts"), display.showCounts)}
        <div className="space-y-1.5" data-dd-control="maxItems">
          <ControlHead
            id={maxItemsId}
            label={t("ddMaxItems")}
            source={src("maxItems")}
            templateName={templateName}
            resetVisible={has("maxItems")}
            onReset={() => set(resetDiscoveryOption(options, "maxItems"))}
            t={t}
          />
          <InheritSelect
            id={`${uid}-maxItems-select`}
            label={t("ddMaxItems")}
            value={options.maxItems === undefined ? "" : String(options.maxItems)}
            inheritedLabel={`${t("ddInherited")} (${DISCOVERY_DISPLAY_DEFAULTS.maxItems})`}
            options={numberOptions(DISCOVERY_MAX_ITEMS_MIN, DISCOVERY_MAX_ITEMS_MAX)}
            onChange={(value) =>
              set(
                value === ""
                  ? resetDiscoveryOption(options, "maxItems")
                  : setDiscoveryOption(options, "maxItems", Number(value)),
              )
            }
          />
        </div>
      </Group>

      {/* ── Advanced ───────────────────────────────────────────── */}
      <Group
        title={t("ddGroupAdvanced")}
        count={countIn(["gap", "align", "contentSequence"])}
        open={!!openGroups.advanced}
        onToggle={() => toggle("advanced")}
        t={t}
      >
        {enumControl("gap", DISCOVERY_GAPS, (id) => `ddGap_${id}` as const, display.gap, t("ddGap"))}
        {enumControl("align", DISCOVERY_ALIGNS, (id) => `ddAlign_${id}` as const, display.align, t("ddAlign"))}
        {enumControl(
          "contentSequence",
          DISCOVERY_CONTENT_SEQUENCES,
          (id) => SEQUENCE_KEY[id],
          display.contentSequence,
          t("ddContentSequence"),
        )}
        <div className="space-y-1.5 border-t border-border pt-3" data-dd-reset-all="">
          <button
            type="button"
            aria-disabled={total === 0}
            onClick={() => {
              if (total === 0) return;
              set(resetAllDiscoveryOptions());
            }}
            className={cn(
              "inline-flex min-h-11 w-full items-center justify-center gap-2 border border-border px-3 text-[12px] font-medium text-text hover:bg-primary-soft aria-disabled:opacity-50",
              focusRing,
            )}
          >
            <RotateCcw aria-hidden="true" className="size-4" strokeWidth={1.6} />
            {t("ddResetAll")}
          </button>
          <span className="block text-[11px] leading-4 text-muted">
            {total === 0 ? t("ddNoneSet") : t("ddResetAllHint")}
          </span>
        </div>
      </Group>
    </div>
    </FocusAfterReset.Provider>
  );
}
