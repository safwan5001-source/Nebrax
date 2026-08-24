import { describe, expect, it } from 'vitest';
import { visibleFuelWorkspaceGroups } from './fuel-workspace-nav';

function routes(permissions: string[], hidden: string[] = []) {
  return visibleFuelWorkspaceGroups(permissions, new Set(hidden)).flatMap((group) => group.items.map((item) => item.href));
}

describe('Fuel Workspace navigation presentation', () => {
  it('keeps only routes whose complete read permission set is present', () => {
    const visible = routes(['fuel_stations.view', 'fuel.shift.view']);

    expect(visible).toContain('/fuel-stations');
    expect(visible).toContain('/fuel-stations/master-data');
    expect(visible).toContain('/fuel-stations/receiving');
    expect(visible).toContain('/fuel-stations/shifts');
    expect(visible).not.toContain('/fuel-stations/sales');
    expect(visible).not.toContain('/fuel-stations/devices');
    expect(visible).not.toContain('/fuel-stations/readiness');
  });

  it('hides capability-disabled routes even when their read permissions are present', () => {
    const visible = routes(['fuel.avi.view', 'fuel.device.view', 'fuel.integration.view'], ['fuel_stations.avi', 'fuel_stations.integrations']);

    expect(visible).not.toContain('/fuel-stations/avi-rfid');
    expect(visible).not.toContain('/fuel-stations/devices');
  });

  it('allows the server-authorized wildcard role to see every built workspace route', () => {
    expect(routes(['*'])).toHaveLength(9);
  });
});
