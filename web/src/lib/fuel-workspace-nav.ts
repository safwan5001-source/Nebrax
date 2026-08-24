export type FuelWorkspaceNavItem = {
  href: string;
  labelKey: string;
  permissions: string[];
  appKey?: string;
};

export type FuelWorkspaceNavGroup = {
  labelKey: string;
  items: FuelWorkspaceNavItem[];
};

/**
 * سياسة عرض فقط لمساحة العمل. لا تمنح صلاحية ولا تستبدل middleware أو RBAC بالخادم.
 */
export const FUEL_WORKSPACE_NAV_GROUPS: FuelWorkspaceNavGroup[] = [
  {
    labelKey: 'overview',
    items: [{ href: '/fuel-stations', labelKey: 'commandCenter', permissions: ['fuel_stations.view'] }],
  },
  {
    labelKey: 'operations',
    items: [
      { href: '/fuel-stations/shifts', labelKey: 'shifts', permissions: ['fuel_stations.view', 'fuel.shift.view'] },
      { href: '/fuel-stations/sales', labelKey: 'sales', permissions: ['fuel_stations.view', 'fuel.sale.view'] },
      { href: '/fuel-stations/receiving', labelKey: 'receiving', permissions: ['fuel_stations.view'] },
    ],
  },
  {
    labelKey: 'fuelInventory',
    items: [{ href: '/fuel-stations/master-data', labelKey: 'masterData', permissions: ['fuel_stations.view'] }],
  },
  {
    labelKey: 'customersFleet',
    items: [
      { href: '/fuel-stations/corporate-contracts', labelKey: 'corporateContracts', permissions: ['fuel.contract.view'] },
      { href: '/fuel-stations/avi-rfid', labelKey: 'aviRfid', permissions: ['fuel.avi.view'], appKey: 'fuel_stations.avi' },
    ],
  },
  {
    labelKey: 'devices',
    items: [{ href: '/fuel-stations/devices', labelKey: 'deviceRegistry', permissions: ['fuel.device.view', 'fuel.integration.view'], appKey: 'fuel_stations.integrations' }],
  },
  {
    labelKey: 'maintenanceSafety',
    items: [{ href: '/fuel-stations/readiness', labelKey: 'readinessHealth', permissions: ['fuel.maintenance.view', 'fuel.safety.view', 'fuel.alerts.view', 'fuel.reports.view'], appKey: 'fuel_stations.maintenance' }],
  },
];

export function visibleFuelWorkspaceGroups(permissions: string[], hiddenAppKeys: Set<string>): FuelWorkspaceNavGroup[] {
  const canAccess = (required: string[]) => permissions.includes('*') || required.every((permission) => permissions.includes(permission));

  return FUEL_WORKSPACE_NAV_GROUPS
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => canAccess(item.permissions) && (!item.appKey || !hiddenAppKeys.has(item.appKey))),
    }))
    .filter((group) => group.items.length > 0);
}
