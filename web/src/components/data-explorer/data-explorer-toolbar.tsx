'use client';

import { ListToolbar } from '@/components/nebrax/list-toolbar';
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

/**
 * واجهة توافق للصفحات التي سبقت `ListToolbar`.
 * تبقى دلالات البحث والفلاتر ملكاً للصفحة، بينما يُوحّد العرض والعداد والترجمة.
 */
export function DataExplorerToolbar(props: DataExplorerToolbarProps) {
  return <ListToolbar {...props} />;
}
