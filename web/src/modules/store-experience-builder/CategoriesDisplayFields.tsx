"use client";

/**
 * AWJ-STORE-CAT-DESIGN-01 — the categories section's display controls (Design tab): layout, card, image, name and
 * responsive values, plus four ready-made presets.
 *
 * The panel edits the section's `design.display` through the pure helpers of `categories-display-edit.ts` (every change
 * is normalized by the contract's own twin normalizer) and reports a whole next `design` to the caller. It never
 * touches the section's content — category source, order and links are the catalogue's. Every change is an ordinary
 * editor change: the builder's draft/publish boundary, undo/redo and unsaved-state apply, and nothing publishes.
 */

import {
  ChevronDown,
  CircleDot,
  GalleryHorizontal,
  Grid3x3,
  GalleryVertical,
  List,
  RotateCcw,
} from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { cn } from "@/lib/utils";
import {
  type DisplayGroup,
  explicitCount,
  resetGroup,
  resetResponsive,
  sameDisplay,
  setDevice,
  setField,
  setImageHeight,
  setLayout,
} from "./categories-display-edit";
import {
  CATEGORY_DISPLAY_PRESETS,
  type CategoryDisplayPresetId,
  matchingPreset,
  presetById,
} from "./categories-display-presets";
import { setGroup } from "./design/design-edit";
import type { CustomizerMessageKey } from "./messages";
import {
  LAYOUT_DEFAULTS,
  LAYOUT_PLACEMENTS,
  LAYOUT_SHAPES,
  isScrollLayout,
  resolveCategoryDisplay,
  usesColumns,
} from "./presentation/categories-display";
import {
  type CategoryDisplay,
  DISPLAY_CARD_BACKGROUNDS,
  DISPLAY_CARD_BORDER_COLORS,
  DISPLAY_CARD_BORDER_WIDTH_RANGE,
  DISPLAY_CARD_HOVERS,
  DISPLAY_CARD_PADDING_RANGE,
  DISPLAY_CARD_RADIUS_RANGE,
  DISPLAY_CARD_STYLES,
  DISPLAY_COLUMN_RANGES,
  DISPLAY_DEVICES,
  DISPLAY_GAP_RANGE,
  DISPLAY_IMAGE_ASPECTS,
  DISPLAY_IMAGE_FITS,
  DISPLAY_IMAGE_HEIGHT_RANGE,
  DISPLAY_IMAGE_POSITIONS,
  DISPLAY_ITEM_WIDTH_RANGE,
  DISPLAY_LAYOUTS,
  DISPLAY_NAME_BACKGROUNDS,
  DISPLAY_NAME_COLORS,
  DISPLAY_NAME_LINES,
  DISPLAY_NAME_PLACEMENTS,
  DISPLAY_NAME_SIZE_RANGE,
  DISPLAY_NAME_WEIGHTS,
  type DisplayDevice,
  type DisplayLayout,
  type SectionDesign,
} from "./presentation/section-design";

type T = (key: CustomizerMessageKey) => string;

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";

const LAYOUT_ICONS = {
  grid: Grid3x3,
  horizontal_scroll: GalleryHorizontal,
  circles: CircleDot,
  image_tiles: GalleryVertical,
  compact_list: List,
} as const satisfies Record<DisplayLayout, typeof Grid3x3>;

/** Look up a message whose key is assembled from a closed vocabulary (every member exists in both locales). */
const key = (value: string) => value as CustomizerMessageKey;

// ── primitives ──────────────────────────────────────────────────────────

