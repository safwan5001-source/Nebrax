export type FuelWorkspaceNavItem = {
  href: string;
  labelKey: string;
  permissions: string[];
  appKey?: string;
  /**
   * بوابة نشر على مستوى الخادم (علم بيئة) لا تعلنها قدرة التطبيقات: لا يُظهر العنصر إلا بعد أن يؤكد الخادم فتحها (`openGates`).
   * مغلقة أو لم تُفحص بعد ⇒ مخفي (فشل مغلق، لا رابط يقود لصفحة «غير متاحة» لكل مالك). عرض فقط؛ الخادم يفرضها على كل طلب.
   */
  gate?: string;
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
      { href: '/fuel-stations/prices', labelKey: 'prices', permissions: ['fuel_stations.view', 'fuel.sale.view'] },
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
      // TANKER-PR2: إدارة أصحاب الصهاريج — بوابة نشر مغلقة افتراضياً (`FUEL_TANKER_MANAGEMENT_ENABLED`).
      { href: '/fuel-stations/tanker-owners', labelKey: 'tankerOwners', permissions: ['fuel.tanker.view'], gate: 'tanker_management' },
      // TANKER-PR3: إعدادات تعبئة الصهاريج (سياسات + عمليات الفوهات) — البوابة نفسها.
      { href: '/fuel-stations/tanker-settings', labelKey: 'tankerSettings', permissions: ['fuel.tanker.view'], gate: 'tanker_management' },
      // TANKER-PR6A: مراجعة جاهزية الدمج المخزني للسندات المعلّقة (عرض فقط، لا ترحيل) — البوابة نفسها، وصلاحية مراجعة مستقلة.
      { href: '/fuel-stations/tanker-inventory-review', labelKey: 'tankerInventoryReview', permissions: ['fuel.tanker.fill.inventory.view'], gate: 'tanker_management' },
      // TANKER-PR6B-5: سندات التعبئة — الدمج المخزني (ترحيل/عكس بمعاينة وتأكيد). تُخفى حتى يؤكد الخادم فتح بوابات الميزة الثلاث (مسبار قراءة خفيف في `FuelWorkspaceNav`).
      { href: '/fuel-stations/tanker-fills', labelKey: 'tankerFills', permissions: ['fuel.tanker.fill.inventory.view'], gate: 'tanker_fills_workspace' },
    ],
  },
  {
    labelKey: 'devices',
    items: [{ href: '/fuel-stations/devices', labelKey: 'deviceRegistry', permissions: ['fuel.device.view', 'fuel.integration.view'], appKey: 'fuel_stations.integrations' }],
  },
  {
    labelKey: 'maintenanceSafety',
    items: [
      { href: '/fuel-stations/maintenance', labelKey: 'maintenance', permissions: ['fuel.maintenance.view'], appKey: 'fuel_stations.maintenance' },
      { href: '/fuel-stations/safety', labelKey: 'safety', permissions: ['fuel.safety.view'], appKey: 'fuel_stations.maintenance' },
      { href: '/fuel-stations/alerts', labelKey: 'alerts', permissions: ['fuel.alerts.view'], appKey: 'fuel_stations.maintenance' },
      { href: '/fuel-stations/readiness', labelKey: 'readinessHealth', permissions: ['fuel.reports.view'], appKey: 'fuel_stations.maintenance' },
    ],
  },
  {
    labelKey: 'settings',
    items: [{ href: '/fuel-stations/settings', labelKey: 'settings', permissions: ['fuel_stations.view'] }],
  },
  {
    labelKey: 'support',
    // مركز المساعدة (محتوى ثابت مشترك مع تطبيق المحطات): لكل مستخدم وحدة المحطات، بلا استدعاء خادم.
    items: [{ href: '/fuel-stations/help', labelKey: 'help', permissions: ['fuel_stations.view'] }],
  },
];

export function visibleFuelWorkspaceGroups(permissions: string[], hiddenAppKeys: Set<string>, openGates: ReadonlySet<string> = new Set()): FuelWorkspaceNavGroup[] {
  const canAccess = (required: string[]) => permissions.includes('*') || required.every((permission) => permissions.includes(permission));

  return FUEL_WORKSPACE_NAV_GROUPS
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => canAccess(item.permissions) && (!item.appKey || !hiddenAppKeys.has(item.appKey)) && (!item.gate || openGates.has(item.gate))),
    }))
    .filter((group) => group.items.length > 0);
}
