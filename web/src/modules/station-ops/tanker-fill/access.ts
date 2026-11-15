/**
 * TANKER-PR7 — قدرات تسجيل التعبئة من صلاحيات المستخدم الفعلية (عرض فقط). **الخادم هو السلطة في كل طلب**: هذه الدوال لا تمنح شيئاً.
 * المفاتيح الدقيقة وحدها (`fuel_stations.manage` القديم لا يكفي في الخادم، فلا نعامله كافياً هنا).
 */
export interface TankerFillAccess {
  /** قراءة السندات (سجل الوردية و«تحقق من الحالة»). */
  view: boolean;
  /** تسجيل تعبئة (المفتاح الدقيق). */
  record: boolean;
  /** قراءة أصحاب الصهاريج والصهاريج (لاختيارهما). */
  pick: boolean;
  /** بدء معالج التسجيل: التسجيل + قراءة الأصحاب + قراءة السندات. */
  canStart: boolean;
}

export function tankerFillAccess(can: (permission: string) => boolean): TankerFillAccess {
  const view = can('fuel.tanker.fill.view');
  const record = can('fuel.tanker.fill.record');
  const pick = can('fuel.tanker.view');
  return { view, record, pick, canStart: record && pick && view };
}

export const hasAnyTankerFill = (access: TankerFillAccess): boolean => access.view || access.record;
