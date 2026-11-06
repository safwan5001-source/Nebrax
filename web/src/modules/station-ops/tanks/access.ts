/**
 * FUEL-B6 — اشتقاق قدرات «مستويات الخزانات» من صلاحيات المستخدم الفعلية (عرض فقط). **الخادم السلطة في كل طلب** (الصلاحيات الدقيقة، نطاق
 * المحطة/الفرع/المخزن، 404 موحّد)؛ هذه الدوال تمنع إظهار ما سيُرفض حتماً ولا تمنح شيئاً.
 *
 * القراءة: `fuel_stations.view` (مفتاح كل مستخدم محطة، فيشاهد البائع المراقبة) أو `fuel.reading.view` أو `fuel_stations.manage`.
 * التسجيل: `fuel.reading.record` أو `fuel_stations.manage` فقط — البائع لا يسجّل قراءة مستقلة (قراءات الوردية مسارها الوردية).
 */

export interface TanksAccess {
  view: boolean;
  record: boolean;
}

export function tanksAccess(can: (permission: string) => boolean): TanksAccess {
  const manage = can('fuel_stations.manage');
  return {
    view: can('fuel_stations.view') || can('fuel.reading.view') || manage,
    record: can('fuel.reading.record') || manage,
  };
}
