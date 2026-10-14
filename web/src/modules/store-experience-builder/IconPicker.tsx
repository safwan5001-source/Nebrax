'use client';

import { type KeyboardEvent, useId, useMemo, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { ICON_KEYS, ICON_REGISTRY, type IconKey } from './presentation/icon-registry';
import { StoreIcon } from './StoreIcon';

export interface IconPickerLabels {
  /** Accessible name of the whole picker (group label). */
  group: string;
  search: string;
  /** Shown only when `allowNone` — the "no icon" choice. */
  none: string;
  noResults: string;
}

/**
 * Lower-case, diacritics- and tatweel-free text with the usual Arabic spelling variants folded, so «تخرج» finds
 * «تخرّج», «اطفال» finds «أطفال» and «موسيقي» finds «موسيقى».
 */
function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627')
    .replace(/\u0649/g, '\u064A')
    .replace(/\u0629/g, '\u0647')
    .trim();
}

const NONE = '__none__';

/** Icons whose key, Arabic or English label, or tags contain the query (all words must match). */
export function filterIconKeys(query: string): IconKey[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...ICON_KEYS];
  return ICON_KEYS.filter((key) => {
    const info = ICON_REGISTRY[key];
    const haystack = fold([key, info.label.ar, info.label.en, ...info.tags].join(' '));
    return words.every((word) => haystack.includes(word));
  });
}

/**
 * AWJ-VD-H1 / VD-2 — a searchable grid over the curated `IconRegistry` (D-10). It emits a registry **key** only
 * (never JSX or SVG). Icons are drawn bare, without coloured boxes (DESIGN_SYSTEM.md); the selected one gets the
 * `--primary` border and `--primary-soft` fill. Every option is a 44px button with `aria-pressed` and its
 * localized name.
 *
 * Keyboard: the grid is one Tab stop (roving tabindex). Arrow keys move between options, mirrored in RTL, Up/Down move
 * by a row, Home/End jump to the ends, and Enter/Space select. An empty search is announced through a live region.
 */
export function IconPicker({
  value,
  onChange,
  locale,
  labels,
  allowNone = false,
  disabled = false,
}: {
  value: IconKey | undefined;
  onChange: (next: IconKey | undefined) => void;
  locale: 'ar' | 'en';
  labels: IconPickerLabels;
  allowNone?: boolean;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState<string | null>(null);
  const searchId = useId();
  const gridRef = useRef<HTMLDivElement>(null);
  const keys = useMemo(() => filterIconKeys(query), [query]);

  const ids = useMemo(() => [...(allowNone ? [NONE] : []), ...keys], [allowNone, keys]);
  const selectedId = value ?? (allowNone ? NONE : undefined);
  const tabbable =
    (focused !== null && ids.includes(focused) && focused) ||
    (selectedId !== undefined && ids.includes(selectedId) && selectedId) ||
    ids[0];

  const onGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const grid = gridRef.current;
    if (!grid) return;
    const buttons = Array.from(grid.querySelectorAll<HTMLButtonElement>('button[data-icon-option]'));
    const from = buttons.findIndex((button) => button === document.activeElement);
    if (from < 0) return;
    const rtl = grid.closest('[dir]')?.getAttribute('dir') === 'rtl';
    // Columns from layout: the options sharing the first option's row. A move past either end stays put.
    const columns = Math.max(1, buttons.filter((button) => button.offsetTop === buttons[0].offsetTop).length);
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
    const target = buttons[to];
    target.focus();
    setFocused(target.dataset.iconOption ?? null);
  };

  const option = (selected: boolean) =>
    cn(
      'flex size-11 items-center justify-center rounded-md border text-muted transition-colors',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50',
      selected ? 'border-primary bg-primary-soft text-primary' : 'border-border hover:text-text',
    );

  return (
    <div role="group" aria-label={labels.group} className="space-y-3">
      <label htmlFor={searchId} className="sr-only">
        {labels.search}
      </label>
      <Input
        id={searchId}
        type="search"
        value={query}
        placeholder={labels.search}
        onChange={(event) => setQuery(event.target.value)}
        disabled={disabled}
      />
      <div
        ref={gridRef}
        onKeyDown={onGridKeyDown}
        className="grid grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))] gap-2"
      >
        {allowNone ? (
          <button
            type="button"
            data-icon-option={NONE}
            tabIndex={tabbable === NONE ? 0 : -1}
            className={cn(option(value === undefined), 'text-xs')}
            aria-pressed={value === undefined}
            aria-label={labels.none}
            title={labels.none}
            disabled={disabled}
            onFocus={() => setFocused(NONE)}
            onClick={() => onChange(undefined)}
          >
            —
          </button>
        ) : null}
        {keys.map((key) => {
          const name = ICON_REGISTRY[key].label[locale];
          return (
            <button
              key={key}
              type="button"
              data-icon-option={key}
              tabIndex={tabbable === key ? 0 : -1}
              className={option(value === key)}
              aria-pressed={value === key}
              aria-label={name}
              title={name}
              disabled={disabled}
              onFocus={() => setFocused(key)}
              onClick={() => onChange(key)}
            >
              <StoreIcon name={key} className="size-5" />
            </button>
          );
        })}
      </div>
      <p role="status" className={keys.length === 0 ? 'text-sm text-muted' : 'sr-only'}>
        {keys.length === 0 ? labels.noResults : ''}
      </p>
    </div>
  );
}
