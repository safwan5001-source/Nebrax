import { describe, expect, it } from 'vitest';
import { hasAnyReceiving, receivingAccess } from './access';

const canOf = (granted: string[]) => (permission: string) => granted.includes('*') || granted.includes(permission);

describe('receiving capabilities come from the real permission keys', () => {
  it('a seller (view + shifts only) has no receiving capability at all', () => {
    const a = receivingAccess(canOf(['fuel_stations.view', 'fuel.shift.view', 'fuel.shift.open']));
    expect(a).toMatchObject({ view: false, create: false, approve: false, seeCost: false, canStart: false });
    expect(hasAnyReceiving(a)).toBe(false);
  });

  it('a supervisor can view and create but not approve, and cannot start without cost authority', () => {
    const a = receivingAccess(canOf(['fuel.delivery.view', 'fuel.delivery.create', 'fuel.reading.record']));
    expect(a).toMatchObject({ view: true, create: true, approve: false, recordReading: true, seeCost: false, canStart: false });
  });

  it('cost authority + create lets someone start; approval is a separate key', () => {
    expect(receivingAccess(canOf(['fuel.delivery.create', 'products.view_cost'])).canStart).toBe(true);
    expect(receivingAccess(canOf(['fuel.delivery.approve'])).approve).toBe(true);
    expect(receivingAccess(canOf(['fuel.delivery.approve'])).create).toBe(false);
  });

  it('the legacy manage key keeps working for view/create/approve/readings but never grants cost', () => {
    const a = receivingAccess(canOf(['fuel_stations.manage']));
    expect(a).toMatchObject({ view: true, create: true, approve: true, recordReading: true, seeCost: false, canStart: false });
  });

  it('the owner wildcard has everything', () => {
    expect(receivingAccess(canOf(['*']))).toMatchObject({ view: true, create: true, approve: true, seeCost: true, canStart: true });
  });
});
