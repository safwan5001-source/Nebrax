/**
 * دورة الشراء — الثوابت المشتركة بين شاشاتها الأربع.
 *
 * ملف خالص بلا React ولا شبكة: مرآةٌ لما يفرضه `ProcurementService` في الـ
 * backend (السلسلة والانتقالات)، فتُعرَض الأزرار الممكنة فقط بدل أن يكتشف
 * المستخدم المنع بـ 422. الخادم يبقى مصدر الحقيقة — هذه واجهة لا حارس.
 */

export type ProcurementType = 'request' | 'rfq' | 'quotation' | 'order';

export type ProcurementStatus =
  | 'draft' | 'submitted' | 'approved' | 'rejected' | 'converted' | 'cancelled';

/** مسار الشاشة لكل نوع. */
export const PROCUREMENT_ROUTE: Record<ProcurementType, string> = {
  request: '/purchase-requests',
  rfq: '/rfq',
  quotation: '/purchase-quotes',
  order: '/purchase-orders',
};

/** الأنواع التي يلزمها مورّد محدَّد (الطلب وطلب العروض بلا مورّد بطبيعتهما). */
export const REQUIRES_SUPPLIER: ProcurementType[] = ['quotation', 'order'];

/** الانتقالات المسموحة — مرآة `ProcurementService::TRANSITIONS` عدا `converted` (بالتحويل وحده). */
export const NEXT_STATUSES: Record<ProcurementStatus, ProcurementStatus[]> = {
  draft: ['submitted', 'cancelled'],
  submitted: ['approved', 'rejected', 'cancelled'],
  approved: ['cancelled'],
  rejected: ['draft', 'cancelled'],
  converted: [],
  cancelled: [],
};

/** المرحلة التالية في السلسلة — مرآة `ProcurementService::CHAIN`. */
export const NEXT_TARGETS: Record<ProcurementType, string[]> = {
  request: ['rfq', 'order'],
  rfq: ['quotation'],
  quotation: ['order'],
  order: ['purchase'], // فاتورة مشتريات — نهاية السلسلة
};

/** التحويل متاح للمعتمَد وحده — لا يُلتزَم بمسوّدة لم يراجعها أحد. */
export function canConvert(status: ProcurementStatus): boolean {
  return status === 'approved';
}

/** المستند المُحوَّل أو الملغى نهائيّ: لا تعديل ولا انتقال بعده. */
export function isClosed(status: ProcurementStatus): boolean {
  return status === 'converted' || status === 'cancelled';
}

/** لون شارة الحالة في الجداول. */
export function statusTone(status: ProcurementStatus): 'positive' | 'muted' | 'negative' {
  if (status === 'approved' || status === 'converted') return 'positive';
  if (status === 'rejected' || status === 'cancelled') return 'negative';
  return 'muted';
}
