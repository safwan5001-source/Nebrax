import { describe, expect, it } from 'vitest';
import {
  EMPTY_FUEL_REPORT_FILTERS,
  aviDecisionLabelKey,
  aviReasonLabelKey,
  fuelMovementLabelKey,
  collectionRows,
  filtersForReport,
  isFuelReportKey,
  reportQuery,
  reportSearchParams,
} from './fuel-reports';

describe('Fuel Reports contract helpers', () => {
  it('accepts only report views implemented by the current contracts', () => {
    expect(isFuelReportKey('sales-station')).toBe(true);
    expect(isFuelReportKey('alerts')).toBe(true);
    expect(isFuelReportKey('inventory')).toBe(true);
    expect(isFuelReportKey('meter-variance')).toBe(false);
    expect(isFuelReportKey('sales-period')).toBe(false);
  });

  it('sends only supported sales filters and a whitelisted dimension', () => {
    const query = reportQuery('sales-fuel', { from: '2026-08-01', to: '2026-08-24', stationId: 'station-1', status: 'active', severity: 'critical' });
    expect(query).toBe('/fuel-stations/reports/sales?from=2026-08-01&to=2026-08-24&station_id=station-1&dimension=fuel');
  });

  it('uses the existing operational-ledger endpoint for inventory without a financial stock claim', () => {
    const query = reportQuery('inventory', { from: '2026-08-01', to: '2026-08-24', stationId: 'station-1', status: 'active', severity: 'critical' });
    expect(query).toBe('/fuel-stations/reports/inventory?from=2026-08-01&to=2026-08-24&station_id=station-1');
  });

  it('does not invent station or date filters for alerts', () => {
    const filters = filtersForReport('alerts', { from: '2026-08-01', to: '2026-08-24', stationId: 'station-1', status: 'active', severity: 'high' });
    expect(filters).toEqual({ ...EMPTY_FUEL_REPORT_FILTERS, status: 'active', severity: 'high' });
    expect(reportQuery('alerts', filters)).toBe('/fuel-stations/alerts?status=active&severity=high');
    expect([...reportSearchParams('alerts', filters).keys()]).toEqual(['report', 'status', 'severity']);
  });

  it('does not crash when optional Laravel collection data is malformed or absent', () => {
    expect(collectionRows(null)).toEqual([]);
    expect(collectionRows({ data: null })).toEqual([]);
    expect(collectionRows({ data: { data: [{ id: 'one' }] } })).toEqual([{ id: 'one' }]);
  });

  it('maps AVI decisions and reasons to safe translation keys rather than exposing internal codes', () => {
    expect(aviDecisionLabelKey('denied')).toBe('denied');
    expect(aviDecisionLabelKey('unexpected')).toBe('unknown');
    expect(aviReasonLabelKey('AVI_REFILL_INTERVAL_RESTRICTED')).toBe('refillIntervalRestricted');
    expect(aviReasonLabelKey('INTERNAL_REASON_THAT_MUST_NOT_RENDER')).toBe('unknown');
    expect(fuelMovementLabelKey('adjustment_loss')).toBe('adjustment_loss');
    expect(fuelMovementLabelKey('INTERNAL_MOVEMENT_THAT_MUST_NOT_RENDER')).toBe('unknown');
  });
});