function Group({
  id,
  title,
  count,
  open,
  onToggle,
  t,
  children,
}: {
  id: string;
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  t: T;
  children: ReactNode;
}) {
  const bodyId = useId();
  return (
    <div className="border border-border" data-catd-group={id}>
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
              title={`${t("catdExplicit")}: ${count}`}
              className="inline-flex min-w-5 items-center justify-center bg-primary-soft px-1.5 text-[11px] font-semibold leading-5 text-primary"
            >
              <span aria-hidden="true">{count}</span>
              <span className="sr-only">
                {t("catdExplicit")}: {count}
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

function Label({ id, children }: { id: string; children: ReactNode }) {
  return (
    <span id={id} className="block text-[12px] font-medium text-text">
      {children}
    </span>
  );
}

function Hint({ children, ...rest }: { children: ReactNode } & Record<`data-${string}`, string>) {
  return (
    <p className="text-[11px] leading-4 text-muted" {...rest}>
      {children}
    </p>
  );
}

interface ChoiceOption<V extends string | number> {
  id: V;
  label: string;
  icon?: typeof Grid3x3;
}

/** A short closed list as buttons; `value` is the effective value (explicit or the layout's default). */
function Choice<V extends string | number>({
  labelledBy,
  options,
  value,
  explicit,
  onSelect,
  disabled = false,
  columns,
}: {
  labelledBy: string;
  options: ReadonlyArray<ChoiceOption<V>>;
  value: V;
  /** Whether `value` was set by the merchant (pressed) or is inherited (dashed). */
  explicit: boolean;
  onSelect: (id: V) => void;
  disabled?: boolean;
  columns?: number;
}) {
  return (
    <div
      role="group"
      aria-labelledby={labelledBy}
      className="grid gap-1"
      style={{ gridTemplateColumns: `repeat(${columns ?? options.length}, minmax(0, 1fr))` }}
    >
      {options.map(({ id, label, icon: Icon }) => {
        const selected = value === id;
        return (
          <button
            key={String(id)}
            type="button"
            aria-pressed={selected && explicit}
            data-effective={selected && !explicit ? "inherited" : undefined}
            disabled={disabled}
            onClick={() => onSelect(id)}
            className={cn(
              "flex min-h-11 flex-col items-center justify-center gap-1 border px-1.5 py-1 text-[12px] font-medium leading-4 disabled:opacity-50",
              focusRing,
              selected && explicit
                ? "border-primary bg-primary text-primary-foreground"
                : selected
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

function Switch({
  label,
  checked,
  onChange,
  disabled = false,
  describedBy,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  describedBy?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex min-h-11 w-full items-center justify-between gap-3 border border-border px-3 text-start text-[13px] text-text hover:bg-primary-soft disabled:opacity-50",
        focusRing,
      )}
    >
      <span>{label}</span>
      <span
        aria-hidden="true"
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center border",
          checked ? "border-primary bg-primary" : "border-border bg-surface",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-3.5 transition-[inset-inline-start]",
            checked ? "bg-primary-foreground" : "bg-muted",
          )}
          style={{ insetInlineStart: checked ? "1.125rem" : "0.125rem" }}
        />
      </span>
    </button>
  );
}

/**
 * A bounded whole number: a slider for quick moves plus a number box that commits on blur / Enter (so typing "16" is not
 * clamped to the minimum after the first digit). `value === undefined` is "inherited": the default is shown as the
 * placeholder and the reset button is hidden. The result is always clamped into [min, max].
 */
function NumberControl({
  id,
  label,
  value,
  fallback,
  min,
  max,
  unit,
  onChange,
  resetLabel,
  inheritedText,
}: {
  id: string;
  label: string;
  value: number | undefined;
  fallback: number;
  min: number;
  max: number;
  unit?: string;
  onChange: (next: number | undefined) => void;
  resetLabel: string;
  inheritedText: string;
}) {
  const shown = value ?? fallback;
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (raw: string) => {
    setDraft(null);
    if (raw.trim() === "") return;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    const next = Math.max(min, Math.min(max, Math.round(parsed)));
    onChange(next);
  };
  return (
    <div className="space-y-1" data-catd-control={id}>
      <div className="flex items-center justify-between gap-2">
        <Label id={`${id}-label`}>{label}</Label>
        <div className="flex items-center gap-1">
          <input
            id={id}
            type="number"
            inputMode="numeric"
            aria-labelledby={`${id}-label`}
            min={min}
            max={max}
            step={1}
            value={draft ?? String(shown)}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={(event) => {
              if (draft !== null) commit(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") commit((event.target as HTMLInputElement).value);
            }}
            className={cn(
              "h-9 w-16 border border-border bg-surface px-2 text-center text-sm tabular-nums text-text",
              value === undefined && "text-muted",
              focusRing,
            )}
          />
          {unit ? <span className="text-[11px] text-muted">{unit}</span> : null}
          {value !== undefined ? (
            <button
              type="button"
              data-catd-reset=""
              aria-label={`${label}: ${resetLabel}`}
              title={resetLabel}
              onClick={() => onChange(undefined)}
              className={cn(
                "inline-flex size-9 shrink-0 items-center justify-center text-muted hover:bg-primary-soft hover:text-primary",
                focusRing,
              )}
            >
              <RotateCcw aria-hidden="true" className="size-4" strokeWidth={1.6} />
            </button>
          ) : (
            <span className="text-[11px] text-muted">{inheritedText}</span>
          )}
        </div>
      </div>
      <input
        type="range"
        aria-labelledby={`${id}-label`}
        min={min}
        max={max}
        step={1}
        value={shown}
        onChange={(event) => onChange(Number(event.target.value))}
        className={cn("h-6 w-full accent-primary", focusRing)}
      />
    </div>
  );
}

/** Named, easy starting values for a pixel setting. Each writes the plain pixel number — the contract is unchanged. */
interface Step {
  id: string;
  label: string;
  value: number;
}

/**
 * Easy first, exact on demand: a row of named steps (what most merchants want), and an "advanced" disclosure with the
 * exact bounded pixel control. The advanced part opens by itself when the current value is not one of the steps, so a
 * custom value is never hidden. Nothing here changes what is stored: always a plain bounded integer.
 */
function StepControl({
  id,
  label,
  steps,
  value,
  fallback,
  min,
  max,
  onChange,
  t,
}: {
  id: string;
  label: string;
  steps: readonly Step[];
  value: number | undefined;
  fallback: number;
  min: number;
  max: number;
  onChange: (next: number | undefined) => void;
  t: T;
}) {
  const effective = value ?? fallback;
  const matches = steps.some((step) => step.value === effective);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const showAdvanced = advancedOpen || !matches;
  const bodyId = useId();
  return (
    <div className="space-y-2" data-catd-steps={id}>
      <Label id={`${id}-steps`}>{label}</Label>
      <div role="group" aria-labelledby={`${id}-steps`} className="grid gap-1" style={{ gridTemplateColumns: `repeat(${steps.length > 4 ? 3 : steps.length}, minmax(0, 1fr))` }}>
        {steps.map((step) => {
          const selected = effective === step.value;
          const explicit = value !== undefined;
          return (
            <button
              key={step.id}
              type="button"
              aria-pressed={selected && explicit}
              data-effective={selected && !explicit ? "inherited" : undefined}
              onClick={() => onChange(step.value)}
              className={cn(
                "flex min-h-11 flex-col items-center justify-center border px-1 py-1 text-[12px] font-medium leading-4",
                focusRing,
                selected && explicit
                  ? "border-primary bg-primary text-primary-foreground"
                  : selected
                    ? "border-dashed border-primary text-primary hover:bg-primary-soft"
                    : "border-border text-text hover:bg-primary-soft",
              )}
            >
              <span className="break-words text-center">{step.label}</span>
            </button>
          );
        })}
      </div>
      {!matches ? <Hint data-catd-custom-value="">{`${t("catdCustomValue")}: ${effective} ${t("catdUnitPx")}`}</Hint> : null}
      <button
        type="button"
        aria-expanded={showAdvanced}
        aria-controls={bodyId}
        data-catd-advanced-toggle={id}
        onClick={() => setAdvancedOpen((open) => !open)}
        className={cn("inline-flex min-h-9 items-center gap-1.5 px-1 text-[12px] font-medium text-primary hover:underline", focusRing)}
      >
        <ChevronDown aria-hidden="true" strokeWidth={1.6} className={cn("size-3.5 transition-transform", showAdvanced && "rotate-180")} />
        {t("catdAdvanced")}
      </button>
      <div id={bodyId} hidden={!showAdvanced}>
        <NumberControl
          id={`${id}-exact`}
          label={label}
          value={value}
          fallback={fallback}
          min={min}
          max={max}
          unit={t("catdUnitPx")}
          onChange={onChange}
          resetLabel={t("catdResetDevice")}
          inheritedText={t("catdInherited")}
        />
      </div>
    </div>
  );
}

/** The gap between cards: easy named steps for every device at once, exact per-device pixels under "advanced". */
function GapControl({
  idBase,
  display,
  defaults,
  onChange,
  deviceLabel,
  t,
}: {
  idBase: string;
  display: CategoryDisplay;
  defaults: Record<DisplayDevice, number>;
  onChange: (next: CategoryDisplay | undefined) => void;
  deviceLabel: (id: string | number) => string;
  t: T;
}) {
  const steps: readonly Step[] = [
    { id: "tight", label: t("catdStep_gap_tight"), value: 8 },
    { id: "normal", label: t("catdStep_gap_normal"), value: 12 },
    { id: "loose", label: t("catdStep_gap_loose"), value: 20 },
  ];
  const effective = DISPLAY_DEVICES.map((device) => display.gap?.[device] ?? defaults[device]);
  const uniform = effective.every((value) => value === effective[0]);
  const matched = uniform ? steps.find((step) => step.value === effective[0]) : undefined;
  const explicit = Object.keys(display.gap ?? {}).length > 0;
  const [open, setOpen] = useState(false);
  const showAdvanced = open || !matched;
  const bodyId = useId();
  const setAll = (value: number): CategoryDisplay | undefined => {
    let next: CategoryDisplay | undefined = display;
    for (const device of DISPLAY_DEVICES) next = setDevice(next, "gap", device, value);
    return next;
  };
  return (
    <div className="space-y-2" data-catd-responsive="gap">
      <Label id={`${idBase}-gap-steps`}>{t("catdGap")}</Label>
      <div role="group" aria-labelledby={`${idBase}-gap-steps`} className="grid grid-cols-3 gap-1">
        {steps.map((step) => {
          const selected = matched?.id === step.id;
          return (
            <button
              key={step.id}
              type="button"
              aria-pressed={selected && explicit}
              data-effective={selected && !explicit ? "inherited" : undefined}
              onClick={() => onChange(setAll(step.value))}
              className={cn(
                "flex min-h-11 items-center justify-center border px-1 py-1 text-[12px] font-medium leading-4",
                focusRing,
                selected && explicit
                  ? "border-primary bg-primary text-primary-foreground"
                  : selected
                    ? "border-dashed border-primary text-primary hover:bg-primary-soft"
                    : "border-border text-text hover:bg-primary-soft",
              )}
            >
              {step.label}
            </button>
          );
        })}
      </div>
      {!matched ? <Hint data-catd-custom-value="">{t("catdCustomValue")}</Hint> : null}
      <button
        type="button"
        aria-expanded={showAdvanced}
        aria-controls={bodyId}
        data-catd-advanced-toggle={`${idBase}-gap`}
        onClick={() => setOpen((value) => !value)}
        className={cn("inline-flex min-h-9 items-center gap-1.5 px-1 text-[12px] font-medium text-primary hover:underline", focusRing)}
      >
        <ChevronDown aria-hidden="true" strokeWidth={1.6} className={cn("size-3.5 transition-transform", showAdvanced && "rotate-180")} />
        {t("catdAdvancedPerDevice")}
      </button>
      <fieldset id={bodyId} hidden={!showAdvanced} className="space-y-3">
        {DISPLAY_DEVICES.map((device: DisplayDevice) => (
          <NumberControl
            key={device}
            id={`${idBase}-gap-${device}`}
            label={deviceLabel(device)}
            value={display.gap?.[device]}
            fallback={defaults[device]}
            min={DISPLAY_GAP_RANGE[0]}
            max={DISPLAY_GAP_RANGE[1]}
            unit={t("catdUnitPx")}
            onChange={(next) => onChange(setDevice(display, "gap", device, next))}
            resetLabel={t("catdResetDevice")}
            inheritedText={t("catdInherited")}
          />
        ))}
      </fieldset>
    </div>
  );
}

// ── the panel ───────────────────────────────────────────────────────────

export function CategoriesDisplayFields({
  design,
  onChange,
  t,
}: {
  design: SectionDesign | undefined;
  onChange: (next: SectionDesign | undefined) => void;
  t: T;
}) {
  const display = design?.display;
  const [open, setOpen] = useState<Record<string, boolean>>({ layout: true });
  const [appliedPreset, setAppliedPreset] = useState<CategoryDisplayPresetId | null>(null);
  const idBase = useId();

  const emit = (next: CategoryDisplay | undefined) =>
    onChange(setGroup("categories", design, "display", next));
  const toggle = (group: string) => setOpen((state) => ({ ...state, [group]: !state[group] }));

  const layout = display?.layout;
  const resolved = display ? resolveCategoryDisplay(display) : null;
  const defaults = layout ? LAYOUT_DEFAULTS[layout] : null;
  const matched = matchingPreset(display);
  const dirtyFrom =
    appliedPreset && display && !sameDisplay(presetById(appliedPreset).display, display)
      ? appliedPreset
      : null;

  // Effective values (explicit or the layout's default) — what the controls show.
  const card = display?.card;
  const image = display?.image;
  const name = display?.name;

  const imageShown = resolved?.image.show ?? true;
  const nameForced = !imageShown;
  const placements = layout ? LAYOUT_PLACEMENTS[layout] : [];
  const shapes = layout ? LAYOUT_SHAPES[layout] : [];
  const effShape = resolved?.image.shape;
  const effPlacement = resolved?.name.placement;
  const onBacking = resolved ? resolved.name.background === "scrim" : false;
  const overlay = effPlacement === "overlay";
  const effCardStyle = resolved?.card.style;
  const effBorderWidth =
    card?.borderWidth ?? (effCardStyle === "border" ? 1 : 0);

  const customHeightDevices = DISPLAY_DEVICES.filter((device) => image?.height?.[device] !== undefined);
  const heightCustom = customHeightDevices.length > 0;

  const choiceLabel = (prefix: string) => (id: string | number) => t(key(`${prefix}_${id}`));
  const deviceLabel = choiceLabel("catdDevice");

  const status = !display
    ? t("catdStatusClassic")
    : matched
      ? `${t("catdStatusPreset")}: ${t(key(`catdPreset_${matched}`))}`
      : dirtyFrom
        ? `${t("catdStatusDirty")}: ${t(key(`catdPreset_${dirtyFrom}`))}`
        : t("catdStatusCustom");

  const groupReset = (group: DisplayGroup, count: number) =>
    count > 0 ? (
      <button
        type="button"
        data-catd-group-reset={group}
        onClick={() => emit(resetGroup(display, group))}
        className={cn(
          "inline-flex min-h-9 items-center gap-1.5 border border-border px-2 text-[12px] text-muted hover:bg-primary-soft hover:text-primary",
          focusRing,
        )}
      >
        <RotateCcw aria-hidden="true" className="size-3.5" strokeWidth={1.6} />
        {t("catdResetGroup")}
      </button>
    ) : null;

  return (
    <div data-catd-panel="" className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-[13px] font-semibold text-text">{t("catdTitle")}</h3>
        <Hint>{t("catdIntro")}</Hint>
        <p role="status" data-catd-status={display ? (matched ? "preset" : dirtyFrom ? "dirty" : "custom") : "classic"} className="text-[12px] font-medium text-primary">
          {status}
        </p>
      </div>

      {/* presets */}
      <div className="space-y-2" data-catd-presets="">
        <Label id={`${idBase}-presets`}>{t("catdPresetsTitle")}</Label>
        <div role="group" aria-labelledby={`${idBase}-presets`} className="grid grid-cols-2 gap-1">
          {CATEGORY_DISPLAY_PRESETS.map((preset) => {
            const active = matched === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                data-catd-preset={preset.id}
                aria-pressed={active}
                onClick={() => {
                  setAppliedPreset(preset.id);
                  emit(preset.display);
                }}
                className={cn(
                  "flex min-h-11 flex-col items-start justify-center gap-0.5 border px-2 py-1.5 text-start disabled:opacity-50",
                  focusRing,
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-text hover:bg-primary-soft",
                )}
              >
                <span className="text-[12px] font-semibold leading-4">{t(key(`catdPreset_${preset.id}`))}</span>
                <span className={cn("text-[11px] leading-4", active ? "text-primary-foreground" : "text-muted")}>
                  {t(key(`catdPresetHint_${preset.id}`))}
                </span>
              </button>
            );
          })}
        </div>
        <Hint>{t("catdPresetsHint")}</Hint>
        {display ? (
          <div className="space-y-1">
            <button
              type="button"
              data-catd-classic=""
              onClick={() => {
                setAppliedPreset(null);
                emit(undefined);
              }}
              className={cn(
                "inline-flex min-h-11 items-center gap-2 border border-border px-3 text-[12px] font-medium text-text hover:bg-primary-soft",
                focusRing,
              )}
            >
              <RotateCcw aria-hidden="true" className="size-4" strokeWidth={1.6} />
              {t("catdBackToClassic")}
            </button>
            <Hint>{t("catdBackToClassicHint")}</Hint>
          </div>
        ) : null}
      </div>

      {/* layout */}
      <Group
        id="layout"
        title={t("catdGroupLayout")}
        count={display ? 1 : 0}
        open={!!open.layout}
        onToggle={() => toggle("layout")}
        t={t}
      >
        <div role="group" aria-labelledby={`${idBase}-layout`} className="grid grid-cols-3 gap-1">
          <span id={`${idBase}-layout`} className="sr-only">
            {t("catdGroupLayout")}
          </span>
          <button
            type="button"
            data-catd-layout="classic"
            aria-pressed={!display}
            onClick={() => {
              setAppliedPreset(null);
              emit(undefined);
            }}
            className={cn(
              "flex min-h-11 flex-col items-center justify-center gap-1 border px-1.5 py-1 text-[12px] font-medium leading-4",
              focusRing,
              !display
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-text hover:bg-primary-soft",
            )}
          >
            <span className="break-words text-center">{t("catdLayoutClassic")}</span>
          </button>
          {DISPLAY_LAYOUTS.map((id) => {
            const Icon = LAYOUT_ICONS[id];
            const pressed = layout === id;
            return (
              <button
                key={id}
                type="button"
                data-catd-layout={id}
                aria-pressed={pressed}
                onClick={() => emit(setLayout(display, id))}
                className={cn(
                  "flex min-h-11 flex-col items-center justify-center gap-1 border px-1.5 py-1 text-[12px] font-medium leading-4",
                  focusRing,
                  pressed
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-text hover:bg-primary-soft",
                )}
              >
                <Icon aria-hidden="true" className="size-4" strokeWidth={1.6} />
                <span className="break-words text-center">{t(key(`catdLayout_${id}`))}</span>
              </button>
            );
          })}
        </div>
        <Hint data-catd-layout-hint="">
          {layout ? t(key(`catdLayoutHint_${layout}`)) : t("catdLayoutClassicHint")}
        </Hint>
      </Group>

      {!display || !layout || !resolved || !defaults ? (
        <Hint data-catd-pick-first="">{t("catdPickLayoutFirst")}</Hint>
      ) : (
        <>
          {/* card */}
          <Group
            id="card"
            title={t("catdGroupCard")}
            count={explicitCount(display, "card")}
            open={!!open.card}
            onToggle={() => toggle("card")}
            t={t}
          >
            <div className="space-y-1">
              <Label id={`${idBase}-card-style`}>{t("catdCardStyle")}</Label>
              <Choice
                labelledBy={`${idBase}-card-style`}
                options={DISPLAY_CARD_STYLES.map((id) => ({ id, label: t(key(`catdCardStyle_${id}`)) }))}
                value={effCardStyle ?? "none"}
                explicit={card?.style !== undefined}
                columns={2}
                onSelect={(id) => emit(setField(display, "card", "style", id))}
              />
            </div>
            <div className="space-y-1">
              <Label id={`${idBase}-card-bg`}>{t("catdCardBackground")}</Label>
              <Choice
                labelledBy={`${idBase}-card-bg`}
                options={DISPLAY_CARD_BACKGROUNDS.map((id) => ({ id, label: t(key(`catdCardBackground_${id}`)) }))}
                value={
                  card?.background ??
                  (effCardStyle === "none" ? "transparent" : effCardStyle === "filled" ? "muted" : "surface")
                }
                explicit={card?.background !== undefined}
                onSelect={(id) => emit(setField(display, "card", "background", id))}
              />
            </div>
            <NumberControl
              id={`${idBase}-card-bw`}
              label={t("catdCardBorderWidth")}
              value={card?.borderWidth}
              fallback={effCardStyle === "border" ? 1 : 0}
              min={DISPLAY_CARD_BORDER_WIDTH_RANGE[0]}
              max={DISPLAY_CARD_BORDER_WIDTH_RANGE[1]}
              unit={t("catdUnitPx")}
              onChange={(next) => emit(setField(display, "card", "borderWidth", next))}
              resetLabel={t("catdResetDevice")}
              inheritedText={t("catdInherited")}
            />
            {effBorderWidth > 0 ? (
              <div className="space-y-1">
                <Label id={`${idBase}-card-bc`}>{t("catdCardBorderColor")}</Label>
                <Choice
                  labelledBy={`${idBase}-card-bc`}
                  options={DISPLAY_CARD_BORDER_COLORS.map((id) => ({ id, label: t(key(`catdCardBorderColor_${id}`)) }))}
                  value={card?.borderColor ?? "border"}
                  explicit={card?.borderColor !== undefined}
                  columns={2}
                  onSelect={(id) => emit(setField(display, "card", "borderColor", id))}
                />
              </div>
            ) : null}
            <StepControl
              id={`${idBase}-card-radius`}
              label={t("catdCardRadius")}
              steps={[
                { id: "none", label: t("catdStep_radius_none"), value: 0 },
                { id: "sm", label: t("catdStep_radius_sm"), value: 8 },
                { id: "md", label: t("catdStep_radius_md"), value: 12 },
                { id: "lg", label: t("catdStep_radius_lg"), value: 16 },
                { id: "xl", label: t("catdStep_radius_xl"), value: 24 },
                { id: "full", label: t("catdStep_radius_full"), value: 32 },
              ]}
              value={card?.radius}
              fallback={12}
              min={DISPLAY_CARD_RADIUS_RANGE[0]}
              max={DISPLAY_CARD_RADIUS_RANGE[1]}
              onChange={(next) => emit(setField(display, "card", "radius", next))}
              t={t}
            />
            <StepControl
              id={`${idBase}-card-padding`}
              label={t("catdCardPadding")}
              steps={[
                { id: "none", label: t("catdStep_pad_none"), value: 0 },
                { id: "compact", label: t("catdStep_pad_compact"), value: 8 },
                { id: "normal", label: t("catdStep_pad_normal"), value: 12 },
                { id: "roomy", label: t("catdStep_pad_roomy"), value: 20 },
              ]}
              value={card?.padding}
              fallback={defaults.padding}
              min={DISPLAY_CARD_PADDING_RANGE[0]}
              max={DISPLAY_CARD_PADDING_RANGE[1]}
              onChange={(next) => emit(setField(display, "card", "padding", next))}
              t={t}
            />
            <div className="space-y-1">
              <Label id={`${idBase}-card-hover`}>{t("catdCardHover")}</Label>
              <Choice
                labelledBy={`${idBase}-card-hover`}
                options={DISPLAY_CARD_HOVERS.map((id) => ({ id, label: t(key(`catdCardHover_${id}`)) }))}
                value={card?.hover ?? "none"}
                explicit={card?.hover !== undefined}
                onSelect={(id) => emit(setField(display, "card", "hover", id))}
              />
              <Hint>{t("catdCardHoverHint")}</Hint>
            </div>
            <Hint>{t("catdColoursHint")}</Hint>
            {groupReset("card", explicitCount(display, "card"))}
          </Group>

          {/* image */}
          <Group
            id="image"
            title={t("catdGroupImage")}
            count={explicitCount(display, "image")}
            open={!!open.image}
            onToggle={() => toggle("image")}
            t={t}
          >
            <Switch
              label={t("catdImageShow")}
              checked={imageShown}
              onChange={(next) => emit(setField(display, "image", "show", next ? undefined : false))}
            />
            {imageShown ? (
              <>
                <div className="space-y-1">
                  <Label id={`${idBase}-img-shape`}>{t("catdImageShape")}</Label>
                  <Choice
                    labelledBy={`${idBase}-img-shape`}
                    options={shapes.map((id) => ({ id, label: t(key(`catdImageShape_${id}`)) }))}
                    value={effShape ?? shapes[0]}
                    explicit={image?.shape !== undefined}
                    disabled={shapes.length === 1}
                    onSelect={(id) => emit(setField(display, "image", "shape", id))}
                  />
                </div>
                <div className="space-y-1">
                  <Label id={`${idBase}-img-aspect`}>{t("catdImageAspect")}</Label>
                  <Choice
                    labelledBy={`${idBase}-img-aspect`}
                    options={DISPLAY_IMAGE_ASPECTS.map((id) => ({ id, label: id }))}
                    value={image?.aspect ?? defaults.aspect}
                    explicit={image?.aspect !== undefined}
                    disabled={effShape === "circle" || effShape === "square" || layout === "compact_list"}
                    onSelect={(id) => emit(setField(display, "image", "aspect", id))}
                  />
                  {effShape === "circle" || effShape === "square" || layout === "compact_list" ? (
                    <Hint data-catd-aspect-derived="">{t("catdImageAspectDerived")}</Hint>
                  ) : null}
                </div>
                <div className="space-y-1">
                  <Label id={`${idBase}-img-fit`}>{t("catdImageFit")}</Label>
                  <Choice
                    labelledBy={`${idBase}-img-fit`}
                    options={DISPLAY_IMAGE_FITS.map((id) => ({ id, label: t(key(`catdImageFit_${id}`)) }))}
                    value={image?.fit ?? "cover"}
                    explicit={image?.fit !== undefined}
                    onSelect={(id) => emit(setField(display, "image", "fit", id))}
                  />
                </div>
                <div className="space-y-1">
                  <Label id={`${idBase}-img-pos`}>{t("catdImagePosition")}</Label>
                  <Choice
                    labelledBy={`${idBase}-img-pos`}
                    options={DISPLAY_IMAGE_POSITIONS.map((id) => ({ id, label: t(key(`catdImagePosition_${id}`)) }))}
                    value={image?.position ?? "center"}
                    explicit={image?.position !== undefined}
                    columns={3}
                    onSelect={(id) => emit(setField(display, "image", "position", id))}
                  />
                </div>
                <div className="space-y-2">
                  <Label id={`${idBase}-img-height`}>
                    {effShape === "circle"
                      ? t("catdImageHeightCircle")
                      : layout === "compact_list"
                        ? t("catdImageHeightThumb")
                        : t("catdImageHeight")}
                  </Label>
                  <Choice
                    labelledBy={`${idBase}-img-height`}
                    options={[
                      { id: "auto", label: t("catdImageHeightAuto") },
                      { id: "custom", label: t("catdImageHeightCustom") },
                    ]}
                    value={heightCustom ? "custom" : "auto"}
                    explicit={heightCustom}
                    onSelect={(id) => {
                      if (id === "auto") {
                        let next: CategoryDisplay | undefined = display;
                        for (const device of DISPLAY_DEVICES) next = setImageHeight(next, device, undefined);
                        emit(next);
                      } else if (!heightCustom) {
                        emit(setImageHeight(display, "desktop", defaultHeight(layout, effShape, "desktop")));
                      }
                    }}
                  />
                  {heightCustom
                    ? DISPLAY_DEVICES.map((device) => (
                        <NumberControl
                          key={device}
                          id={`${idBase}-img-h-${device}`}
                          label={deviceLabel(device)}
                          value={image?.height?.[device]}
                          fallback={defaultHeight(layout, effShape, device)}
                          min={layout === "compact_list" ? 32 : DISPLAY_IMAGE_HEIGHT_RANGE[0]}
                          max={layout === "compact_list" ? 96 : DISPLAY_IMAGE_HEIGHT_RANGE[1]}
                          unit={t("catdUnitPx")}
                          onChange={(next) => emit(setImageHeight(display, device, next))}
                          resetLabel={t("catdResetDevice")}
                          inheritedText={t("catdImageHeightAuto")}
                        />
                      ))
                    : null}
                </div>
                <Hint>{t("catdImageFallbackNote")}</Hint>
              </>
            ) : (
              <Hint data-catd-image-hidden="">{t("catdImageHidden")}</Hint>
            )}
            {groupReset("image", explicitCount(display, "image"))}
          </Group>

          {/* name */}
          <Group
            id="name"
            title={t("catdGroupName")}
            count={explicitCount(display, "name")}
            open={!!open.name}
            onToggle={() => toggle("name")}
            t={t}
          >
            <Switch
              label={t("catdNameShow")}
              checked={resolved.name.show}
              disabled={nameForced}
              describedBy={`${idBase}-name-note`}
              onChange={(next) => emit(setField(display, "name", "show", next ? undefined : false))}
            />
            <Hint data-catd-name-note="" >
              <span id={`${idBase}-name-note`}>{nameForced ? t("catdNameForced") : t("catdNameHiddenNote")}</span>
            </Hint>
            {resolved.name.show ? (
              <>
                <div className="space-y-1">
                  <Label id={`${idBase}-name-place`}>{t("catdNamePlacement")}</Label>
                  <Choice
                    labelledBy={`${idBase}-name-place`}
                    options={DISPLAY_NAME_PLACEMENTS.filter((id) => placements.includes(id)).map((id) => ({
                      id,
                      label: t(key(`catdNamePlacement_${id}`)),
                    }))}
                    value={effPlacement ?? placements[0]}
                    explicit={name?.placement !== undefined}
                    disabled={placements.length === 1 || !imageShown}
                    columns={2}
                    onSelect={(id) => emit(setField(display, "name", "placement", id))}
                  />
                </div>
                <div className="space-y-1">
                  <Label id={`${idBase}-name-align`}>{t("catdNameAlign")}</Label>
                  <Choice
                    labelledBy={`${idBase}-name-align`}
                    options={(["start", "center", "end"] as const).map((id) => ({
                      id,
                      label: t(key(`catdNameAlign_${id}`)),
                    }))}
                    value={resolved.name.align}
                    explicit={name?.align !== undefined}
                    onSelect={(id) => emit(setField(display, "name", "align", id))}
                  />
                </div>
                <StepControl
                  id={`${idBase}-name-size`}
                  label={t("catdNameSize")}
                  steps={[
                    { id: "sm", label: t("catdStep_size_sm"), value: 13 },
                    { id: "md", label: t("catdStep_size_md"), value: 14 },
                    { id: "lg", label: t("catdStep_size_lg"), value: 16 },
                    { id: "xl", label: t("catdStep_size_xl"), value: 20 },
                  ]}
                  value={name?.size}
                  fallback={defaults.nameSize}
                  min={DISPLAY_NAME_SIZE_RANGE[0]}
                  max={DISPLAY_NAME_SIZE_RANGE[1]}
                  onChange={(next) => emit(setField(display, "name", "size", next))}
                  t={t}
                />
                <div className="space-y-1">
                  <Label id={`${idBase}-name-weight`}>{t("catdNameWeight")}</Label>
                  <select
                    aria-labelledby={`${idBase}-name-weight`}
                    value={String(name?.weight ?? "")}
                    onChange={(event) =>
                      emit(
                        setField(
                          display,
                          "name",
                          "weight",
                          event.target.value === "" ? undefined : (Number(event.target.value) as (typeof DISPLAY_NAME_WEIGHTS)[number]),
                        ),
                      )
                    }
                    className={cn("h-11 w-full border border-border bg-surface px-2 text-sm text-text", focusRing)}
                  >
                    <option value="">
                      {t("catdInherited")} ({t(key(`catdNameWeight_${defaults.nameWeight}`))})
                    </option>
                    {DISPLAY_NAME_WEIGHTS.map((weight) => (
                      <option key={weight} value={weight}>
                        {t(key(`catdNameWeight_${weight}`))}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label id={`${idBase}-name-color`}>{t("catdNameColor")}</Label>
                  <Choice
                    labelledBy={`${idBase}-name-color`}
                    options={DISPLAY_NAME_COLORS.map((id) => ({ id, label: t(key(`catdNameColor_${id}`)) }))}
                    value={name?.color ?? "foreground"}
                    explicit={name?.color !== undefined}
                    disabled={onBacking}
                    onSelect={(id) => emit(setField(display, "name", "color", id))}
                  />
                  {onBacking ? <Hint data-catd-color-auto="">{t("catdNameColorOnBacking")}</Hint> : null}
                </div>
                <div className="space-y-1">
                  <Label id={`${idBase}-name-lines`}>{t("catdNameLines")}</Label>
                  <Choice
                    labelledBy={`${idBase}-name-lines`}
                    options={DISPLAY_NAME_LINES.map((id) => ({ id, label: t(key(`catdNameLines_${id}`)) }))}
                    value={name?.lines ?? 2}
                    explicit={name?.lines !== undefined}
                    onSelect={(id) => emit(setField(display, "name", "lines", id))}
                  />
                </div>
                <div className="space-y-1">
                  <Label id={`${idBase}-name-bg`}>{t("catdNameBackground")}</Label>
                  <Choice
                    labelledBy={`${idBase}-name-bg`}
                    options={DISPLAY_NAME_BACKGROUNDS.filter((id) => !(overlay && id === "none")).map((id) => ({
                      id,
                      label: t(key(`catdNameBackground_${id}`)),
                    }))}
                    value={resolved.name.background}
                    explicit={name?.background !== undefined}
                    onSelect={(id) => emit(setField(display, "name", "background", id))}
                  />
                  {overlay ? <Hint data-catd-overlay-backed="">{t("catdNameOverlayBacked")}</Hint> : null}
                </div>
              </>
            ) : null}
            {groupReset("name", explicitCount(display, "name"))}
          </Group>

          {/* responsive */}
          <Group
            id="responsive"
            title={t("catdGroupResponsive")}
            count={explicitCount(display, "responsive")}
            open={!!open.responsive}
            onToggle={() => toggle("responsive")}
            t={t}
          >
            <Hint>{t("catdResponsiveHint")}</Hint>
            {usesColumns(layout) ? (
              <fieldset className="space-y-3" data-catd-responsive="columns">
                <legend className="mb-1 text-[12px] font-semibold text-text">{t("catdColumns")}</legend>
                {DISPLAY_DEVICES.map((device) => (
                  <NumberControl
                    key={device}
                    id={`${idBase}-cols-${device}`}
                    label={deviceLabel(device)}
                    value={display.columns?.[device]}
                    fallback={defaults.columns[device]}
                    min={DISPLAY_COLUMN_RANGES[device][0]}
                    max={DISPLAY_COLUMN_RANGES[device][1]}
                    onChange={(next) => emit(setDevice(display, "columns", device, next))}
                    resetLabel={t("catdResetDevice")}
                    inheritedText={t("catdInherited")}
                  />
                ))}
              </fieldset>
            ) : null}
            {isScrollLayout(layout) ? (
              <fieldset className="space-y-3" data-catd-responsive="itemWidth">
                <legend className="mb-1 text-[12px] font-semibold text-text">{t("catdItemWidth")}</legend>
                {DISPLAY_DEVICES.map((device) => (
                  <NumberControl
                    key={device}
                    id={`${idBase}-iw-${device}`}
                    label={deviceLabel(device)}
                    value={display.itemWidth?.[device]}
                    fallback={defaults.itemWidth[device]}
                    min={DISPLAY_ITEM_WIDTH_RANGE[0]}
                    max={DISPLAY_ITEM_WIDTH_RANGE[1]}
                    unit={t("catdUnitPx")}
                    onChange={(next) => emit(setDevice(display, "itemWidth", device, next))}
                    resetLabel={t("catdResetDevice")}
                    inheritedText={t("catdInherited")}
                  />
                ))}
              </fieldset>
            ) : null}
            <GapControl
              idBase={idBase}
              display={display}
              defaults={defaults.gap}
              onChange={emit}
              deviceLabel={deviceLabel}
              t={t}
            />
            {explicitCount(display, "responsive") > 0 ? (
              <div className="flex flex-wrap gap-1">
                {(["columns", "gap", "itemWidth"] as const)
                  .filter((axis) => Object.keys(display[axis] ?? {}).length > 0)
                  .map((axis) => (
                    <button
                      key={axis}
                      type="button"
                      data-catd-axis-reset={axis}
                      onClick={() => emit(resetResponsive(display, axis))}
                      className={cn(
                        "inline-flex min-h-9 items-center gap-1.5 border border-border px-2 text-[12px] text-muted hover:bg-primary-soft hover:text-primary",
                        focusRing,
                      )}
                    >
                      <RotateCcw aria-hidden="true" className="size-3.5" strokeWidth={1.6} />
                      {t(axis === "columns" ? "catdColumns" : axis === "gap" ? "catdGap" : "catdItemWidth")}
                    </button>
                  ))}
              </div>
            ) : null}
          </Group>
        </>
      )}
    </div>
  );
}

/** A sensible starting value when the merchant switches the picture height to custom. */
function defaultHeight(layout: DisplayLayout | undefined, shape: string | undefined, device: DisplayDevice): number {
  if (layout === "compact_list") return 48;
  if (shape === "circle") return { mobile: 88, tablet: 104, desktop: 120 }[device];
  return { mobile: 96, tablet: 120, desktop: 140 }[device];
}
