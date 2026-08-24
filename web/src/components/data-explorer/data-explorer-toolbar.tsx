'use client';

import { ActiveFilterChips } from './active-filter-chips';
import { QuickFilters } from './quick-filters';
import { SearchBar } from './search-bar';
import type { ActiveFilter, FilterDefinition } from '@/lib/data-explorer/types';

interface DataExplorerToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  definitions: FilterDefinition[];
  filters: ActiveFilter[];
  onFilterChange: (filter: ActiveFilter) => void;
  onRemoveFilter: (key: string) => void;
  onClearFilters: () => void;
  onOpenAdvanced?: () => void;
  resultCount?: number;
  totalCount?: number;
}

export function DataExplorerToolbar({
  search,
  onSearchChange,
  searchPlaceholder,
  definitions,
  filters,
  onFilterChange,
  onRemoveFilter,
  onClearFilters,
  onOpenAdvanced,
  resultCount,
  totalCount,
}: DataExplorerToolbarProps) {
  return (
    <div className="space-y-3">
      <SearchBar
        value={search}
        onChange={onSearchChange}
        placeholder={searchPlaceholder}
      />

      <QuickFilters
        definitions={definitions}
        filters={filters}
        onChange={onFilterChange}
        onOpenAdvanced={onOpenAdvanced}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <ActiveFilterChips
          filters={filters}
          onRemove={onRemoveFilter}
          onClear={onClearFilters}
        />

        {typeof resultCount === 'number' ? (
          <p className="ms-auto text-xs text-muted" aria-live="polite">
            {typeof totalCount === 'number' && totalCount !== resultCount
              ? `${resultCount.toLocaleString('ar-SA')} من أصل ${totalCount.toLocaleString('ar-SA')}`
              : `${resultCount.toLocaleString('ar-SA')} نتيجة`}
          </p>
        ) : null}
      </div>
    </div>
  );
}
