'use client';

import * as React from 'react';
import { ArrowUpDown } from 'lucide-react';
import { ActiveFilterChips } from '@/components/data-explorer/active-filter-chips';
import { QuickFilters } from '@/components/data-explorer/quick-filters';
import { SearchBar } from '@/components/data-explorer/search-bar';
import { Select } from '@/components/ui/select';
import { ARABIC_DISPLAY_LOCALE } from '@/lib/formatting';
import type { ActiveFilter, FilterDefinition } from '@/lib/data-explorer/types';
import { cn } from '@/lib/utils';

export interface SortOption {
  value: string;
  label: string;
}

export interface ListSortControl {
  value: string;
  onChange: (value: string) => void;
  options: SortOption[];
  /** يُستخدم كتسمية وصول للحقل، ولا يظهر نصاً مكرراً على الجوال. */
  label?: string;
}

/**
 * شريط الاستعلام الموحّد لقوائم نبراكس: بحث، ترتيب، فلاتر سريعة، فلترة متقدمة،
 * ثم شرائح الفلاتر النشطة وعدّاد النتائج.
 *
 * كانت `/invoices` و`/products` تركّبان هذه العناصر نفسها بترتيبين مختلفين
 * وحاويتين مختلفتين؛ توحيدها هنا يزيل الانحراف من جذره لا من مظهره.
 */
export function ListToolbar({
  search,
  onSearchChange,
  searchPlaceholder,
  searchLabel,
  definitions,
  filters,
  onFilterChange,
  onRemoveFilter,
  onClearFilters,
  onOpenAdvanced,
  sort,
  resultCount,
  totalCount,
  countUnit = 'نتيجة',
  trailing,
  className,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  searchLabel?: string;
  definitions: FilterDefinition[];
  filters: ActiveFilter[];
  onFilterChange: (filter: ActiveFilter) => void;
  onRemoveFilter: (key: string) => void;
  onClearFilters: () => void;
  onOpenAdvanced?: () => void;
  sort?: ListSortControl;
  resultCount?: number;
  totalCount?: number;
  countUnit?: string;
  trailing?: React.ReactNode;
  className?: string;
}) {
  const hasQuickFilters = definitions.some((definition) => definition.quick) || Boolean(onOpenAdvanced);

  return (
    <section
      aria-label="أدوات البحث والفلترة"
      className={cn('space-y-3 rounded border border-border bg-surface p-3 sm:p-4', className)}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchBar
          value={search}
          onChange={onSearchChange}
          placeholder={searchPlaceholder}
          ariaLabel={searchLabel ?? 'بحث'}
          className="min-w-0 sm:flex-1"
        />

        {sort ? (
          <div className="flex items-center gap-2 sm:shrink-0">
            <ArrowUpDown className="hidden h-4 w-4 shrink-0 text-muted sm:block" strokeWidth={1.7} aria-hidden="true" />
            <Select
              value={sort.value}
              onChange={(event) => sort.onChange(event.target.value)}
              aria-label={sort.label ?? 'ترتيب النتائج'}
              className="h-10 w-full bg-surface text-sm sm:h-10 sm:w-48"
            >
              {sort.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
        ) : null}

        {trailing ? <div className="flex items-center gap-2 sm:shrink-0">{trailing}</div> : null}
      </div>

      {hasQuickFilters ? (
        <QuickFilters
          definitions={definitions}
          filters={filters}
          onChange={onFilterChange}
          onOpenAdvanced={onOpenAdvanced}
        />
      ) : null}

      {filters.length > 0 || typeof resultCount === 'number' ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <ActiveFilterChips filters={filters} onRemove={onRemoveFilter} onClear={onClearFilters} />

          {typeof resultCount === 'number' ? (
            <p className="ms-auto text-xs text-muted" aria-live="polite">
              {typeof totalCount === 'number' && totalCount !== resultCount
                ? `${resultCount.toLocaleString(ARABIC_DISPLAY_LOCALE)} من أصل ${totalCount.toLocaleString(ARABIC_DISPLAY_LOCALE)}`
                : `${resultCount.toLocaleString(ARABIC_DISPLAY_LOCALE)} ${countUnit}`}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
