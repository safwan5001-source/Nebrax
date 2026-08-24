import { describe, expect, it } from 'vitest';
import { fuelAlertRuleLabelKey, nextWorkOrderStatuses, readinessAssetLabel } from './fuel-readiness';

describe('Fuel readiness presentation helpers', () => {
  it('exposes only the backend-approved next work-order transitions', () => {
    expect(nextWorkOrderStatuses('reported')).toEqual(['triaged']);
    expect(nextWorkOrderStatuses('triaged')).toEqual(['scheduled', 'in_progress']);
    expect(nextWorkOrderStatuses('closed')).toEqual([]);
  });

  it('formats maintenance assets with human identity and station context', () => {
    expect(readinessAssetLabel(
      { kind: 'pump', name: 'مضخة الجزيرة', code: 'P-02', stationName: 'محطة الرياض الرئيسية' },
      { station: 'Station', tank: 'Tank', pump: 'Pump', nozzle: 'Nozzle', device: 'Device', accounting_asset: 'Asset' },
    )).toBe('Pump: مضخة الجزيرة · P-02 — محطة الرياض الرئيسية');
  });

  it('maps alert engine rules to translation keys and never returns an unknown raw rule', () => {
    expect(fuelAlertRuleLabelKey('fuel.safety.permit_expiring')).toBe('permitExpiring');
    expect(fuelAlertRuleLabelKey('fuel.unknown.rule')).toBe('unknown');
  });
});
