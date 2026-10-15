'use client';

/**
 * AWJ-VD-H1 / VD-3 — the small controls of the facet visual editor.
 *
 * - `PropertyRow`: a label, the inheritance state of that one property («inherited from the dimension: …» while it is
 *   not overridden, a «restore inheritance» button once it is) and the server's field errors for it.
 * - `Segmented`: a group of option buttons (`aria-pressed`), 44 px tall.
 * - `ShapeGrid`: the 12 shapes, each drawn by the VD-2 shape engine itself (`facetShapeFrameStyle`), so the thumbnail is
 *   the real geometry. One tab stop, arrow keys inside (mirrored in RTL).
 * - `FocalGrid`: a 3 × 3 focal point picker. It is forced `dir="ltr"` because the focal point is a *physical* position
 *   (`object-position: x% y%`): in RTL a logical grid would swap left and right.
 * - `ZoomSlider`: 1–3 in steps of 0.1.
 *
 * Icons are drawn bare — no coloured boxes behind them (DESIGN_SYSTEM.md); a selected option takes the `--primary`
 * border and the `--primary-soft` fill.
 */

import { RotateCcw } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  FACET_VISUAL_SHAPES,
  FACET_VISUAL_ZOOM_MAX,
  FACET_VISUAL_ZOOM_MIN,
  type FacetVisualShape,
} from '@/modules/store-experience-builder/presentation/facet-visual';
import { facetShapeFrameStyle } from '@/modules/store-experience-builder/presentation/facet-visual-style';
import type { InheritableKey, PropState } from './document';
import { describeValue, type EditorLocale, shapeLabel } from './labels';
import { fieldErrorMessage, type VT } from './messages';

export const optionClass = (selected: boolean) =>
  cn(
    'flex min-h-11 items-center justify-center gap-1.5 rounded-md border px-3 text-sm transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50',
    selected ? 'border-primary bg-primary-soft text-primary' : 'border-border bg-surface text-text hover:bg-primary-soft',
  );

// ───────────────────────────── field errors ─────────────────────────────

export function FieldErrors({ codes, t, id }: { codes: readonly string[] | undefined; t: VT; id?: string }) {
  if (!codes || codes.length === 0) return null;
  return (
    <ul id={id} role="alert" className="space-y-0.5 text-xs text-negative">
      {[...new Set(codes)].map((code) => (
        <li key={code} data-error-code={code}>
          {fieldErrorMessage(t, code)}
        </li>
      ))}
    </ul>
  );
}

// ───────────────────────────── property row ─────────────────────────────

/**
 * One property with its inheritance state. `parent` says what «not overridden» means: a value follows its dimension
 * (`facet`), while a dimension's own appearance and its defaults have only the system default (`none`).
 */
export function PropertyRow({
  label,
  propKey,
  state,
  parent,
  locale,
  t,
  onRestore,
  readOnly,
  busy = false,
  errors,
  children,
  hideState = false,
  hideLabel = false,
  labelFor,
  valueText,
}: {
  label: string;
  propKey: InheritableKey | 'focal' | 'zoom';
  state: PropState;
  parent: 'facet' | 'none';
  locale: EditorLocale;
  t: VT;
  onRestore: () => void;
  readOnly: boolean;
  /** A save is in flight: the restore button is disabled. */
  busy?: boolean;
  errors?: readonly string[];
  children: ReactNode;
  /** The caller shows its own state (e.g. the content-type group, where «inherit» is itself an option). */
  hideState?: boolean;
  /** The control draws its own visible label (the colour field); the row keeps it for assistive tech only. */
  hideLabel?: boolean;
  labelFor?: string;
  /** The words for the effective value when it is not one `describeValue` knows (focal point, zoom). */
  valueText?: string;
}) {
  const labelId = useId();
  const value = valueText ?? describeValue(propKey as InheritableKey, state.value, locale, t);
  const overridden = state.source === 'own';
  // «Restore» removes its own button, which is the focused element: put focus on the control that was just restored so
  // a keyboard user is not dropped onto the dialog container.
  const controlRef = useRef<HTMLDivElement>(null);
  const [restoredCount, setRestoredCount] = useState(0);
  useEffect(() => {
    if (restoredCount === 0) return;
    const root = controlRef.current;
    const target =
      root?.querySelector<HTMLElement>('[aria-pressed="true"]:not(:disabled)') ??
      root?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), [role="switch"]:not(:disabled)');
    target?.focus();
  }, [restoredCount]);
  const labelClass = hideLabel ? 'sr-only' : 'text-sm font-medium text-text';
  return (
    <div className="space-y-2" data-prop={propKey} data-prop-source={state.source}>
      <div className={cn('flex flex-wrap items-center justify-between gap-x-3 gap-y-1', hideLabel && 'justify-end')}>
        {labelFor ? (
          <label htmlFor={labelFor} id={labelId} className={labelClass}>
            {label}
          </label>
        ) : (
          <span id={labelId} className={labelClass}>
            {label}
          </span>
        )}
        {hideState ? null : (
          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
            {overridden ? (
              <Badge tone="neutral" wrap data-state-badge="own">
                {parent === 'facet' ? t('customizedValue') : t('customizedHere')}
              </Badge>
            ) : (
              <Badge tone="muted" wrap data-state-badge={state.source}>
                {state.source === 'facet' && parent === 'facet'
                  ? t('inheritedFromFacet', { value })
                  : t('inheritedSystem', { value })}
              </Badge>
            )}
            {overridden && !readOnly ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  onRestore();
                  setRestoredCount((n) => n + 1);
                }}
                aria-label={`${parent === 'facet' ? t('restoreInheritance') : t('restoreDefault')} — ${label}`}
                className="inline-flex min-h-11 items-center gap-1 rounded px-2 text-xs disabled:opacity-50 font-medium text-primary hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                data-restore={propKey}
              >
                <RotateCcw className="size-3.5" strokeWidth={1.7} aria-hidden="true" />
                {parent === 'facet' ? t('restoreInheritance') : t('restoreDefault')}
              </button>
            ) : null}
          </span>
        )}
      </div>
      <div ref={controlRef} className="space-y-2">
        {children}
      </div>
      <FieldErrors codes={errors} t={t} />
    </div>
  );
}

