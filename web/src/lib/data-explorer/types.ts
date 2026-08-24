export type FilterKind =
  | 'text'
  | 'number'
  | 'money'
  | 'date'
  | 'dateRange'
  | 'select'
  | 'multiSelect'
  | 'boolean'
  | 'entity';

export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'contains'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'in';

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterDefinition {
  key: string;
  label: string;
  kind: FilterKind;
  quick?: boolean;
  operators?: FilterOperator[];
  options?: FilterOption[];
  placeholder?: string;
}

export type FilterScalar = string | number | boolean;

export interface ActiveFilter {
  key: string;
  operator: FilterOperator;
  value: FilterScalar | FilterScalar[];
  label?: string;
}

export interface DataExplorerState {
  search: string;
  filters: ActiveFilter[];
  sort?: string;
  page?: number;
  perPage?: number;
}
