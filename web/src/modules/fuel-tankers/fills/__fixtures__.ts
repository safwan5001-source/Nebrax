/** معطيات اختبار مساحة عمل الدمج المخزني (استجابات الخادم كما تصل بالضبط). */
export const FILL_ID = '00000000-0000-4000-8000-0000000000f1';
export const FILL_ID_2 = '00000000-0000-4000-8000-0000000000f2';
export const STATION_ID = '00000000-0000-4000-8000-0000000000a1';
export const ACCOUNT_CLEARING = '11111111-2222-4333-8444-555555555551';
export const ACCOUNT_INVENTORY = '11111111-2222-4333-8444-555555555552';

export const fillResource = (over: Record<string, unknown> = {}) => ({
  id: FILL_ID, number: 'FTF-2027-00001', voucher_number: '04052', status: 'recorded', inventory_status: 'pending_integration', fuel_station_id: STATION_ID,
  fuel_product_id: 'p1', quantity_milliliters: 2_000_000, quantity_liters: '2000.000', recorded_at: '2027-01-26T09:00:00+03:00', voided_at: null, void_reason: null, notes: null,
  owner: { id: 'o1', name: 'عسكر', code: 'ASK' }, tanker: { id: 't1', plate_number: 'أ ب ج 1234', capacity_milliliters: 3_000_000 }, attachments_count: 0,
  created_at: '2027-01-26T09:00:00+03:00', ...over,
});

export const attemptSummary = (over: Record<string, unknown> = {}) => ({ operation: 'post', outcome: 'rejected', reason_code: 'insufficient_stock', attempted_at: '2027-01-26T10:00:00+03:00', ...over });

export const row = (over: Record<string, unknown> = {}, inventory: Record<string, unknown> | null = null, readiness: Record<string, unknown> | null = null) => ({
  ...fillResource(over),
  inventory: inventory ?? { posting_status: null, posted_at: null, reversed_at: null, posted_cost_minor: null, last_attempt: null, attempts_count: 0 },
  readiness,
});

export const workspace = (rows: unknown[], counts: Partial<Record<'pending' | 'posted' | 'reversed' | 'attention', number>> = {}, meta: Record<string, unknown> = {}) => ({
  data: rows,
  meta: { tab: 'pending', page: 1, per_page: 20, total: rows.length, last_page: 1, counts: { pending: rows.length, posted: 0, reversed: 0, attention: 0, ...counts }, posting_enabled: true, ...meta },
});

export const readyReadiness = (over: Record<string, unknown> = {}) => ({ readiness: 'ready', blockers: [], review_reasons: [], overdue: false, historical: false, age_hours: 2, ...over });

export const postingFacts = (over: Record<string, unknown> = {}) => ({
  id: 'post-1', status: 'posted', quantity_milliliters: 2_000_000, posted_by: { id: 'u1', name: 'ماجد' }, posted_at: '2027-01-27T08:00:00+03:00', reversed_by: null, reversed_at: null, reversal_reason: null,
  posted_cost_minor: 654_321, journal_entry: { id: 'je1', number: 'JE-2027-00042' }, reversal_journal_entry: null,
  stock_movement_id: 'aaaaaaaa-1111-4111-8111-111111111111', cost_movement_id: 'bbbbbbbb-2222-4222-8222-222222222222', reversal_stock_movement_id: null, reversal_cost_movement_id: null, ...over,
});

export const actions = (over: Record<string, boolean> = {}) => ({ preview_post: true, post: true, post_historical: false, preview_reversal: false, reverse: false, ...over });

export const detail = (over: Record<string, unknown> = {}, inventory: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  data: {
    ...fillResource(over),
    inventory: { status: (over.inventory_status as string | undefined) ?? 'pending_integration', posting: null, accounts: null, attempts: [], ...inventory },
    readiness: null,
    actions: actions(),
    ...extra,
  },
  meta: { posting_enabled: true },
});

export const postingPreview = (over: Record<string, unknown> = {}) => ({
  data: {
    fill_id: FILL_ID, status: 'postable', blockers: [], historical: false, requires: { permission: 'fuel.tanker.fill.inventory.post', historical_permission: 'fuel.tanker.fill.inventory.post_historical' },
    cost_recognition: 'clearing_until_invoice', variance_policy: 'block',
    entry: { lines: [{ side: 'debit', account_id: ACCOUNT_CLEARING, role: 'tanker_issue_clearing' }, { side: 'credit', account_id: ACCOUNT_INVENTORY, role: 'inventory' }], entry_date: '2027-01-26', amount_minor: 654_321 },
    ...over,
  },
});

export const reversalPreview = (over: Record<string, unknown> = {}) => ({
  data: {
    fill_id: FILL_ID, status: 'reversible', posting_status: 'posted', blockers: [], quantity_milliliters: 2_000_000, reversal_date: '2027-02-01', valuation: 'historical_cost',
    requires: { permission: 'fuel.tanker.fill.inventory.reverse', reason: true },
    entry: { lines: [{ side: 'debit', account_id: ACCOUNT_INVENTORY }, { side: 'credit', account_id: ACCOUNT_CLEARING }], entry_date: '2027-02-01', amount_minor: 654_321 },
    ...over,
  },
});

export const writeOk = (inventoryStatus: string, replayed = false) => ({ data: fillResource({ inventory_status: inventoryStatus }), meta: { replayed, posting: {} } });