// ───────────────────────────── segmented options ─────────────────────────────

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
  describedBy?: string;
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  className,
}: {
  label: string;
  value: T | undefined;
  options: readonly SegmentOption<T>[];
  onChange: (next: T) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn('grid gap-2', className ?? 'grid-cols-2 sm:grid-cols-4')}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          aria-describedby={option.describedBy}
          disabled={disabled || option.disabled}
          onClick={() => onChange(option.value)}
          className={optionClass(value === option.value)}
          data-option={option.value}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

// ───────────────────────────── roving grid ─────────────────────────────

/** One tab stop for a grid of buttons; arrow keys move inside it. Mirrored in RTL unless the grid is forced `ltr`. */
function useRovingGrid(ids: readonly string[], selected: string | undefined, fixedColumns?: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const tabbable = (focused && ids.includes(focused) && focused) || (selected && ids.includes(selected) && selected) || ids[0];

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const grid = ref.current;
    if (!grid) return;
    const buttons = Array.from(grid.querySelectorAll<HTMLButtonElement>('button[data-grid-item]:not(:disabled)'));
    const from = buttons.findIndex((button) => button === document.activeElement);
    if (from < 0) return;
    const rtl = grid.closest('[dir]')?.getAttribute('dir') === 'rtl';
    const columns =
      fixedColumns ?? Math.max(1, buttons.filter((button) => button.offsetTop === buttons[0].offsetTop).length);
    const step: Record<string, number> = {
      ArrowRight: rtl ? -1 : 1,
      ArrowLeft: rtl ? 1 : -1,
      ArrowDown: columns,
      ArrowUp: -columns,
    };
    let to: number;
    if (event.key === 'Home') to = 0;
    else if (event.key === 'End') to = buttons.length - 1;
    else if (event.key in step) {
      const next = from + step[event.key];
      to = next < 0 || next >= buttons.length ? from : next;
    } else return;
    event.preventDefault();
    buttons[to].focus();
    setFocused(buttons[to].dataset.gridItem ?? null);
  };

  return {
    ref,
    onKeyDown,
    tabIndexOf: (id: string) => (tabbable === id ? 0 : -1),
    onFocusItem: (id: string) => setFocused(id),
  };
}

// ───────────────────────────── shapes ─────────────────────────────

/** Width of a shape thumbnail; its height follows the shape's own aspect ratio. */
const SHAPE_THUMB_PX = 26;

