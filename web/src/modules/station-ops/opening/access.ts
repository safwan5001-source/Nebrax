/**
 * PR-2 — قدرات المعالج من صلاحيات المستخدم الفعلية (عرض فقط). **الخادم السلطة في كل طلب**: هذه الدوال تمنع إظهار/إرسال ما سيُرفض حتماً ولا تمنح شيئاً.
 * القراءة `fuel_stations.view` · المسودة `fuel_stations.manage` · التكلفة `products.view_cost` + (`fuel.delivery.cost.record` أو `fuel_stations.manage`)
 * · الترحيل `fuel.governance.manage` + `products.view_cost` · قائمة الحسابات `accounts.view`.
 */
export interface OpeningAccess {
  view: boolean;
  draft: boolean;
  seeCost: boolean;
  recordCost: boolean;
  post: boolean;
  accounts: boolean;
}

export function openingAccess(can: (permission: string) => boolean): OpeningAccess {
  const manage = can('fuel_stations.manage');
  const seeCost = can('products.view_cost');
  return {
    view: can('fuel_stations.view'),
    draft: manage,
    seeCost,
    recordCost: seeCost && (can('fuel.delivery.cost.record') || manage),
    post: can('fuel.governance.manage') && seeCost,
    accounts: can('accounts.view'),
  };
}
