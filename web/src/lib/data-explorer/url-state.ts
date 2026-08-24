import type { ActiveFilter, DataExplorerState, FilterScalar } from './types';

const FILTER_PREFIX = 'f.';

function serializeValue(value: FilterScalar | FilterScalar[]): string {
  if (Array.isArray(value)) return value.map(String).join(',');
  return String(value);
}

function parseValue(raw: string): FilterScalar | FilterScalar[] {
  if (raw.includes(',')) return raw.split(',').filter(Boolean);
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return raw;
}

export function serializeExplorerState(state: DataExplorerState): URLSearchParams {
  const params = new URLSearchParams();

  if (state.search.trim()) params.set('q', state.search.trim());
  if (state.sort) params.set('sort', state.sort);
  if (state.page && state.page > 1) params.set('page', String(state.page));
  if (state.perPage) params.set('per_page', String(state.perPage));

  for (const filter of state.filters) {
    params.set(
      `${FILTER_PREFIX}${filter.key}`,
      `${filter.operator}:${serializeValue(filter.value)}`
    );
  }

  return params;
}

export function parseExplorerState(params: URLSearchParams): DataExplorerState {
  const filters: ActiveFilter[] = [];

  params.forEach((raw, key) => {
    if (!key.startsWith(FILTER_PREFIX)) return;

    const separator = raw.indexOf(':');
    if (separator <= 0) return;

    const operator = raw.slice(0, separator) as ActiveFilter['operator'];
    const value = parseValue(raw.slice(separator + 1));

    filters.push({
      key: key.slice(FILTER_PREFIX.length),
      operator,
      value,
    });
  });

  const page = Number(params.get('page') ?? '1');
  const perPage = Number(params.get('per_page') ?? '0');

  return {
    search: params.get('q') ?? '',
    filters,
    sort: params.get('sort') ?? undefined,
    page: Number.isFinite(page) && page > 0 ? page : 1,
    perPage: Number.isFinite(perPage) && perPage > 0 ? perPage : undefined,
  };
}

export function replaceFilter(
  filters: ActiveFilter[],
  next: ActiveFilter
): ActiveFilter[] {
  return [...filters.filter((filter) => filter.key !== next.key), next];
}

export function removeFilter(filters: ActiveFilter[], key: string): ActiveFilter[] {
  return filters.filter((filter) => filter.key !== key);
}
