/** معطيات اختبار واجهات تقارير سندات التعبئة (استجابات الخادم كما تصل بالضبط). */
export const STATION_ID = '00000000-0000-4000-8000-0000000000a1';
export const OWNER_ID = '00000000-0000-4000-8000-0000000000b1';
export const FILL_A = '00000000-0000-4000-8000-0000000000f1';
export const FILL_B = '00000000-0000-4000-8000-0000000000f2';
export const FILL_C = '00000000-0000-4000-8000-0000000000f3';
export const ACCOUNT_1145 = '11111111-2222-4333-8444-555555555551';
export const ACCOUNT_1140 = '11111111-2222-4333-8444-555555555552';

export const meta = (report: string, over: Record<string, unknown> = {}) => ({
  report, read_only: true, generated_at: '2027-02-01T08:00:00+03:00', filters: {}, scan_limit: 2000,
  row_scope: { station_restricted: false, branch_restricted: false }, balance_filters_not_applicable: [], ...over,
});

const station = { id: STATION_ID, name: 'محطة الدمام' };
const owner = { id: OWNER_ID, name: 'عسكر' };

export const fillsRow = (over: Record<string, unknown> = {}) => ({
  id: FILL_A, number: 'FTF-2027-00001', voucher_number: '04052', recorded_at: '2027-01-26T09:00:00+03:00', status: 'recorded', inventory_status: 'posted',
  station, owner, tanker: { id: 't1', plate_number: 'أ ب ج 1234' }, fuel_product: { id: 'p1', name: 'ديزل' }, quantity_milliliters: 12_000_000,
  posting_status: 'posted', posted_at: '2027-01-27T08:00:00+03:00', reversed_at: null,
  posted_cost_minor: 2_616_000, stock_movement_id: 'aaaaaaaa-1111-4111-8111-111111111111', cost_movement_id: 'bbbbbbbb-2222-4222-8222-222222222222',
  journal_entry: { id: 'je1', number: 'JE-2027-00042' }, reversal_journal_entry: null, ...over,
});

/** مستخدم بلا `products.view_cost`: الخادم يحذف المفاتيح المالية من الصف نفسه. */
export const fillsRowNoCost = (over: Record<string, unknown> = {}) => {
  const row = fillsRow(over) as Record<string, unknown>;
  for (const key of ['posted_cost_minor', 'stock_movement_id', 'cost_movement_id', 'journal_entry', 'reversal_journal_entry']) delete row[key];
  return row;
};

export const fillsReport = (rows: unknown[] = [fillsRow(), fillsRow({ id: FILL_B, number: 'FTF-2027-00002', voucher_number: '00077', inventory_status: 'pending_integration', posting_status: null, posted_at: null, posted_cost_minor: undefined })], over: Record<string, unknown> = {}, metaOver: Record<string, unknown> = {}) => ({
  data: {
    rows,
    summary: {
      total_count: rows.length, total_quantity_milliliters: 14_000_000,
      by_state: [
        { status: 'recorded', inventory_status: 'posted', count: 1, quantity_milliliters: 12_000_000 },
        { status: 'recorded', inventory_status: 'pending_integration', count: 1, quantity_milliliters: 2_000_000 },
      ],
    },
    pagination: { page: 1, per_page: 25, total: rows.length, last_page: 1 },
    masking: { costs: false, accounts: false }, ...over,
  },
  meta: meta('fills', metaOver),
});

export const finding = (code: string, severity: 'error' | 'warning' | 'info' = 'error') => ({ code, severity });

const quantities = (over: Record<string, unknown> = {}) => ({
  fill: 12_000_000, stock_out: 12_000_000, cost_issue: 12_000_000, ledger: -12_000_000, stock_reversal_in: null, cost_reversal: null, ledger_reversal: null, ...over,
});
const values = (over: Record<string, unknown> = {}) => ({
  posting_cost_minor: 2_616_000, stock_total_cost_minor: 2_616_000, cost_movement_minor: 2_616_000, entry_debit_minor: 2_616_000, entry_credit_minor: 2_616_000, ledger_value_minor: -2_616_000,
  reversal_entry_debit_minor: null, reversal_entry_credit_minor: null, ...over,
});

export const reconRow = (over: Record<string, unknown> = {}) => ({
  fill_id: FILL_A, number: 'FTF-2027-00001', voucher_number: '04052', station_id: STATION_ID, inventory_status: 'posted', posting_status: 'posted',
  quantities: quantities(), values: values(), findings: [], result: 'matched', ...over,
});

export const poolPayload = (over: Record<string, unknown> = {}) => ({
  read_only: true, status: 'consistent',
  quantity: { pools: [{ warehouse_name: 'مخزن الدمام', fuel_product_name: 'ديزل', stock_milliliters: 40_000_000, cost_pool_milliliters: 40_000_000, quantity_difference_milliliters: 0, findings: [], cost_pool_value_minor: 8_840_000, state_vs_movements_value_minor: 0 }], summary: { pools: 1, in_sync: 1, mismatched: 0 } },
  value_scope: 'tenant_by_branch',
  value: { branches: [{ branch_name: 'الفرع الرئيسي', pool_value_minor: 8_840_000, ledger_share_minor: 8_840_000, difference_minor: 0, in_sync: true, unexplained_minor: 0, movements_without_journal_count: 0, causes: {} }], entries_with_amount_difference: { total: 0, sample: [] } },
  inventory_accounts: { accounts: [{ code: '1140', name: 'المخزون', sources: ['role_current'] }], unlisted_asset_accounts: [], split_in_ledger: false, station_overrides: [] },
  findings: [], data_quality: { complete: true, not_checked: ['price_and_average_correctness'] }, ...over,
});

