import { describe, expect, it } from 'vitest';
import { OPS_BASE, deriveOpsMode, isNavActive, visibleOpsNav } from './nav';

const canFrom = (granted: string[]) => (permission: string) => granted.includes('*') || granted.includes(permission);
const canAllFrom = (granted: string[]) => (required: readonly string[]) => required.every(canFrom(granted));

describe('ops navigation is derived from AWJ permissions only', () => {
  it('derives the workspace mode from the effective permissions, never from a role name', () => {
    expect(deriveOpsMode(canFrom(['fuel.shift.approve', 'fuel.shift.open']))).toBe('supervisor');
    expect(deriveOpsMode(canFrom(['fuel.shift.open']))).toBe('operator');
    expect(deriveOpsMode(canFrom(['fuel_stations.view']))).toBe('viewer');
    expect(deriveOpsMode(canFrom(['*']))).toBe('supervisor');
  });

  it('hides screens whose permissions are missing; profile is always reachable', () => {
    const ids = (granted: string[]) => visibleOpsNav(canAllFrom(granted)).map((item) => item.id);
    expect(ids([])).toEqual(['help', 'profile']); // المساعدة والملف متاحان لكل مستخدم موثّق
    expect(ids(['fuel_stations.view'])).toEqual(['home', 'products', 'tanks', 'help', 'profile']);
    expect(ids(['fuel_stations.view', 'fuel.shift.view'])).toEqual(['home', 'products', 'shifts', 'tanks', 'reports', 'help', 'profile']);
  });

  // FUEL-B4: «الإدارة» تظهر لمن يملك أي وظيفة إدارية فعلية، لا لاسم دور؛ والخادم يفرض كل طلب.
  it('shows Manage only to someone holding an administrative permission (any one is enough)', () => {
    const ids = (granted: string[]) => visibleOpsNav(canAllFrom(granted)).map((item) => item.id);
    expect(ids(['fuel_stations.view', 'fuel.shift.view', 'fuel.shift.approve'])).not.toContain('manage'); // مشرف وردية بلا إدارة
    expect(ids(['fuel.staff.manage'])).toEqual(['manage', 'help', 'profile']);
    expect(ids(['fuel.sale.price.manage'])).toEqual(['manage', 'help', 'profile']);
    expect(ids(['fuel_stations.manage'])).toContain('manage'); // PR-2: مدير المحطة يصل إلى معالج الرصيد الافتتاحي
    expect(ids(['fuel.governance.manage'])).toEqual(['manage', 'help', 'profile']); // سياسة القراءات المتأخرة (B6) تتبع الحوكمة
    expect(ids(['fuel_stations.view', 'fuel.shift.view', 'fuel.staff.manage'])).toEqual(['home', 'products', 'shifts', 'tanks', 'reports', 'manage', 'help', 'profile']);
  });

  // FUEL-B5: «الاستلام» من مفتاح الاستلام الدقيق أو القديم `fuel_stations.manage` — لا من `fuel_stations.view` وحدها (مفتاح كل مستخدم محطة).
  it('shows Receiving only to someone holding a receiving permission, never for plain station view', () => {
    const ids = (granted: string[]) => visibleOpsNav(canAllFrom(granted)).map((item) => item.id);
    expect(ids(['fuel_stations.view', 'fuel.shift.view', 'fuel.shift.open'])).not.toContain('receiving'); // بائع
    expect(ids(['fuel_stations.view', 'fuel.delivery.view'])).toContain('receiving');
    expect(ids(['fuel_stations.view', 'fuel.delivery.create'])).toContain('receiving');
    expect(ids(['fuel_stations.view', 'fuel.delivery.approve'])).toContain('receiving');
    expect(ids(['fuel_stations.view', 'fuel_stations.manage'])).toContain('receiving');
    expect(ids(['fuel.delivery.view'])).not.toContain('receiving'); // بلا قراءة المحطات لا تطبيق
  });

  // FUEL-B6: «الخزانات» (مراقبة المستويات) لكل مستخدم محطة بمفتاح العرض؛ التسجيل تحكمه شاشة الخزان والخادم لا القائمة.
  it('shows Tanks to every station user (view-only monitor) and never without the station view key', () => {
    const ids = (granted: string[]) => visibleOpsNav(canAllFrom(granted)).map((item) => item.id);
    expect(ids(['fuel_stations.view', 'fuel.shift.view', 'fuel.shift.open'])).toContain('tanks'); // بائع
    expect(ids(['fuel_stations.view', 'fuel.reading.record'])).toContain('tanks');
    expect(ids(['fuel.reading.view'])).not.toContain('tanks'); // بلا قراءة المحطات لا تطبيق
    expect(isNavActive('/fuel-stations/ops/tanks/abc', '/fuel-stations/ops/tanks')).toBe(true);
  });

  // HORIZON-REPORTS: «التقارير» تظهر لمن يملك قراءة المحطات وأي صلاحية تقرير (كميات الوردية أو مبيعاتها)؛ الخادم يصفّي الكتالوج لكل تقرير.
  it('shows Reports only to a station user holding a report permission', () => {
    const ids = (granted: string[]) => visibleOpsNav(canAllFrom(granted)).map((item) => item.id);
    expect(ids(['fuel_stations.view'])).not.toContain('reports');
    expect(ids(['fuel_stations.view', 'fuel.sale.view'])).toContain('reports');
    expect(ids(['fuel_stations.view', 'fuel.shift.view'])).toContain('reports');
    expect(ids(['fuel.shift.view'])).not.toContain('reports'); // بلا قراءة المحطات لا تطبيق
    expect(isNavActive('/fuel-stations/ops/reports/sales.daily', '/fuel-stations/ops/reports')).toBe(true);
  });

  it('marks the active item without matching sibling prefixes', () => {
    expect(isNavActive(OPS_BASE, OPS_BASE)).toBe(true);
    expect(isNavActive(`${OPS_BASE}/products`, OPS_BASE)).toBe(false);
    expect(isNavActive(`${OPS_BASE}/products`, `${OPS_BASE}/products`)).toBe(true);
    expect(isNavActive(`${OPS_BASE}/productsx`, `${OPS_BASE}/products`)).toBe(false);
    expect(isNavActive(null, OPS_BASE)).toBe(false);
  });

});

describe('PIN sessions never see the administrative area (the server refuses it anyway)', () => {
  it('hides Manage for a PIN session even with every management permission, and keeps it for others', () => {
    const all = (permissions: readonly string[]) => permissions.every(() => true);
    expect(visibleOpsNav(all, { pinSession: true }).map((item) => item.id)).not.toContain('manage');
    expect(visibleOpsNav(all, { pinSession: true }).map((item) => item.id)).toEqual(expect.arrayContaining(['home', 'shifts', 'receiving', 'tanks', 'profile']));
    expect(visibleOpsNav(all).map((item) => item.id)).toContain('manage');
  });
});
