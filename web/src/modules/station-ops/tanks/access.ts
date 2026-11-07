/**
 * FUEL-B6 — اشتقاق قدرات «مستويات الخزانات» من صلاحيات المستخدم الفعلية (عرض فقط). **الخادم السلطة في كل طلب** (الصلاحيات الدقيقة، نطاق
 * المحطة/الفرع/المخزن، 404 موحّد)؛ هذه الدوال تمنع إظهار ما سيُرفض حتماً ولا تمنح شيئاً.
 *
 * القراءة: `fuel_stations.view` (مفتاح كل مستخدم محطة، فيشاهد البائع المراقبة) أو `fuel.reading.view` أو `fuel_stations.manage`.
 * التسجيل: `fuel.reading.record` أو `fuel_stations.manage` فقط — البائع لا يسجّل قراءة مستقلة (قراءات الوردية مسارها الوردية).
 * القراءة المتأخرة: التقديم/التسجيل المباشر تحكمه سياسة المحطة والصلاحية الدقيقة (الخادم يعلن `can_submit`)، والاعتماد `fuel.reading.late.approve` فقط.
 */

export interface TanksAccess {
  view: boolean;
  record: boolean;
  /** اعتماد/رفض طلبات القراءات المتأخرة: المفتاح الدقيق `fuel.reading.late.approve` وحده (لا `manage` القديم ولا `record`). */
  approveLate: boolean;
  /** هل يرى قائمة الطلبات (طلباته أو طلبات نطاقه): من يسجّل القراءات أو يعتمدها. */
  seeRequests: boolean;
  /** تعديل سياسة التأريخ الرجعي: يفرض الخادم `fuel_stations.manage` + `fuel.governance.manage` معاً. */
  editPolicy: boolean;
}

export function tanksAccess(can: (permission: string) => boolean): TanksAccess {
  const manage = can('fuel_stations.manage');
  const record = can('fuel.reading.record') || manage;
  const approveLate = can('fuel.reading.late.approve');
  return {
    view: can('fuel_stations.view') || can('fuel.reading.view') || manage,
    record,
    approveLate,
    seeRequests: record || approveLate,
    editPolicy: manage && can('fuel.governance.manage'),
  };
}
