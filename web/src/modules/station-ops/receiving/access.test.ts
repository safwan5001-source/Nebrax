import { describe, expect, it } from 'vitest';
import { hasAnyReceiving, receivingAccess } from './access';

const canOf = (granted: string[]) => (permission: string) => granted.includes('*') || granted.includes(permission);

describe('receiving capabilities come from the real permission keys', () => {
  it('a seller (view + shifts only) has no receiving capability at all', () => {
    const a = receivingAccess(canOf(['fuel_stations.view', 'fuel.shift.view', 'fuel.shift.open']));
    expect(a).toMatchObject({ view: false, create: false, approve: false, seeCost: false, canStart: false });
    expect(hasAnyReceiving(a)).toBe(false);
  });

  it('a supervisor can view, create and attach but not approve, and can start WITHOUT any cost authority', () => {
    const a = receivingAccess(canOf(['fuel.delivery.view', 'fuel.delivery.create', 'fuel.reading.record']));
    expect(a).toMatchObject({ view: true, create: true, approve: false, recordReading: true, seeCost: false, recordCost: false, attach: true, canStart: true });
  });

  it('recording cost needs the finance key (or legacy manage) AND view_cost — neither alone, and create/approve never grant it', () => {
    expect(receivingAccess(canOf(['fuel.delivery.cost.record'])).recordCost).toBe(false);
    expect(receivingAccess(canOf(['products.view_cost'])).recordCost).toBe(false);
    expect(receivingAccess(canOf(['fuel.delivery.cost.record', 'products.view_cost'])).recordCost).toBe(true);
    expect(receivingAccess(canOf(['fuel_stations.manage', 'products.view_cost'])).recordCost).toBe(true);
    expect(receivingAccess(canOf(['fuel.delivery.create', 'fuel.delivery.approve'])).recordCost).toBe(false);
  });

  it('starting does not need cost; approval is a separate key', () => {
    expect(receivingAccess(canOf(['fuel.delivery.create'])).canStart).toBe(true);
    expect(receivingAccess(canOf(['fuel.delivery.approve'])).approve).toBe(true);
    expect(receivingAccess(canOf(['fuel.delivery.approve'])).create).toBe(false);
  });

  it('the legacy manage key keeps working for view/create/approve/readings but never reveals cost (view_cost is separate)', () => {
    const a = receivingAccess(canOf(['fuel_stations.manage']));
    expect(a).toMatchObject({ view: true, create: true, approve: true, recordReading: true, seeCost: false, recordCost: false, canStart: true });
  });

  it('the owner wildcard has everything', () => {
    expect(receivingAccess(canOf(['*']))).toMatchObject({ view: true, create: true, approve: true, seeCost: true, recordCost: true, attach: true, canStart: true });
  });
});
