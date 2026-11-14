import { describe, expect, it } from 'vitest';
import { isKnownBlocker, isKnownFinding, isKnownReason, litersOf, readReadiness, readReconciliation, readReview } from './logic';

describe('readReadiness is defensive and fails closed', () => {
  it('maps a full item', () => {
    expect(readReadiness({ readiness: 'blocked', blockers: ['insufficient_balance'], review_reasons: [], overdue: true, age_hours: 30, pool: { available_milliliters: 500, cumulative_milliliters: 900 } })).toEqual({
      readiness: 'blocked', blockers: ['insufficient_balance'], reviewReasons: [], overdue: true, ageHours: 30, availableMilliliters: 500, cumulativeMilliliters: 900,
    });
  });

  it('treats an unknown or missing classification as needs_review, never ready', () => {
    expect(readReadiness({ readiness: 'posted' }).readiness).toBe('needs_review');
    expect(readReadiness(null).readiness).toBe('needs_review');
    expect(readReadiness({}).blockers).toEqual([]);
  });
});

describe('readReview', () => {
  const payload = {
    data: [
      { id: 'a', number: 'FTF-1', voucher_number: '04052', fuel_station_id: 's', quantity_liters: '1.000', quantity_milliliters: 1000, owner: { name: 'عسكر' }, tanker: null, recorded_at: '2027-01-26T09:00:00+03:00', inventory_readiness: { readiness: 'ready' } },
      { id: 7, number: 'bad' }, // صف مشوّه يُهمَل
    ],
    meta: { page: 2, last_page: 3, total: 41, truncated: true, posting_enabled: false, summary: { total: 5, ready: 2, needs_review: 1, blocked: 2, overdue: 1 }, pools: [{ warehouse_id: 'w', warehouse_name: 'م', fuel_product_id: 'p', fuel_product_name: 'ب', stock_milliliters: 9, cost_pool_milliliters: 9, quantity_in_sync: true, pending_count: 1, pending_total_milliliters: 5, shortfall_milliliters: 0 }, { x: 1 }], reconciliation_requirements: ['pool_quantity_equals_warehouse_stock'] },
  };

  it('parses rows, pools and meta, dropping malformed entries', () => {
    const page = readReview(payload);
    expect(page.rows.map((r) => r.id)).toEqual(['a']);
    expect(page.rows[0].ownerName).toBe('عسكر');
    expect(page.rows[0].readiness.readiness).toBe('ready');
    expect(page.pools).toHaveLength(1);
    expect(page.pools[0].costPoolValueMinor).toBeNull();
    expect(page.pools[0]).toMatchObject({ warehouseName: 'م', fuelProductName: 'ب' });
    expect(page).toMatchObject({ page: 2, lastPage: 3, total: 41, truncated: true, postingEnabled: false });
    expect(page.summary).toEqual({ total: 5, ready: 2, needsReview: 1, blocked: 2, overdue: 1 });
  });

  it('treats anything but an explicit posting_enabled=false as enabled-looking (the UI still renders no action either way)', () => {
    expect(readReview({ data: [], meta: {} }).postingEnabled).toBe(true);
  });

  it('survives garbage', () => {
    expect(readReview(undefined)).toMatchObject({ rows: [], pools: [], page: 1, lastPage: 1, truncated: false });
  });
});

describe('codes and quantities', () => {
  it('knows the server codes and flags unknown ones', () => {
    expect(isKnownBlocker('stock_record_missing')).toBe(true);
    expect(isKnownBlocker('made_up')).toBe(false);
    expect(isKnownReason('overdue')).toBe(true);
    expect(isKnownReason('insufficient_balance')).toBe(true);
    expect(isKnownReason('nope')).toBe(false);
  });

  it('formats whole milliliters as liters without floats', () => {
    expect(litersOf(1)).toBe('0.001');
    expect(litersOf(1_234_567)).toBe('1234.567');
    expect(litersOf(0)).toBe('0.000');
    expect(litersOf(-1500)).toBe('-1.500');
    expect(litersOf(null)).toBe('—');
  });
});

