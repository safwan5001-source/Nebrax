import { describe, expect, it } from 'vitest';
import { isKnownBlocker, isKnownReason, litersOf, readReadiness, readReview } from './logic';

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
