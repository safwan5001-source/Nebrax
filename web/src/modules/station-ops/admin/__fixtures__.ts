import type { AuditEvent, StaffView, TemplatesPayload } from './schemas';

/** بيانات اختبار فقط — موسومة صراحةً، ولا تُستورد من أي شيفرة إنتاج (يحرس ذلك admin-boundary.test.ts). */
export const SELLER = ['fuel.shift.cash_count', 'fuel.shift.close', 'fuel.shift.open', 'fuel.shift.view', 'fuel_stations.view'];
export const SUPERVISOR = [...SELLER, 'fuel.alerts.view', 'fuel.delivery.create', 'fuel.delivery.view', 'fuel.reading.record', 'fuel.reading.view', 'fuel.reconciliation.create', 'fuel.reconciliation.view', 'fuel.reports.view', 'fuel.sale.view', 'fuel.shift.approve', 'fuel.shift.cash_variance_review', 'fuel.supplier_invoice.view'].sort();
export const MANAGER = [...SUPERVISOR, 'fuel.alerts.manage', 'fuel.delivery.approve', 'fuel.device.view', 'fuel.maintenance.view', 'fuel.reconciliation.approve', 'fuel.safety.view', 'fuel.sale.collect', 'fuel.sale.create', 'fuel.sale.finalize'].sort();

export const CATALOG = [...new Set([...MANAGER, 'fuel.sale.price.manage', 'fuel.supplier_invoice.manage', 'fuel.governance.manage', 'fuel.staff.manage', 'fuel_stations.manage', 'fuel.contract.view'])].sort();

export const templates = (over: Partial<TemplatesPayload> = {}): TemplatesPayload => ({
  templates: [
    { key: 'seller', label_ar: 'بائع', label_en: 'Seller', permissions: SELLER, assignable: true },
    { key: 'supervisor', label_ar: 'مشرف', label_en: 'Supervisor', permissions: SUPERVISOR, assignable: true },
    { key: 'station_manager', label_ar: 'مدير محطة', label_en: 'Station manager', permissions: MANAGER, assignable: true },
  ],
  catalog: CATALOG,
  // ما يفوّضه فاعل غير أعلى: الكتالوج − المحجوز − ما لا يملكه.
  delegable: CATALOG.filter((key) => !['fuel.governance.manage', 'fuel.staff.manage', 'fuel_stations.manage'].includes(key)),
  reserved: ['fuel.governance.manage', 'fuel.staff.manage'],
  ...over,
});

export const staff = (id: string, name: string, over: Partial<StaffView> = {}): StaffView => ({
  user: { id, name, email: `${name.toLowerCase().replace(/\s+/g, '.')}@example.test`, is_active: true },
  role: `fuel-staff-${id.slice(0, 8)}`,
  template: 'seller',
  fuel_permissions: SELLER,
  fuel_station_scope: 'assigned',
  station_ids: [],
  revision: `rev-${id.slice(0, 4)}-1`,
  ...over,
});

export const auditEvent = (id: string, over: Partial<AuditEvent> = {}): AuditEvent => ({
  id, occurred_at: '2026-11-06T10:00:00+00:00', action: 'fuel_staff.updated', subject_type: 'fuel_staff', outcome: 'applied',
  actor: { id: 'u-admin', name: 'Admin One' }, target: { kind: 'user', id: 'u-emp', name: 'Emp One' }, reason: null, denial_reason: null,
  changes: [{ key: 'fuel_permissions', kind: 'list', added: ['fuel.reading.view'], removed: [], count: 6 }], ...over,
});

export const UID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
