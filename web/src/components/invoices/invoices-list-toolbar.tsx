'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowUpDown, Download, SlidersHorizontal } from 'lucide-react';
import { ActiveFilterChips } from '@/components/data-explorer/active-filter-chips';
import { QuickFilters } from '@/components/data-explorer/quick-filters';
import { SearchBar } from '@/components/data-explorer/search-bar';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
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

function StatusFilter({
  definitions,
  filters,
  onFilterChange,
  className,
}: {
  definitions: FilterDefinition[];
  filters: ActiveFilter[];
  onFilterChange: (filter: ActiveFilter) => void;
  className?: string;
}) {
  const definition = definitions.find((item) => item.key === 'status');
  if (!definition?.options?.length) return null;
  const active = filters.find((filter) => filter.key === 'status');
  const value = active && !Array.isArray(active.value) ? String(active.value) : '';

  return (
    <Select
      value={value}
      onChange={(event) =>
        onFilterChange({
          key: definition.key,
          operator: 'eq',
          value: event.target.value,
          label: definition.label,
        })
      }
      aria-label={definition.label}
      className={cn('h-9 w-auto min-w-[7.5rem] bg-surface text-sm', className)}
    >
      <option value="">{definition.label}</option>
      {definition.options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </Select>
  );
}

function DateRangeFields({
  dateLabel,
  fromLabel,
  toLabel,
  from,
  to,
  onFrom,
  onTo,
  stacked = false,
}: {
  dateLabel: string;
  fromLabel: string;
  toLabel: string;
  from: string;
  to: string;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;
  stacked?: boolean;
}) {
  return (
    <fieldset className={cn('flex min-w-0 items-center gap-1.5', stacked && 'w-full flex-col items-stretch sm:flex-row sm:items-center')}>
      <legend className="sr-only">{dateLabel}</legend>
      <label className="flex min-w-0 items-center gap-1.5">
        <span className="shrink-0 text-xs text-muted">{fromLabel}</span>
        <Input
          type="date"
          value={from}
          aria-label={`${dateLabel} — ${fromLabel}`}
          onChange={(event) => onFrom(event.target.value)}
          className="h-9 w-[9.75rem]"
        />
      </label>
      <label className="flex min-w-0 items-center gap-1.5">
        <span className="shrink-0 text-xs text-muted">{toLabel}</span>
        <Input
          type="date"
          value={to}
          aria-label={`${dateLabel} — ${toLabel}`}
          onChange={(event) => onTo(event.target.value)}
          className="h-9 w-[9.75rem]"
        />
      </label>
    </fieldset>
  );
}

/**
 * شريط اكتشاف قائمة الفواتير: سطح مكتب صف واحد ملتصق بالجدول؛
 * جوال بحث + فلاتر في حوار محلي. محلي لهذه الشاشة عمداً.
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
  columnMenu,
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
  columnMenu?: ReactNode;
  className?: string;
}) {
  const t = useTranslations('nebrax');
  const ti = useTranslations('invoices');
  const locale = useLocale();
  const searchRef = useRef<HTMLInputElement>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
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

  function openAdvancedFromSheet() {
    setFiltersOpen(false);
    onOpenAdvanced();
  }

  const sortControl = (
    <div className="flex min-w-0 items-center gap-1.5">
      <ArrowUpDown className="hidden h-3.5 w-3.5 shrink-0 text-muted lg:block" strokeWidth={1.7} aria-hidden="true" />
      <Select
        value={sort.value}
        onChange={(event) => sort.onChange(event.target.value)}
        aria-label={sort.label ?? t('sortResults')}
        className="h-9 w-full bg-surface text-sm lg:w-44"
      >
        {sort.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </div>
  );

  const exportButton = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-9 gap-1.5"
      onClick={onExport}
      disabled={exportDisabled}
    >
      <Download className="h-3.5 w-3.5" strokeWidth={1.7} />
      {t('exportCsv')}
    </Button>
  );

  const advancedButton = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={filtersOpen ? openAdvancedFromSheet : onOpenAdvanced}
      className="h-9 gap-1.5"
    >
      <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1.7} />
      {t('advancedFilters')}
    </Button>
  );

  const resultLabel = (
    <p className="text-xs text-muted" aria-live="polite">
      {t.rich('resultCount', { n: resultCount, count: num(resultCount), num: mono })}
    </p>
  );

  return (
    <section aria-label={t('searchAndFilter')} className={cn(className)}>
      <p className="sr-only">{ti('search_shortcut')}</p>
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
        <SearchBar
          value={search}
          onChange={onSearchChange}
          placeholder={searchPlaceholder}
          ariaLabel={searchLabel}
          inputRef={searchRef}
          keyShortcuts="/"
          inputClassName="h-9"
          className="min-w-[12rem] flex-1 basis-48"
        />

        <div className="hidden lg:contents">
          <DateRangeFields
            dateLabel={dateLabel}
            fromLabel={t('from')}
            toLabel={t('to')}
            from={from}
            to={to}
            onFrom={(value) => setDatePart('from', value)}
            onTo={(value) => setDatePart('to', value)}
          />
          <QuickFilters
            definitions={definitions}
            filters={filters}
            onChange={onFilterChange}
            className="contents"
          />
          {sortControl}
          {exportButton}
          {advancedButton}
          {columnMenu ? <div className="hidden lg:block">{columnMenu}</div> : null}
          {resultLabel}
        </div>

        <StatusFilter
          definitions={definitions}
          filters={filters}
          onFilterChange={onFilterChange}
          className="hidden max-w-[8.5rem] sm:block lg:hidden"
        />

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 shrink-0 gap-1.5 lg:hidden"
          onClick={() => setFiltersOpen(true)}
          aria-haspopup="dialog"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
          {ti('filters')}
          {filters.length > 0 ? (
            <span className="num inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-medium text-primary-foreground">
              {filters.length}
            </span>
          ) : null}
        </Button>
      </div>

      {filters.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-1.5">
          <ActiveFilterChips filters={filters} onRemove={onRemoveFilter} onClear={onClearFilters} />
          <div className="ms-auto lg:hidden">{resultLabel}</div>
        </div>
      ) : null}

      <Dialog open={filtersOpen} onClose={() => setFiltersOpen(false)} title={ti('filters')}>
        <div className="space-y-3">
          <DateRangeFields
            dateLabel={dateLabel}
            fromLabel={t('from')}
            toLabel={t('to')}
            from={from}
            to={to}
            onFrom={(value) => setDatePart('from', value)}
            onTo={(value) => setDatePart('to', value)}
            stacked
          />
          <QuickFilters
            definitions={definitions}
            filters={filters}
            onChange={onFilterChange}
          />
          {sortControl}
          <div className="flex flex-wrap items-center gap-2">
            {exportButton}
            {advancedButton}
          </div>
          {filters.length > 0 ? (
            <ActiveFilterChips filters={filters} onRemove={onRemoveFilter} onClear={onClearFilters} />
          ) : null}
          {resultLabel}
        </div>
      </Dialog>
    </section>
  );
}
