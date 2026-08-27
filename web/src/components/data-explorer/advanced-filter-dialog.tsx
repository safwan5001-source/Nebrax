'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Combobox, type ComboOption } from '@/components/ui/combobox';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { ActiveFilter, FilterDefinition, FilterOperator } from '@/lib/data-explorer/types';

interface AdvancedFilterDialogProps {
  open: boolean;
  onClose: () => void;
  definitions: FilterDefinition[];
  filters: ActiveFilter[];
  onApply: (filters: ActiveFilter[]) => void;
  title?: string;
  applyLabel?: string;
  clearLabel?: string;
}

function filterValue(filter: ActiveFilter | undefined): string {
  if (!filter || Array.isArray(filter.value)) return '';
  return String(filter.value);
}

export function AdvancedFilterDialog({
  open,
  onClose,
  definitions,
  filters,
  onApply,
  title,
  applyLabel,
  clearLabel,
}: AdvancedFilterDialogProps) {
  const t = useTranslations('nebrax');
  const dialogTitle = title ?? t('advancedFilters');
  const resolvedApplyLabel = applyLabel ?? t('showResults');
  const resolvedClearLabel = clearLabel ?? t('clearFilters');
  const moneyOperators: { value: FilterOperator; label: string }[] = [
    { value: 'eq', label: t('equals') },
    { value: 'gte', label: t('greaterThanOrEqual') },
    { value: 'lte', label: t('lessThanOrEqual') },
  ];
  const [draft, setDraft] = useState<ActiveFilter[]>(filters);

  useEffect(() => {
    if (open) setDraft(filters);
  }, [filters, open]);

  const byKey = useMemo(() => new Map(draft.map((filter) => [filter.key, filter])), [draft]);

  function setFilter(next: ActiveFilter | null, key: string) {
    setDraft((current) => {
      const rest = current.filter((filter) => filter.key !== key);
      return next ? [...rest, next] : rest;
    });
  }

  return (
    <Dialog open={open} onClose={onClose} title={dialogTitle}>
      <div className="max-h-[65vh] space-y-5 overflow-y-auto pe-1">
        {definitions.map((definition) => {
          const active = byKey.get(definition.key);

          if (definition.kind === 'entity' && definition.options?.length) {
            const options: ComboOption[] = definition.options.map((option) => ({
              value: option.value,
              label: option.label,
              sub: option.sub,
              hint: option.hint,
            }));

            return (
              <label key={definition.key} className="block space-y-1.5">
                <span className="text-xs font-medium text-muted">{definition.label}</span>
                <Combobox
                  value={filterValue(active)}
                  onChange={(value) => {
                    setFilter(
                      value
                        ? { key: definition.key, operator: 'eq', value, label: definition.label }
                        : null,
                      definition.key
                    );
                  }}
                  options={options}
                  placeholder={t('all')}
                  clearLabel={t('all')}
                  searchPlaceholder={definition.searchPlaceholder ?? t('searchWithin', { label: definition.label })}
                  emptyText={definition.emptyText ?? t('noMatchingResults')}
                  className="w-full"
                  aria-label={definition.label}
                />
              </label>
            );
          }

          if (definition.kind === 'select' && definition.options?.length) {
            return (
              <label key={definition.key} className="block space-y-1.5">
                <span className="text-xs font-medium text-muted">{definition.label}</span>
                <Select
                  value={filterValue(active)}
                  onChange={(event) => {
                    const value = event.target.value;
                    setFilter(
                      value
                        ? { key: definition.key, operator: 'eq', value, label: definition.label }
                        : null,
                      definition.key
                    );
                  }}
                  className="w-full"
                >
                  <option value="">{t('all')}</option>
                  {definition.options.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </Select>
              </label>
            );
          }

          if (definition.kind === 'multiSelect' && definition.options?.length) {
            const selected = Array.isArray(active?.value) ? active.value.map(String) : [];
            return (
              <fieldset key={definition.key} className="space-y-1.5">
                <legend className="text-xs font-medium text-muted">{definition.label}</legend>
                <div className="grid max-h-48 grid-cols-1 gap-1 overflow-y-auto rounded border border-border p-2 sm:grid-cols-2">
                  {definition.options.map((option) => {
                    const checked = selected.includes(option.value);
                    return (
                      <label key={option.value} className="flex min-h-9 items-center gap-2 rounded px-2 text-sm text-text hover:bg-primary-soft/50">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => {
                            const next = event.target.checked
                              ? [...selected, option.value]
                              : selected.filter((value) => value !== option.value);
                            setFilter(
                              next.length
                                ? { key: definition.key, operator: 'in', value: next, label: definition.label }
                                : null,
                              definition.key
                            );
                          }}
                          className="h-4 w-4 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                        />
                        <span className="min-w-0 truncate">{option.label}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            );
          }

          if (definition.kind === 'dateRange') {
            const range = Array.isArray(active?.value) ? active?.value.map(String) : [];
            return (
              <fieldset key={definition.key} className="space-y-1.5">
                <legend className="text-xs font-medium text-muted">{definition.label}</legend>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Input
                    type="date"
                    value={range[0] ?? ''}
                    aria-label={`${definition.label} ${t('from')}`}
                    onChange={(event) => {
                      const from = event.target.value;
                      const to = range[1] ?? '';
                      setFilter(
                        from || to
                          ? { key: definition.key, operator: 'between', value: [from, to], label: definition.label }
                          : null,
                        definition.key
                      );
                    }}
                  />
                  <Input
                    type="date"
                    value={range[1] ?? ''}
                    aria-label={`${definition.label} ${t('to')}`}
                    onChange={(event) => {
                      const from = range[0] ?? '';
                      const to = event.target.value;
                      setFilter(
                        from || to
                          ? { key: definition.key, operator: 'between', value: [from, to], label: definition.label }
                          : null,
                        definition.key
                      );
                    }}
                  />
                </div>
              </fieldset>
            );
          }

          if (definition.kind === 'money' || definition.kind === 'number') {
            const operator = active?.operator ?? definition.operators?.[0] ?? 'gte';
            return (
              <fieldset key={definition.key} className="space-y-1.5">
                <legend className="text-xs font-medium text-muted">{definition.label}</legend>
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-2">
                  <Select
                    value={operator}
                    onChange={(event) => {
                      const value = filterValue(active);
                      if (!value) return;
                      setFilter({ key: definition.key, operator: event.target.value as FilterOperator, value, label: definition.label }, definition.key);
                    }}
                  >
                    {moneyOperators.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </Select>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={filterValue(active)}
                    placeholder={definition.placeholder}
                    onChange={(event) => {
                      const value = event.target.value;
                      setFilter(
                        value ? { key: definition.key, operator, value, label: definition.label } : null,
                        definition.key
                      );
                    }}
                  />
                </div>
              </fieldset>
            );
          }

          return (
            <label key={definition.key} className="block space-y-1.5">
              <span className="text-xs font-medium text-muted">{definition.label}</span>
              <Input
                value={filterValue(active)}
                placeholder={definition.placeholder}
                onChange={(event) => {
                  const value = event.target.value;
                  setFilter(
                    value ? { key: definition.key, operator: 'contains', value, label: definition.label } : null,
                    definition.key
                  );
                }}
              />
            </label>
          );
        })}
      </div>

      <div className="mt-5 flex items-center justify-between gap-2 border-t border-border pt-4">
        <Button type="button" variant="ghost" onClick={() => setDraft([])}>{resolvedClearLabel}</Button>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button
            type="button"
            onClick={() => {
              onApply(draft);
              onClose();
            }}
          >
            {resolvedApplyLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
