import { describe, expect, it } from 'vitest';
import { canGovern, policyStatus, readMeterReconciliationMeta } from './meter-reconciliation';

describe('readMeterReconciliationMeta', () => {
  it('reads the deployment gate and the value source strictly', () => {
    expect(readMeterReconciliationMeta({ meta: { meter_reconciliation: { deployment_open: true, source: 'station' } } })).toEqual({ deploymentOpen: true, source: 'station' });
    expect(readMeterReconciliationMeta({ meta: { meter_reconciliation: { deployment_open: false } } })).toEqual({ deploymentOpen: false, source: null });
    expect(readMeterReconciliationMeta({ meta: { meter_reconciliation: { deployment_open: true, source: 'tenant' } } })).toEqual({ deploymentOpen: true, source: null });
  });

  it.each([null, undefined, 'x', {}, { meta: null }, { meta: {} }, { meta: { meter_reconciliation: null } }, { meta: { meter_reconciliation: { deployment_open: 'yes' } } }])('treats %j as unknown (never claims a state)', (payload) => {
    expect(readMeterReconciliationMeta(payload)).toBeNull();
  });
});

describe('policyStatus', () => {
  const open = { deploymentOpen: true, source: null };
  const closed = { deploymentOpen: false, source: null };

  it('is active only when the choice is on AND the deployment gate is open', () => {
    expect(policyStatus(true, open)).toBe('active');
    expect(policyStatus(true, closed)).toBe('pending_deployment');
    expect(policyStatus(true, null)).toBe('unknown_deployment');
  });

  it('is disabled whenever the choice is off, whatever the gate says', () => {
    expect(policyStatus(false, open)).toBe('disabled');
    expect(policyStatus(false, closed)).toBe('disabled');
    expect(policyStatus(false, null)).toBe('disabled');
  });
});

describe('canGovern', () => {
  it('needs the governance permission or the wildcard', () => {
    expect(canGovern(['*'])).toBe(true);
    expect(canGovern(['fuel_stations.manage', 'fuel.governance.manage'])).toBe(true);
    expect(canGovern(['fuel_stations.manage'])).toBe(false);
    expect(canGovern([])).toBe(false);
  });

  it('does not treat the meter review permission as governance', () => {
    expect(canGovern(['fuel.shift.meter_variance_review'])).toBe(false);
  });
});
