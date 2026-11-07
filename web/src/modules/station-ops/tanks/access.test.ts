import { describe, expect, it } from 'vitest';
import { tanksAccess } from './access';

const can = (granted: string[]) => (permission: string) => granted.includes(permission);

describe('tank access is derived from effective permissions and grants nothing', () => {
  it('lets any station user see the monitor but not record', () => {
    expect(tanksAccess(can(['fuel_stations.view']))).toEqual({ view: true, record: false, approveLate: false, seeRequests: false, editPolicy: false });
  });

  it('records only with the precise key or the legacy manage key', () => {
    expect(tanksAccess(can(['fuel_stations.view', 'fuel.reading.record'])).record).toBe(true);
    expect(tanksAccess(can(['fuel_stations.view', 'fuel_stations.manage'])).record).toBe(true);
    expect(tanksAccess(can(['fuel_stations.view', 'fuel.shift.open', 'fuel.delivery.create'])).record).toBe(false);
  });

  it('views through any of the three keys and never without one', () => {
    expect(tanksAccess(can(['fuel.reading.view'])).view).toBe(true);
    expect(tanksAccess(can(['fuel_stations.manage'])).view).toBe(true);
    expect(tanksAccess(can([])).view).toBe(false);
  });
});

describe('late-reading authority is precise and never inherited from record or the legacy manage key', () => {
  it('approves only with fuel.reading.late.approve', () => {
    expect(tanksAccess(can(['fuel_stations.view', 'fuel.reading.record'])).approveLate).toBe(false);
    expect(tanksAccess(can(['fuel_stations.view', 'fuel_stations.manage'])).approveLate).toBe(false);
    expect(tanksAccess(can(['fuel_stations.view', 'fuel.reading.late.approve'])).approveLate).toBe(true);
  });

  it('sees the requests list as a requester (record) or an approver, and not as a plain station user', () => {
    expect(tanksAccess(can(['fuel_stations.view'])).seeRequests).toBe(false);
    expect(tanksAccess(can(['fuel_stations.view', 'fuel.reading.record'])).seeRequests).toBe(true);
    expect(tanksAccess(can(['fuel_stations.view', 'fuel.reading.late.approve'])).seeRequests).toBe(true);
  });

  it('edits the policy only with BOTH station management and fuel governance (the server enforces the same pair)', () => {
    expect(tanksAccess(can(['fuel_stations.view', 'fuel_stations.manage'])).editPolicy).toBe(false);
    expect(tanksAccess(can(['fuel_stations.view', 'fuel.governance.manage'])).editPolicy).toBe(false);
    expect(tanksAccess(can(['fuel_stations.view', 'fuel_stations.manage', 'fuel.governance.manage'])).editPolicy).toBe(true);
  });
});