export const reconReport = (rows: unknown[] = [
  reconRow(),
  reconRow({ fill_id: FILL_B, number: 'FTF-2027-00002', voucher_number: '00077', quantities: quantities({ stock_out: 11_000_000 }), findings: [finding('stock_quantity_mismatch')], result: 'mismatch' }),
  reconRow({ fill_id: FILL_C, number: 'FTF-2027-00003', voucher_number: null, inventory_status: 'pending_integration', posting_status: null, quantities: quantities({ stock_out: null, cost_issue: null, ledger: null }), values: values({ posting_cost_minor: null }), findings: [finding('not_posted_yet', 'info')], result: 'incomplete' }),
], over: Record<string, unknown> = {}, metaOver: Record<string, unknown> = {}) => ({
  data: {
    rows, summary: { total: rows.length, matched: 1, confirmed_differences: 1, warnings: 0, incomplete: 1, quantity_totals: { fills_posted_milliliters: 24_000_000, stock_out_milliliters: 23_000_000, cost_issue_milliliters: 24_000_000, ledger_milliliters: 24_000_000, reversed_milliliters: 0 } },
    pool: poolPayload(), truncated: false, masking: { costs: false }, ...over,
  },
  meta: meta('inventory-reconciliation', metaOver),
});

export const clearingAccountRow = (over: Record<string, unknown> = {}) => ({
  account: { id: ACCOUNT_1145, code: '1145', name: 'تعبئة صهاريج — وسيط', is_current: true },
  opening_balance_minor: 0, period_debits_minor: 2_616_000, period_credits_minor: 0, closing_balance_minor: 2_616_000,
  tanker: { debits_minor: 2_616_000, credits_minor: 0, net_all_time_minor: 2_616_000 }, other: { debits_minor: 0, credits_minor: 0, net_all_time_minor: 0 },
  supported_balance_minor: 2_616_000, unexplained_difference_minor: 0, other_entries: [], findings: [], ...over,
});

export const scope = (over: Record<string, unknown> = {}) => ({
  level: 'organization', branch_ids: null, station_restricted: false, basis: 'ledger_lines_by_branch', filters_applied: ['period'],
  filters_not_applicable: ['station_id', 'owner_id', 'fuel_product_id', 'status', 'inventory_status'], ...over,
});

export const clearingReport = (accounts: unknown[] = [clearingAccountRow()], over: Record<string, unknown> = {}, metaOver: Record<string, unknown> = {}) => ({
  data: { period: { from: '2027-01-01', to: '2027-01-31' }, accounts, scope: scope(), ...over },
  meta: meta('clearing-account', metaOver),
});

export const controlRow = (over: Record<string, unknown> = {}) => ({
  fill_id: FILL_A, number: 'FTF-2027-00001', voucher_number: '04052', recorded_at: '2027-01-26T09:00:00+03:00', station_id: STATION_ID, owner_name: 'عسكر', fuel_product_id: 'p1',
  quantity_milliliters: 12_000_000, status: 'recorded', inventory_status: 'posted', posting_status: 'posted', quantities: quantities(), values: values(),
  chain: { stock_movement_id: 'aaaaaaaa-1111-4111-8111-111111111111', cost_movement_id: 'bbbbbbbb-2222-4222-8222-222222222222', journal_entry: { id: 'je1', number: 'JE-2027-00042', status: 'posted' }, reversal_stock_movement_id: null, reversal_cost_movement_id: null, reversal_journal_entry: null },
  accounts: { clearing_account_id: ACCOUNT_1145, inventory_account_id: ACCOUNT_1140 }, findings: [], result: 'matched', ...over,
});

export const controlReport = (rows: unknown[] = [
  controlRow(),
  controlRow({ fill_id: FILL_B, number: 'FTF-2027-00002', voucher_number: '00077', findings: [finding('ledger_missing')], result: 'mismatch', quantities: quantities({ ledger: null }) }),
], clearing: Record<string, unknown> | null = null, over: Record<string, unknown> = {}, metaOver: Record<string, unknown> = {}) => ({
  data: {
    rows,
    summary: { total: rows.length, matched: 1, confirmed_differences: 1, warnings: 0, incomplete: 0, findings_by_code: [{ code: 'ledger_missing', severity: 'error', count: 1 }] },
    clearing: clearing ?? { available: true, reason: null, period: { from: '2027-01-01', to: '2027-01-31' }, scope: scope(), accounts: [{ account: clearingAccountRow().account, closing_balance_minor: 2_616_000, supported_balance_minor: 2_616_000, unexplained_difference_minor: 0, findings: [] }] },
    truncated: false, masking: { costs: false, accounts: false }, ...over,
  },
  meta: meta('accounting-control', metaOver),
});
