'use client';

import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ActiveFilter } from '@/lib/data-explorer/types';

interface ActiveFilterChipsProps {
  filters: ActiveFilter[];
  onRemove: (key: string) => void;
  onClear: () => void;
  formatValue?: (filter: ActiveFilter) => string;
}

function defaultFormatValue(filter: ActiveFilter): string {
  const value = Array.isArray(filter.value) ? filter.value.join('، ') : String(filter.value);
  return filter.label ? `${filter.label}: ${value}` : value;
}

export function ActiveFilterChips({
  filters,
  onRemove,
  onClear,
  formatValue = defaultFormatValue,
}: ActiveFilterChipsProps) {
  if (filters.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="الفلاتر النشطة">
      {filters.map((filter) => (
        <button
          key={filter.key}
          type="button"
          onClick={() => onRemove(filter.key)}
          className="inline-flex h-8 items-center gap-1.5 rounded border border-border bg-primary-soft px-2.5 text-xs text-text transition-colors hover:border-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          aria-label={`إزالة الفلتر ${formatValue(filter)}`}
        >
          <span>{formatValue(filter)}</span>
          <X className="h-3 w-3 text-muted" strokeWidth={1.7} aria-hidden="true" />
        </button>
      ))}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onClear}
        className="h-8 text-xs text-muted hover:text-text"
      >
        مسح الكل
      </Button>
    </div>
  );
}
