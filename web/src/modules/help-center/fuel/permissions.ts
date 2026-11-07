import type { LocalizedText } from './types';

/**
 * تسميات بشرية لمفاتيح صلاحيات الوقود المذكورة في الأدلة. المفاتيح نفسها من `Rbac::PERMISSIONS` في الخادم؛ هذا الجدول
 * شرح عرضٍ فقط ولا يمنح شيئاً. اختبار `fuel-help.test.ts` يمنع ذكر مفتاح لا تسمية له أو غير موجود في الخادم.
 */
export const FUEL_PERMISSION_LABELS: Record<string, LocalizedText> = {
  'fuel_stations.view': { ar: 'عرض المحطات والمضخات والخزانات (مفتاح كل مستخدم محطة)', en: 'View stations, pumps, and tanks (every station user)' },
  'fuel_stations.manage': { ar: 'إدارة بيانات المحطة وإعداداتها', en: 'Manage station data and settings' },
  'fuel.shift.view': { ar: 'عرض الورديات', en: 'View shifts' },
  'fuel.shift.open': { ar: 'فتح الوردية وتسجيل القراءات والنقد', en: 'Open a shift and record readings and cash' },
  'fuel.shift.close': { ar: 'تسليم (إغلاق) الوردية', en: 'Hand over (close) a shift' },
  'fuel.shift.cash_count': { ar: 'تسجيل النقد المعدود عند التسليم', en: 'Record the counted cash at handover' },
  'fuel.shift.approve': { ar: 'اعتماد الورديات المغلقة', en: 'Approve closed shifts' },
  'fuel.shift.cash_variance_review': { ar: 'مراجعة فروق نقد الدرج والتحصيل', en: 'Review drawer-cash and collection variances' },
  'fuel.sale.view': { ar: 'عرض مبيعات الوقود وأسعاره وفروق المطابقة', en: 'View fuel sales, prices, and reconciliation variances' },
  'fuel.sale.create': { ar: 'إنشاء مسودة بيع وقود', en: 'Create a fuel sale draft' },
  'fuel.sale.finalize': { ar: 'إنهاء بيع الوقود وفوترته', en: 'Finalise and invoice a fuel sale' },
  'fuel.sale.collect': { ar: 'تحصيل بيع الوقود بسند قبض', en: 'Collect a fuel sale with a receipt' },
  'fuel.sale.price.manage': { ar: 'إدارة أسعار الوقود', en: 'Manage fuel prices' },
  'fuel.delivery.view': { ar: 'عرض استلامات الوقود', en: 'View fuel deliveries' },
  'fuel.delivery.create': { ar: 'إنشاء مسودة استلام وقود', en: 'Create a fuel delivery draft' },
  'fuel.delivery.approve': { ar: 'اعتماد استلام الوقود', en: 'Approve a fuel delivery' },
  'fuel.delivery.cost.record': { ar: 'تسجيل تكلفة الاستلام', en: 'Record delivery cost' },
  'fuel.reading.record': { ar: 'تسجيل قراءة خزان', en: 'Record a tank reading' },
  'fuel.reading.late.record': { ar: 'تسجيل قراءة خزان بتاريخ سابق مباشرة', en: 'Record a back-dated tank reading directly' },
  'fuel.reading.late.approve': { ar: 'الموافقة على قراءات الخزانات المتأخرة', en: 'Approve late tank readings' },
  'fuel.staff.manage': { ar: 'إدارة موظفي المحطات وصلاحياتهم ورموز PIN (صلاحية محجوزة)', en: 'Manage station staff, permissions, and PINs (reserved)' },
  'fuel.governance.manage': { ar: 'حوكمة الوقود: سياسات التسليم والاعتماد والقراءات (صلاحية محجوزة)', en: 'Fuel governance: handover, approval, and reading policies (reserved)' },
  'fuel.alerts.view': { ar: 'عرض التنبيهات', en: 'View alerts' },
  'fuel.reports.view': { ar: 'عرض تقارير الوقود وملخص الجاهزية', en: 'View fuel reports and the readiness summary' },
  'fuel.maintenance.view': { ar: 'عرض الصيانة', en: 'View maintenance' },
  'fuel.safety.view': { ar: 'عرض السلامة والامتثال', en: 'View safety and compliance' },
  'products.view_cost': { ar: 'رؤية التكلفة (إلزامية لكل ما يعرض مبلغ التكلفة)', en: 'See cost values (required for anything showing a cost amount)' },
  'accounts.view': { ar: 'عرض حسابات الأستاذ (لاختيار حساب الرصيد الافتتاحي)', en: 'View ledger accounts (to choose the opening-balance account)' },
};

export function permissionLabel(key: string): LocalizedText | undefined {
  return FUEL_PERMISSION_LABELS[key];
}
