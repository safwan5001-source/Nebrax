import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SORT,
  EMPTY_FILTERS,
  SORT_COLUMNS,
  activeFilterCount,
  hasPeriodInversion,
  parseListQuery,
  serializeListQuery,
} from './list-query';

const PARTNER = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';

describe('list query serialization (N1)', () => {
  it('sends nothing for the default state', () => {
    expect(serializeListQuery(EMPTY_FILTERS)).toBe('');
  });

  it('emits the exact server keys, status as an array and defaults only when asked', () => {
    const query = serializeListQuery({
      ...EMPTY_FILTERS,
      status: ['draft', 'closed'],
      partnerId: PARTNER,
      role: 'supplier',
      periodFrom: '2026-01-01',
      periodTo: '2026-03-31',
      branchId: BRANCH,
      q: ' نور ',
      sort: '-line_count',
      page: 3,
      perPage: 50,
    });
    const params = new URLSearchParams(query);
    expect(params.getAll('status[]')).toEqual(['draft', 'closed']);
    expect(params.get('partner_id')).toBe(PARTNER);
    expect(params.get('role')).toBe('supplier');
    expect(params.get('period_from')).toBe('2026-01-01');
    expect(params.get('period_to')).toBe('2026-03-31');
    expect(params.get('branch_id')).toBe(BRANCH);
    expect(params.get('q')).toBe('نور');
    expect(params.get('sort')).toBe('-line_count');
    expect(params.get('page')).toBe('3');
    expect(params.get('per_page')).toBe('50');

    const withDefaults = new URLSearchParams(serializeListQuery(EMPTY_FILTERS, { includeDefaults: true }));
    expect(withDefaults.get('sort')).toBe(DEFAULT_SORT);
    expect(withDefaults.get('page')).toBe('1');
    expect(withDefaults.get('per_page')).toBe('25');
  });

  it('never sends an inverted period (the server would answer 422)', () => {
    const filters = { ...EMPTY_FILTERS, periodFrom: '2026-05-01', periodTo: '2026-01-01' };
    expect(hasPeriodInversion(filters)).toBe(true);
    const params = new URLSearchParams(serializeListQuery(filters));
    expect(params.has('period_from')).toBe(false);
    expect(params.has('period_to')).toBe(false);
  });

  it('caps per_page at the server maximum', () => {
    const params = new URLSearchParams(serializeListQuery({ ...EMPTY_FILTERS, perPage: 500 }));
    expect(params.get('per_page')).toBe('50');
  });
});

describe('list query parsing (URL → state)', () => {
  it('round-trips a valid state', () => {
    const state = { ...EMPTY_FILTERS, status: ['reviewed' as const], partnerId: PARTNER, role: 'customer' as const, sort: 'partner_name', page: 2 };
    expect(parseListQuery(new URLSearchParams(serializeListQuery(state)))).toEqual(state);
  });

  it('drops every invalid value instead of forwarding it to the API', () => {
    const parsed = parseListQuery(new URLSearchParams(
      'status[]=hacked&status[]=draft&partner_id=not-a-uuid&role=admin&period_from=2026-02-30&branch_id=1&sort=password&page=-4&per_page=9999&q=' + 'x'.repeat(300),
    ));
    expect(parsed.status).toEqual(['draft']);
    expect(parsed.partnerId).toBe('');
    expect(parsed.role).toBe('');
    expect(parsed.periodFrom).toBe('');
    expect(parsed.branchId).toBe('');
    expect(parsed.sort).toBe(DEFAULT_SORT);
    expect(parsed.page).toBe(1);
    expect(parsed.perPage).toBe(25);
    expect(parsed.q).toHaveLength(100);
  });

  it('only whitelisted sort columns survive, in both directions', () => {
    for (const column of SORT_COLUMNS) {
      expect(parseListQuery(new URLSearchParams(`sort=${column}`)).sort).toBe(column);
      expect(parseListQuery(new URLSearchParams(`sort=-${column}`)).sort).toBe(`-${column}`);
    }
  });
});

describe('active filter count', () => {
  it('counts filters but not sort or paging', () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...EMPTY_FILTERS, sort: 'status', page: 4, perPage: 50 })).toBe(0);
    expect(activeFilterCount({ ...EMPTY_FILTERS, status: ['draft'], q: 'x', periodFrom: '2026-01-01', periodTo: '2026-02-01' })).toBe(3);
  });
});
