import { describe, expect, it } from 'vitest';
import { tanksAccess } from './access';

const can = (granted: string[]) => (permission: string) => granted.includes(permission);

describe('tank access is derived from effective permissions and grants nothing', () => {
  it('lets any station user see the monitor but not record', () => {
    expect(tanksAccess(can(['fuel_stations.view']))).toEqual({ view: true, record: false });
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
