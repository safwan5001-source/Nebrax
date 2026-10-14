'use client';

import { useId, useMemo, useState } from 'react';
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

/** Lower-case, Arabic-diacritics-free text so «تَخرُّج» matches «تخرج». */
function fold(text: string): string {
  return text.toLowerCase().replace(/[ً-ٰٟ]/g, '').trim();
}

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
  const searchId = useId();
  const keys = useMemo(() => filterIconKeys(query), [query]);

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
      <div className="grid grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))] gap-2">
        {allowNone ? (
          <button
            type="button"
            className={cn(option(value === undefined), 'text-xs')}
            aria-pressed={value === undefined}
            aria-label={labels.none}
            title={labels.none}
            disabled={disabled}
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
              className={option(value === key)}
              aria-pressed={value === key}
              aria-label={name}
              title={name}
              disabled={disabled}
              onClick={() => onChange(key)}
            >
              <StoreIcon name={key} className="size-5" />
            </button>
          );
        })}
      </div>
      {keys.length === 0 ? <p className="text-sm text-muted">{labels.noResults}</p> : null}
    </div>
  );
}
