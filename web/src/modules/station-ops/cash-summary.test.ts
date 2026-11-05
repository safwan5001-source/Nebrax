import { describe, expect, it } from 'vitest';
import ar from '@/messages/ar.json';
import en from '@/messages/en.json';
import { buildCashSummaryView, cashSummarySchema, type CashSummary } from './cash-summary';

const base = (over: Partial<CashSummary> = {}): CashSummary => ({
  state: 'live',
  basis: 'receiving_shift_receipts',
  components: {
    opening_float_minor: 20_000,
    official_cash_receipts: { available: true, amount_minor: 100_000, count: 3, reason: null },
    cash_in_minor: 0,
    cash_out_minor: 10_000,
    treasury_handover_minor: 10_000,
    expenses_minor: 500,
  },
  expected_cash_minor: 109_500,
  expected_cash_partial_minor: 109_500,
  expected_complete: true,
  incompleteness: [],
  counted_cash_minor: null,
  variance_minor: null,
  variance_final: false,
  network_receipts: { available: true, amount_minor: 40_000, reason: null, information_only: true },
  unattributed_cash_receipts: { count: 0, amount_minor: 0 },
  post_close_adjustments: { available: true, items: [], net_effect_minor: 0 },
  ...over,
});

describe('cash summary contract', () => {
  it('accepts the server shape and rejects a malformed one entirely', () => {
    expect(cashSummarySchema.safeParse(base()).success).toBe(true);
    expect(cashSummarySchema.safeParse({ ...base(), expected_complete: 'yes' }).success).toBe(false);
    expect(cashSummarySchema.safeParse({ ...base(), basis: 'something_else' }).success).toBe(false);
  });
});

describe('buildCashSummaryView', () => {
  it('shows the complete expected as a total and the example 200 + 1000 − 100 − 5 breakdown without double counting', () => {
    const view = buildCashSummaryView(base());
    expect(view.expected).toEqual({ kind: 'total', amountMinor: 109_500 });
    const amounts = Object.fromEntries(view.rows.map((row) => [row.key, row.amountMinor]));
    expect(amounts).toEqual({ opening: 20_000, sales: 100_000, cashIn: 0, handover: 10_000, otherOut: 0, expenses: 500 });
    // التسليم جزء من الصادر: «الصادر الآخر» = الصادر − التسليم فلا يُطرح مرتين.
    const signed = view.rows.reduce((sum, row) => sum + row.sign * (row.amountMinor ?? 0), 0);
    expect(signed).toBe(109_500);
  });

  it('an incomplete expectation is labelled partial and never a total', () => {
    const view = buildCashSummaryView(base({ expected_complete: false, expected_cash_minor: null, expected_cash_partial_minor: 20_000, incompleteness: ['sales_cash_not_included'], basis: 'movements_only' }));
    expect(view.expected).toEqual({ kind: 'partial', amountMinor: 20_000 });
    expect(view.gaps).toEqual(['sales_cash_not_included']);
  });

  it('a variance is named overage/shortage/matches only when the server says it is final', () => {
    const final = (variance: number) => buildCashSummaryView(base({ counted_cash_minor: 1, variance_minor: variance, variance_final: true })).variance;
    expect(final(500)).toEqual({ kind: 'final', direction: 'overage', amountMinor: 500 });
    expect(final(-500)).toEqual({ kind: 'final', direction: 'shortage', amountMinor: 500 });
    expect(final(0)).toEqual({ kind: 'final', direction: 'none', amountMinor: 0 });
    const provisional = buildCashSummaryView(base({ expected_complete: false, expected_cash_minor: null, counted_cash_minor: 1, variance_minor: -500, variance_final: false })).variance;
    expect(provisional).toEqual({ kind: 'provisional', amountMinor: 500 });
  });

  it('a counted shift whose variance the viewer may not see is "hidden", not "not counted"', () => {
    const view = buildCashSummaryView(base({ counted_cash_minor: 5_000, variance_minor: null, variance_final: false }));
    expect(view.variance).toBeNull();
    expect(view.varianceHidden).toBe(true);
    expect(buildCashSummaryView(base()).varianceHidden).toBe(false);
  });

  it('an uncounted shift has no variance at all (not zero)', () => {
    expect(buildCashSummaryView(base()).variance).toBeNull();
    expect(buildCashSummaryView(base()).countedMinor).toBeNull();
  });

  it('an unavailable component keeps its reason and is never turned into zero', () => {
    const view = buildCashSummaryView(base({
      components: { ...base().components, official_cash_receipts: { available: false, amount_minor: null, count: null, reason: 'permission' } },
      network_receipts: { available: false, amount_minor: null, reason: 'basis_not_enabled', information_only: true },
    }));
    const sales = view.rows.find((row) => row.key === 'sales')!;
    expect(sales.amountMinor).toBeNull();
    expect(sales.unavailable).toBe('permission');
    expect(view.network).toEqual({ amountMinor: null, unavailable: 'basis_not_enabled' });
  });

  it('an unknown reason code degrades to a neutral "unavailable"', () => {
    const view = buildCashSummaryView(base({ components: { ...base().components, official_cash_receipts: { available: false, amount_minor: null, count: null, reason: 'brand_new_code' } } }));
    expect(view.rows.find((row) => row.key === 'sales')!.unavailable).toBe('unknown');
  });

  it('surfaces unattributed collections and post-close reversals only when they exist', () => {
    expect(buildCashSummaryView(base()).unattributed).toBeNull();
    expect(buildCashSummaryView(base()).adjustments).toBeNull();
    const view = buildCashSummaryView(base({
      state: 'frozen',
      unattributed_cash_receipts: { count: 2, amount_minor: 5_000 },
      post_close_adjustments: { available: true, items: [{ payment_id: 'p1', amount_minor: 300, occurred_at: null }], net_effect_minor: -300 },
    }));
    expect(view.frozen).toBe(true);
    expect(view.unattributed).toEqual({ count: 2, amountMinor: 5_000 });
    expect(view.adjustments).toEqual({ count: 1, netEffectMinor: -300 });
  });
});

