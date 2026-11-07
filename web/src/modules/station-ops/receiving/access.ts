/**
 * FUEL-B5/B5.1 — اشتقاق قدرات الاستلام من صلاحيات المستخدم الفعلية (عرض فقط). **الخادم هو السلطة في كل طلب**: هذه الدوال تمنع إظهار/إرسال ما سيُرفض حتماً
 * ولا تمنح شيئاً. كل مسار استلام يقبل المفتاح الدقيق من B2 **أو** `fuel_stations.manage` القديم، وهكذا نحكم هنا (لا نعامل `fuel_stations.view` وحده مفتاح استلام:
 * هو مفتاح كل مستخدم محطة، ويُعرض عليه التطبيق ما سواه).
 */

export interface ReceivingAccess {
  /** عرض قائمة الاستلامات وتفاصيلها. */
  view: boolean;
  /** إنشاء مسودة (مفتاح الإنشاء). */
  create: boolean;
  /** اعتماد مسودة. */
  approve: boolean;
  /** رؤية تكلفة الاستلام والنسخة المالية من السند (`products.view_cost` وحده). */
  seeCost: boolean;
  /** تسجيل التكلفة (B5.1): الصلاحية المالية الدقيقة `fuel.delivery.cost.record` (أو القديمة `fuel_stations.manage`) **و** `products.view_cost` — كما يفرض الخادم. */
  recordCost: boolean;
  /** رفع مرفقات سند المورد وحذفها من المسودة (مفتاح الإنشاء). */
  attach: boolean;
  /** تسجيل قراءة خزان (قبل/بعد). */
  recordReading: boolean;
  /** بدء استلام جديد من التطبيق (B5.1): الإنشاء وحده — **بلا تكلفة**؛ تُسجَّلها المالية لاحقاً قبل الاعتماد. */
  canStart: boolean;
}

export const RECEIVING_VIEW_PERMISSIONS = ['fuel.delivery.view', 'fuel_stations.manage'] as const;
export const RECEIVING_ANY_PERMISSIONS = ['fuel.delivery.view', 'fuel.delivery.create', 'fuel.delivery.approve', 'fuel.delivery.cost.record', 'fuel_stations.manage'] as const;

export function receivingAccess(can: (permission: string) => boolean): ReceivingAccess {
  const manage = can('fuel_stations.manage');
  const create = can('fuel.delivery.create') || manage;
  const seeCost = can('products.view_cost');
  return {
    view: can('fuel.delivery.view') || manage,
    create,
    approve: can('fuel.delivery.approve') || manage,
    seeCost,
    recordCost: seeCost && (can('fuel.delivery.cost.record') || manage),
    attach: create,
    recordReading: can('fuel.reading.record') || manage,
    canStart: create,
  };
}

/** هل لديه أي قدرة استلام (لظهور عنصر التنقل)؟ */
export function hasAnyReceiving(access: ReceivingAccess): boolean {
  return access.view || access.create || access.approve;
}
