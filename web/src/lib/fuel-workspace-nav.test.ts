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
    expect(visible).toContain('/fuel-stations/settings');
    expect(visible).toContain('/fuel-stations/receiving');
    expect(visible).toContain('/fuel-stations/shifts');
    expect(visible).not.toContain('/fuel-stations/sales');
    expect(visible).not.toContain('/fuel-stations/prices'); // يتطلب fuel.sale.view كالمبيعات
    expect(visible).not.toContain('/fuel-stations/devices');
    expect(visible).not.toContain('/fuel-stations/maintenance');
    expect(visible).not.toContain('/fuel-stations/safety');
    expect(visible).not.toContain('/fuel-stations/alerts');
    expect(visible).not.toContain('/fuel-stations/readiness');
  });

  it('hides capability-disabled routes even when their read permissions are present', () => {
    const visible = routes(['fuel.avi.view', 'fuel.device.view', 'fuel.integration.view'], ['fuel_stations.avi', 'fuel_stations.integrations']);

    expect(visible).not.toContain('/fuel-stations/avi-rfid');
    expect(visible).not.toContain('/fuel-stations/devices');
  });

  it('shows each readiness destination only for its corresponding read permission', () => {
    const visible = routes(['fuel.maintenance.view', 'fuel.alerts.view']);

    expect(visible).toContain('/fuel-stations/maintenance');
    expect(visible).toContain('/fuel-stations/alerts');
    expect(visible).not.toContain('/fuel-stations/safety');
    expect(visible).not.toContain('/fuel-stations/readiness');
  });

  it('allows the server-authorized wildcard role to see every built workspace route', () => {
    expect(routes(['*'])).toHaveLength(15); // + مركز المساعدة
  });

  it('shows the help center to every station user and never without the station view key', () => {
    expect(routes(['fuel_stations.view'])).toContain('/fuel-stations/help');
    expect(routes(['fuel.shift.view'])).not.toContain('/fuel-stations/help');
  });

  it('shows the price management route only with the sale-view permission', () => {
    expect(routes(['fuel_stations.view', 'fuel.sale.view'])).toContain('/fuel-stations/prices');
    expect(routes(['fuel_stations.view'])).not.toContain('/fuel-stations/prices');
    expect(routes(['*'])).toContain('/fuel-stations/prices');
  });
});

describe('TANKER-PR2 deployment-gated navigation', () => {
  const tankerRoutes = (permissions: string[], open: string[] = []) =>
    visibleFuelWorkspaceGroups(permissions, new Set(), new Set(open)).flatMap((group) => group.items.map((item) => item.href));

  it('hides tanker owners until the server confirms the deployment gate is open (fail closed)', () => {
    expect(tankerRoutes(['*'])).not.toContain('/fuel-stations/tanker-owners');
    expect(tankerRoutes(['*'])).not.toContain('/fuel-stations/tanker-settings');
    expect(tankerRoutes(['*'], ['some_other_gate'])).not.toContain('/fuel-stations/tanker-owners');
    expect(tankerRoutes(['*'], ['tanker_management'])).toContain('/fuel-stations/tanker-owners');
    expect(tankerRoutes(['*'], ['tanker_management'])).toContain('/fuel-stations/tanker-settings');
  });

  it('needs the exact view permission even when the gate is open; the legacy station keys are not enough', () => {
    expect(tankerRoutes(['fuel.tanker.view'], ['tanker_management'])).toContain('/fuel-stations/tanker-owners');
    expect(tankerRoutes(['fuel_stations.view', 'fuel_stations.manage'], ['tanker_management'])).not.toContain('/fuel-stations/tanker-owners');
    expect(tankerRoutes(['fuel_stations.view', 'fuel_stations.manage'], ['tanker_management'])).not.toContain('/fuel-stations/tanker-settings');
  });

  it('leaves every existing route untouched (gate-less items ignore the gate set)', () => {
    const before = visibleFuelWorkspaceGroups(['*'], new Set()).flatMap((g) => g.items.map((i) => i.href)).filter((h) => h !== '/fuel-stations/tanker-owners' && h !== '/fuel-stations/tanker-settings');
    expect(before).toContain('/fuel-stations/shifts');
    expect(before).toContain('/fuel-stations/corporate-contracts');
  });
});
