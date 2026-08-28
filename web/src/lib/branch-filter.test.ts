import { describe, expect, it } from 'vitest';
import type { Branch } from './branch';
import { branchFilterDefinition } from './branch-filter';
import { branchFilterValue } from './branch-scoped-lookup';

const branches: Branch[] = [
  { id: 'branch-1', code: 'B1', name: 'الفرع 1', is_main: true, is_active: true },
  { id: 'branch-2', code: 'B2', name: 'الفرع 2', is_main: false, is_active: true },
];

describe('branch filter', () => {
  it('shows all branches then branch names only', () => {
    const definition = branchFilterDefinition(branches, 'الفرع 1');

    expect(definition.emptyOptionLabel).toBe('الفرع النشط: الفرع 1');
    expect(definition.searchPlaceholder).toBe('ابحث عن فرع');
    expect(definition.options).toEqual([
      { value: 'all', label: 'كل الفروع' },
      { value: 'branch-1', label: 'الفرع 1' },
      { value: 'branch-2', label: 'الفرع 2' },
    ]);
    expect(definition.options?.some((option) => 'sub' in option || 'hint' in option)).toBe(false);
  });

  it('reads only the page branch filter value', () => {
    expect(branchFilterValue([])).toBe('');
    expect(branchFilterValue([{ key: 'branch', operator: 'eq', value: 'all' }])).toBe('all');
    expect(branchFilterValue([
      { key: 'status', operator: 'eq', value: 'posted' },
      { key: 'branch', operator: 'eq', value: 'branch-2' },
    ])).toBe('branch-2');
  });
});
