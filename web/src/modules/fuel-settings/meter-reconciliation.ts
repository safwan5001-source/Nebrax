/**
 * TANKER-PR8-S — منطق نقي لسياسة «مطابقة قراءات العدّادات» في إعدادات الورديات (لا شبكة ولا واجهة).
 *
 * الخادم هو السلطة: الحالة الفعلية (`deployment_open` · `setting_enabled` · `active` · `source`) تأتي من `meta.meter_reconciliation` في استجابة الإعدادات،
 * ولا تُستنتج هنا من علم بناء. **فصل صريح** بين اختيار المؤسسة/المحطة (الإعداد) وبوابة النشر (قرار تشغيل مستقل مغلق افتراضياً).
 */
export const METER_RECONCILIATION_KEY = 'shift_meter_reconciliation_enabled';
export const GOVERNANCE_PERMISSION = 'fuel.governance.manage';

export type PolicySource = 'station' | 'organization';

export interface MeterReconciliationMeta {
  /** بوابة النشر مفتوحة؟ */
  deploymentOpen: boolean;
  /** مصدر القيمة الفعّالة (لنطاق المحطة فقط). */
  source: PolicySource | null;
}

/** قراءة صارمة: أي انحراف عن العقد ⇒ `null` (لا ادّعاء حالة غير معروفة). */
export function readMeterReconciliationMeta(payload: unknown): MeterReconciliationMeta | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const meta = (payload as { meta?: unknown }).meta;
  if (typeof meta !== 'object' || meta === null) return null;
  const block = (meta as { meter_reconciliation?: unknown }).meter_reconciliation;
  if (typeof block !== 'object' || block === null) return null;
  const { deployment_open: open, source } = block as { deployment_open?: unknown; source?: unknown };
  if (typeof open !== 'boolean') return null;
  return { deploymentOpen: open, source: source === 'station' || source === 'organization' ? source : null };
}

export type PolicyStatus = 'active' | 'pending_deployment' | 'unknown_deployment' | 'disabled';

/** حالة العرض لقيمة الاختيار الحالية: «نشِطة» فقط حين يكون الاختيار مفعّلاً **و**البوابة مفتوحة. */
export function policyStatus(enabled: boolean, meta: MeterReconciliationMeta | null): PolicyStatus {
  if (!enabled) return 'disabled';
  if (meta === null) return 'unknown_deployment';
  return meta.deploymentOpen ? 'active' : 'pending_deployment';
}

/** تغيير هذا الإعداد حوكمة: يتطلب `fuel.governance.manage` (أو `*`) إضافةً إلى صلاحية إدارة الإعدادات. الخادم يفرضه ويرفض بـ403. */
export function canGovern(permissions: readonly string[]): boolean {
  return permissions.includes('*') || permissions.includes(GOVERNANCE_PERMISSION);
}