describe('readReconciliation is defensive and never assumes values are visible', () => {
  const full = {
    data: {
      status: 'differences', value_scope: 'tenant_by_branch',
      quantity: { summary: { pools: 3, in_sync: 2, mismatched: 1 }, pools: [{ warehouse_name: 'م', fuel_product_name: 'ب', stock_milliliters: 10, cost_pool_milliliters: 12, quantity_difference_milliliters: 2, findings: ['pool_quantity_mismatch'], cost_pool_value_minor: 500 }, 5] },
      value: {
        branches: [{ branch_name: 'الرئيسي', pool_value_minor: 100, ledger_share_minor: 90, difference_minor: -10, in_sync: false, unexplained_minor: 0, movements_without_journal_count: 1, causes: { entry_amount_differs_minor: 0, reversed_entries_minor: -10, movements_without_journal_minor: 0, state_vs_movements_minor: 0 } }],
        entries_with_amount_difference: { total: 2, sample: [{ number: 'JE-1', entry_date: '2027-01-02', source: 'Invoice', movement_delta_minor: 5, ledger_net_minor: 7, difference_minor: 2 }] },
      },
      inventory_accounts: { accounts: [{ code: '1140', name: 'المخزون', sources: ['role_current'] }], split_in_ledger: true, station_overrides: [{}], unlisted_asset_accounts: [{ code: '1141', name: 'مخزون محطة' }], ledger_evidence_hidden_by_branch_scope: true },
      findings: [{ code: 'value_difference', severity: 'error' }, { code: 'movements_without_journal', severity: 'warning', count: 3 }, { nope: 1 }],
      data_quality: { not_checked: ['price_and_average_correctness'] },
    },
  };

  it('maps quantity, branches, entries, accounts, findings and limits', () => {
    const r = readReconciliation(full);
    expect(r.consistent).toBe(false);
    expect(r.poolSummary).toEqual({ pools: 3, inSync: 2, mismatched: 1 });
    expect(r.pools).toHaveLength(2); // الصف غير الكائن يُقرأ كحقول فارغة لا يُسقط التحليل
    expect(r.pools[0].valueMinor).toBe(500);
    expect(r.branches[0].causes.reversedEntries).toBe(-10);
    expect(r.entriesTotal).toBe(2);
    expect(r.entries[0].number).toBe('JE-1');
    expect(r.splitInLedger).toBe(true);
    expect(r.unlistedAccounts).toEqual([{ code: '1141', name: 'مخزون محطة', sources: [] }]);
    expect(r.evidenceHidden).toBe(true);
    expect(r.stationOverrides).toBe(1);
    expect(r.findings.map((f) => f.code)).toEqual(['value_difference', 'movements_without_journal']);
    expect(r.findings[1].count).toBe(3);
    expect(r.notChecked).toEqual(['price_and_average_correctness']);
  });

  it('is consistent only when the server says so and there are no findings', () => {
    expect(readReconciliation({ data: { status: 'consistent', value_scope: 'tenant_by_branch', findings: [] } }).consistent).toBe(true);
    expect(readReconciliation({ data: { status: 'consistent', findings: [{ code: 'value_difference', severity: 'error' }] } }).consistent).toBe(false);
    expect(readReconciliation({}).consistent).toBe(false);
    expect(readReconciliation(null).consistent).toBe(false);
  });

  it('treats an unknown value scope as hidden and a missing payload as empty', () => {
    expect(readReconciliation({ data: { value_scope: 'everything' } }).valueScope).toBe('hidden_no_cost_permission');
    const empty = readReconciliation(undefined);
    expect(empty.branches).toEqual([]);
    expect(empty.pools).toEqual([]);
    expect(empty.valueScope).toBe('hidden_no_cost_permission');
  });

  it('knows the server finding codes and the three new blockers', () => {
    expect(isKnownFinding('value_difference')).toBe(true);
    expect(isKnownFinding('made_up')).toBe(false);
    for (const code of ['period_locked', 'settlement_mode_conflict', 'clearing_account_missing']) expect(isKnownBlocker(code)).toBe(true);
  });
});