describe('cash summary copy', () => {
  type Tree = { [key: string]: string | Tree };
  const flat = (tree: Tree, prefix = ''): string[] => Object.entries(tree).flatMap(([key, value]) => (typeof value === 'string' ? [`${prefix}${key}`] : flat(value, `${prefix}${key}.`)));
  const arTree = (ar as unknown as { stationOps: { shiftDetail: { cashSummary: Tree } } }).stationOps.shiftDetail.cashSummary;
  const enTree = (en as unknown as { stationOps: { shiftDetail: { cashSummary: Tree } } }).stationOps.shiftDetail.cashSummary;

  it('Arabic and English define the same keys, including every gap and reason code the server can send', () => {
    expect(flat(arTree).sort()).toEqual(flat(enTree).sort());
    for (const code of ['sales_cash_not_included', 'permission_sales_view', 'unattributed_cash_receipts', 'multiple_cash_accounts', 'legacy_closed_snapshot', 'unknown']) {
      expect(flat(enTree)).toContain(`gap.${code}`);
    }
    for (const code of ['permission', 'basis_not_enabled', 'not_recorded_legacy', 'unknown']) expect(flat(enTree)).toContain(`unavailable.${code}`);
  });

  it('the placeholders match between languages', () => {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    const arFlat = Object.fromEntries(flat(arTree).map((key) => [key, key.split('.').reduce<unknown>((node, part) => (node as Tree)[part], arTree) as string]));
    const enFlat = Object.fromEntries(flat(enTree).map((key) => [key, key.split('.').reduce<unknown>((node, part) => (node as Tree)[part], enTree) as string]));
    for (const key of Object.keys(enFlat)) expect(placeholders(arFlat[key])).toEqual(placeholders(enFlat[key]));
  });
});