export function ShapeGrid({
  value,
  onChange,
  disabled,
  label,
  locale,
}: {
  value: FacetVisualShape | undefined;
  onChange: (next: FacetVisualShape) => void;
  disabled: boolean;
  label: string;
  locale: EditorLocale;
}) {
  const roving = useRovingGrid(FACET_VISUAL_SHAPES, value);
  return (
    <div
      ref={roving.ref}
      role="group"
      aria-label={label}
      onKeyDown={roving.onKeyDown}
      className="grid grid-cols-3 gap-2 sm:grid-cols-4"
    >
      {FACET_VISUAL_SHAPES.map((shape) => {
        const name = shapeLabel(shape, locale);
        const selected = value === shape;
        return (
          <button
            key={shape}
            type="button"
            data-grid-item={shape}
            data-shape-option={shape}
            tabIndex={roving.tabIndexOf(shape)}
            aria-pressed={selected}
            aria-label={name}
            title={name}
            disabled={disabled}
            onFocus={() => roving.onFocusItem(shape)}
            onClick={() => onChange(shape)}
            className={cn(
              'flex min-h-[4.25rem] flex-col items-center justify-center gap-1 rounded-md border px-1.5 py-2 text-center transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50',
              selected
                ? 'border-primary bg-primary-soft text-primary'
                : 'border-border bg-surface text-muted hover:bg-primary-soft hover:text-text',
            )}
          >
            <span
              aria-hidden="true"
              className="block bg-current"
              style={{ ...facetShapeFrameStyle(shape), width: SHAPE_THUMB_PX }}
            />
            <span className="line-clamp-2 break-words text-[11px] leading-tight">{name}</span>
          </button>
        );
      })}
    </div>
  );
}

// ───────────────────────────── focal point ─────────────────────────────

const FOCAL_STEPS = [0, 50, 100] as const;

export function FocalGrid({
  value,
  onChange,
  disabled,
  label,
  t,
}: {
  value: { x: number; y: number };
  onChange: (next: { x: number; y: number }) => void;
  disabled: boolean;
  label: string;
  t: VT;
}) {
  const ids = FOCAL_STEPS.flatMap((y) => FOCAL_STEPS.map((x) => `${x}-${y}`));
  const selectedId = `${value.x}-${value.y}`;
  const roving = useRovingGrid(ids, ids.includes(selectedId) ? selectedId : '50-50', 3);
  const rows = [t('focalRowTop'), t('focalRowMiddle'), t('focalRowBottom')];
  const cols = [t('focalColLeft'), t('focalColCenter'), t('focalColRight')];
  const custom = !ids.includes(selectedId);

  return (
    <div className="space-y-2">
      {/* Physical, not logical: x is a left-to-right percentage, so the grid never mirrors. */}
      <div
        ref={roving.ref}
        role="group"
        aria-label={label}
        dir="ltr"
        onKeyDown={roving.onKeyDown}
        className="grid w-[9.5rem] grid-cols-3 gap-1.5"
      >
        {FOCAL_STEPS.map((y, row) =>
          FOCAL_STEPS.map((x, col) => {
            const id = `${x}-${y}`;
            const selected = id === selectedId;
            const name = row === 1 && col === 1 ? t('focalCenter') : `${rows[row]} ${cols[col]}`;
            return (
              <button
                key={id}
                type="button"
                data-grid-item={id}
                data-focal-option={id}
                tabIndex={roving.tabIndexOf(id)}
                aria-pressed={selected}
                aria-label={name}
                title={name}
                disabled={disabled}
                onFocus={() => roving.onFocusItem(id)}
                onClick={() => onChange({ x, y })}
                className={cn(
                  'flex size-11 items-center justify-center rounded-md border transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50',
                  selected ? 'border-primary bg-primary-soft' : 'border-border bg-surface hover:bg-primary-soft',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn('block size-2.5 rounded-full', selected ? 'bg-primary' : 'bg-muted/50')}
                />
              </button>
            );
          }),
        )}
      </div>
      {custom ? (
        <p className="text-xs text-muted" data-focal-custom>
          {t('focalCustom', { x: value.x, y: value.y })}
        </p>
      ) : null}
    </div>
  );
}

// ───────────────────────────── zoom ─────────────────────────────

export function ZoomSlider({
  value,
  onChange,
  disabled,
  label,
}: {
  value: number;
  onChange: (next: number) => void;
  disabled: boolean;
  label: string;
}) {
  const id = useId();
  return (
    <div className="flex min-h-11 items-center gap-3">
      <input
        id={id}
        type="range"
        min={FACET_VISUAL_ZOOM_MIN}
        max={FACET_VISUAL_ZOOM_MAX}
        step={0.1}
        value={value}
        disabled={disabled}
        aria-label={label}
        aria-valuetext={`×${value.toFixed(1)}`}
        onChange={(event) => onChange(Math.round(Number(event.target.value) * 10) / 10)}
        className="h-11 min-w-0 flex-1 accent-[var(--primary)] disabled:opacity-50"
      />
      <output htmlFor={id} dir="ltr" className="w-10 shrink-0 text-end text-sm tabular-nums text-text">
        ×{value.toFixed(1)}
      </output>
    </div>
  );
}

// ───────────────────────────── section heading ─────────────────────────────

export function SectionHeading({ title, help, id }: { title: string; help?: string; id?: string }) {
  return (
    <div className="space-y-0.5">
      <h3 id={id} className="text-sm font-semibold text-text">
        {title}
      </h3>
      {help ? <p className="text-xs leading-5 text-muted">{help}</p> : null}
    </div>
  );
}
