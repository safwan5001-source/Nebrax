'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowUpDown, Download } from 'lucide-react';
import { ActiveFilterChips } from '@/components/data-explorer/active-filter-chips';
import { QuickFilters } from '@/components/data-explorer/quick-filters';
import { SearchBar } from '@/components/data-explorer/search-bar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { displayLocale } from '@/lib/formatting';
import type { ActiveFilter, FilterDefinition } from '@/lib/data-explorer/types';
import type { ListSortControl } from '@/components/nebrax';
import { cn } from '@/lib/utils';

function dateRange(filters: ActiveFilter[]): [string, string] {
  const active = filters.find((filter) => filter.key === 'invoice_date');
  if (!active || !Array.isArray(active.value)) return ['', ''];
  return [String(active.value[0] ?? ''), String(active.value[1] ?? '')];
}

/**
 * شريط اكتشاف قائمة الفواتير: بحث → تاريخ → عميل/حالة → المزيد.
 * محلي لهذه الشاشة عمداً حتى لا يُعمَّم ترتيب الفلاتر على قوائم أخرى.
 */
export function InvoicesListToolbar({
  search,
  onSearchChange,
  searchPlaceholder,
  searchLabel,
  dateLabel,
  definitions,
  filters,
  onFilterChange,
  onRemoveFilter,
  onClearFilters,
  onOpenAdvanced,
  sort,
  resultCount,
  onExport,
  exportDisabled,
  className,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  searchLabel: string;
  dateLabel: string;
  definitions: FilterDefinition[];
  filters: ActiveFilter[];
  onFilterChange: (filter: ActiveFilter) => void;
  onRemoveFilter: (key: string) => void;
  onClearFilters: () => void;
  onOpenAdvanced: () => void;
  sort: ListSortControl;
  resultCount: number;
  onExport: () => void;
  exportDisabled: boolean;
  className?: string;
}) {
  const t = useTranslations('nebrax');
  const ti = useTranslations('invoices');
  const locale = useLocale();
  const searchRef = useRef<HTMLInputElement>(null);
  const num = (value: number) => value.toLocaleString(displayLocale(locale));
  const mono = (chunks: ReactNode) => <span className="num">{chunks}</span>;
  const [from, to] = dateRange(filters);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== '/' || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return;
      }
      if (document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      searchRef.current?.focus();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  function setDatePart(part: 'from' | 'to', nextValue: string) {
    const nextFrom = part === 'from' ? nextValue : from;
    const nextTo = part === 'to' ? nextValue : to;
    onFilterChange({
      key: 'invoice_date',
      operator: 'between',
      value: [nextFrom, nextTo],
      label: dateLabel,
    });
  }

  return (
    <section
      aria-label={t('searchAndFilter')}
      className={cn('space-y-3 rounded border border-border bg-surface p-3 sm:p-4', className)}
    >
      <p className="sr-only">{ti('search_shortcut')}</p>
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <SearchBar
          value={search}
          onChange={onSearchChange}
          placeholder={searchPlaceholder}
          ariaLabel={searchLabel}
          inputRef={searchRef}
          keyShortcuts="/"
          className="min-w-0 lg:flex-1"
        />

        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
          <fieldset className="flex min-w-0 flex-wrap items-center gap-1.5">
            <legend className="sr-only">{dateLabel}</legend>
            <label className="flex min-w-0 items-center gap-1.5">
              <span className="shrink-0 text-xs text-muted">{t('from')}</span>
              <Input
                type="date"
                value={from}
                aria-label={`${dateLabel} — ${t('from')}`}
                onChange={(event) => setDatePart('from', event.target.value)}
                className="h-9 w-full min-w-[9.5rem] sm:w-[10.75rem]"
              />
            </label>
            <label className="flex min-w-0 items-center gap-1.5">
              <span className="shrink-0 text-xs text-muted">{t('to')}</span>
              <Input
                type="date"
                value={to}
                aria-label={`${dateLabel} — ${t('to')}`}
                onChange={(event) => setDatePart('to', event.target.value)}
                className="h-9 w-full min-w-[9.5rem] sm:w-[10.75rem]"
              />
            </label>
          </fieldset>

          <div className="flex items-center gap-2 sm:shrink-0">
            <ArrowUpDown className="hidden h-4 w-4 shrink-0 text-muted sm:block" strokeWidth={1.7} aria-hidden="true" />
            <Select
              value={sort.value}
              onChange={(event) => sort.onChange(event.target.value)}
              aria-label={sort.label ?? t('sortResults')}
              className="h-9 w-full bg-surface text-sm sm:w-48"
            >
              {sort.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <QuickFilters
          definitions={definitions}
          filters={filters}
          onChange={onFilterChange}
          onOpenAdvanced={onOpenAdvanced}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ms-auto h-9 gap-1.5"
          onClick={onExport}
          disabled={exportDisabled}
        >
          <Download className="h-3.5 w-3.5" strokeWidth={1.7} />
          {t('exportCsv')}
        </Button>
      </div>

      {filters.length > 0 || typeof resultCount === 'number' ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <ActiveFilterChips filters={filters} onRemove={onRemoveFilter} onClear={onClearFilters} />
          <p className="ms-auto text-xs text-muted" aria-live="polite">
            {t.rich('resultCount', { n: resultCount, count: num(resultCount), num: mono })}
          </p>
        </div>
      ) : null}
    </section>
  );
}
