'use client';

import { SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Combobox, type ComboOption } from '@/components/ui/combobox';
import { Select } from '@/components/ui/select';
import type { ActiveFilter, FilterDefinition } from '@/lib/data-explorer/types';

interface QuickFiltersProps {
  definitions: FilterDefinition[];
  filters: ActiveFilter[];
  onChange: (filter: ActiveFilter) => void;
  onOpenAdvanced?: () => void;
}

export function QuickFilters({
  definitions,
  filters,
  onChange,
  onOpenAdvanced,
}: QuickFiltersProps) {
  const quick = definitions.filter((definition) => definition.quick);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {quick.map((definition) => {
        if (!definition.options?.length) return null;

        const active = filters.find((filter) => filter.key === definition.key);
        const value = active && !Array.isArray(active.value) ? String(active.value) : '';

        if (definition.kind === 'entity') {
          const options: ComboOption[] = definition.options.map((option) => ({
            value: option.value,
            label: option.label,
            sub: option.sub,
            hint: option.hint,
          }));

          return (
            <Combobox
              key={definition.key}
              value={value}
              onChange={(nextValue) =>
                onChange({
                  key: definition.key,
                  operator: 'eq',
                  value: nextValue,
                  label: definition.label,
                })
              }
              options={options}
              placeholder={definition.label}
              clearLabel={definition.label}
              searchPlaceholder={definition.searchPlaceholder ?? `ابحث في ${definition.label}`}
              emptyText={definition.emptyText ?? 'لا توجد نتائج مطابقة'}
              aria-label={definition.label}
              className="min-w-40 sm:min-w-48"
            />
          );
        }

        return (
          <Select
            key={definition.key}
            value={value}
            onChange={(event) =>
              onChange({
                key: definition.key,
                operator: 'eq',
                value: event.target.value,
                label: definition.label,
              })
            }
            aria-label={definition.label}
            className="h-9 min-w-32 bg-surface text-sm"
          >
            <option value="">{definition.label}</option>
            {definition.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        );
      })}

      {onOpenAdvanced ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onOpenAdvanced}
          className="h-9 gap-1.5"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1.7} />
          فلترة متقدمة
        </Button>
      ) : null}
    </div>
  );
}
