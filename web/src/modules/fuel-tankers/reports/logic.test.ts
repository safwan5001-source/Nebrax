import { describe, expect, it } from 'vitest';
import { clearingReport, controlReport, fillsReport, meta, reconReport, STATION_ID } from './__fixtures__';
import { FINDING_CODES, forbiddenReasonOf, isKnownFinding, isPeriodReversed, readReport, reportQueryEntries } from './logic';
import { isReportKey, reportHref, REPORT_KEYS } from './routes';

describe('reportQueryEntries', () => {
  it('emits only valid params in a stable order', () => {
    expect(reportQueryEntries({ stationId: STATION_ID, ownerId: 'o', status: 'recorded', inventoryStatus: 'posted', from: '2027-01-01', to: '2027-01-31', page: 3, perPage: 50 })).toEqual([
      ['station_id', STATION_ID], ['owner_id', 'o'], ['status', 'recorded'], ['inventory_status', 'posted'], ['from', '2027-01-01'], ['to', '2027-01-31'], ['page', '3'], ['per_page', '50'],
    ]);
  });

  it('drops empty values, page 1, unknown enum values and malformed dates', () => {
    expect(reportQueryEntries({})).toEqual([]);
    expect(reportQueryEntries({ stationId: '', page: 1, status: 'bogus', inventoryStatus: 'nope', from: '01/01/2027', to: '2027-1-1' })).toEqual([]);
  });

  it('detects a reversed period without rejecting partial periods', () => {
    expect(isPeriodReversed('2027-02-01', '2027-01-01')).toBe(true);
    expect(isPeriodReversed('2027-01-01', '2027-01-01')).toBe(false);
    expect(isPeriodReversed('2027-01-01', undefined)).toBe(false);
    expect(isPeriodReversed(undefined, '2027-01-01')).toBe(false);
  });
});

describe('readReport contracts', () => {
  it('reads the four reports', () => {
    expect(readReport('fills', fillsReport()).key).toBe('fills');
    expect(readReport('inventory-reconciliation', reconReport()).key).toBe('inventory-reconciliation');
    expect(readReport('clearing-account', clearingReport()).key).toBe('clearing-account');
    expect(readReport('accounting-control', controlReport()).key).toBe('accounting-control');
  });

  it('keeps a hidden financial key as null — never as zero', () => {
    const row = { ...(fillsReport().data.rows[0] as Record<string, unknown>) };
    delete row.posted_cost_minor;
    const parsed = readReport('fills', fillsReport([row]));
    if (parsed.key !== 'fills') throw new Error('key');
    expect(parsed.data.rows[0].posted_cost_minor).toBeNull();
    const recon = readReport('inventory-reconciliation', reconReport([{ ...(reconReport().data.rows[0] as Record<string, unknown>), values: null }]));
    if (recon.key !== 'inventory-reconciliation') throw new Error('key');
    expect(recon.data.rows[0].values).toBeNull();
  });

  it('rejects a response that declares a different report than requested', () => {
    expect(() => readReport('fills', reconReport())).toThrow(/report_mismatch/);
  });

  it('rejects malformed payloads whole (no partial data)', () => {
    expect(() => readReport('fills', { data: { rows: 'x' }, meta: meta('fills') })).toThrow();
    expect(() => readReport('fills', { data: fillsReport().data })).toThrow();
    expect(() => readReport('clearing-account', { data: { accounts: [{ account: { id: 1 } }] }, meta: meta('clearing-account') })).toThrow();
    expect(() => readReport('accounting-control', { data: { rows: [], summary: {} }, meta: meta('accounting-control') })).toThrow();
  });

  it('falls back safely on an unknown result or severity instead of claiming a match', () => {
    const rows = [{ ...(reconReport().data.rows[0] as Record<string, unknown>), result: 'perfect', findings: [{ code: 'x', severity: 'catastrophic' }] }];
    const parsed = readReport('inventory-reconciliation', reconReport(rows));
    if (parsed.key !== 'inventory-reconciliation') throw new Error('key');
    expect(parsed.data.rows[0].result).toBe('incomplete'); // لا «متطابق» بالتخمين
    expect(parsed.data.rows[0].findings[0].severity).toBe('warning');
  });

  it('exposes the declared scope, applied filters and truncation flags untouched', () => {
    const parsed = readReport('accounting-control', controlReport(undefined, { available: false, reason: 'station_scope_restricted', accounts: [] }, { truncated: true }, { row_scope: { station_restricted: true, branch_restricted: false }, balance_filters_not_applicable: ['station_id'], filters: { station_id: STATION_ID } }));
    if (parsed.key !== 'accounting-control') throw new Error('key');
    expect(parsed.data.truncated).toBe(true);
    expect(parsed.data.clearing).toMatchObject({ available: false, reason: 'station_scope_restricted', accounts: [] });
    expect(parsed.meta.row_scope.station_restricted).toBe(true);
    expect(parsed.meta.balance_filters_not_applicable).toEqual(['station_id']);
  });
});

describe('forbiddenReasonOf', () => {
  it('returns only the two known reasons from details.reason', () => {
    expect(forbiddenReasonOf({ message: 'x', reason: 'forbidden', details: { reason: 'station_scope_restricted' } })).toBe('station_scope_restricted');
    expect(forbiddenReasonOf({ details: { reason: 'financial_permissions_required' } })).toBe('financial_permissions_required');
  });

  it('ignores unknown, missing or malformed bodies (generic message, no inference)', () => {
    expect(forbiddenReasonOf({ details: { reason: 'something_else' } })).toBeNull();
    expect(forbiddenReasonOf({ reason: 'station_scope_restricted' })).toBeNull(); // الجذر ليس details
    expect(forbiddenReasonOf(null)).toBeNull();
    expect(forbiddenReasonOf('forbidden')).toBeNull();
  });
});

describe('catalog helpers', () => {
  it('knows every finding code once and flags unknown ones', () => {
    expect(new Set(FINDING_CODES).size).toBe(FINDING_CODES.length);
    expect(isKnownFinding('ledger_missing')).toBe(true);
    expect(isKnownFinding('surprise')).toBe(false);
  });

  it('maps the four reports to distinct routes', () => {
    expect(REPORT_KEYS).toHaveLength(4);
    expect(new Set(REPORT_KEYS.map(reportHref)).size).toBe(4);
    expect(reportHref('fills')).toBe('/fuel-stations/tanker-fill-reports');
    expect(reportHref('clearing-account')).toBe('/fuel-stations/tanker-fill-reports/clearing-account');
    expect(isReportKey('accounting-control')).toBe(true);
    expect(isReportKey('../x')).toBe(false);
  });
});
