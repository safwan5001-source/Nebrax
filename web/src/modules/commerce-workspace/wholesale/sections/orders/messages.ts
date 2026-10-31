import { defineMessages } from '../../messages/factory';

/** Wholesale-specific wording only; order/payment/status vocabulary is reused from `orders/messages.ts`. */
const ar = {
  description: 'طلبات قناة الجملة فقط. الطلب التجاري ليس فاتورة: لا يُنشأ قيد أو فاتورة أو حركة مخزون بمجرد وصول الطلب، وحالة الدفع منفصلة عن حالة الطلب.',
  channelScope: 'القناة: {channel}',
  filtersLabel: 'تصفية طلبات الجملة',
  resultsCount: '{count} طلب',
  buyer: 'المشتري',
  open: 'تفاصيل',
  openAria: 'تفاصيل الطلب {number}',
  detailHint: 'ملخص للقراءة. الإجراءات المصرَّح بها تُنفَّذ من صفحة الطلب الكاملة.',
  detailLoadError: 'تعذّر تحميل تفاصيل الطلب.',
  openFull: 'فتح صفحة الطلب الكاملة',
  sectionActions: 'الإجراءات المصرَّح بها',
  actionCancelAvailable: 'إلغاء الطلب متاح لك على هذا الطلب. يُنفَّذ من صفحة الطلب الكاملة بعد تأكيد السبب.',
  actionCancelBlocked: 'الإلغاء غير متاح: {reason}',
  actionNone: 'لا إجراء مصرَّح به معروض لهذا الطلب. قد تكون صلاحية الإلغاء أو بوابتها غير مفعّلة.',
  accountingPostedLine: 'مُرحَّل: فاتورة وسند قبض مرتبطان.',
  accountingNotPostedLine: 'لم يُرحَّل محاسبياً بعد. حالة الدفع لا تعني قيداً محاسبياً.',
  contactSection: 'المشتري والاتصال',
  itemsSection: 'البنود',
  paymentSection: 'الدفع',
  accountingSection: 'الترحيل المحاسبي',
  totalsSection: 'الإجمالي',
  noItems: 'لا بنود.',
} as const;

const en: Record<keyof typeof ar, string> = {
  description: 'Orders of the wholesale channel only. A commerce order is not an invoice: no entry, invoice or stock movement is created when an order arrives, and payment status is separate from order status.',
  channelScope: 'Channel: {channel}',
  filtersLabel: 'Filter wholesale orders',
  resultsCount: '{count} orders',
  buyer: 'Buyer',
  open: 'Details',
  openAria: 'Details of order {number}',
  detailHint: 'Read-only summary. Authorised actions are performed on the full order page.',
  detailLoadError: 'Could not load the order details.',
  openFull: 'Open full order page',
  sectionActions: 'Authorised actions',
  actionCancelAvailable: 'Cancelling this order is available to you. It is performed on the full order page after confirming the reason.',
  actionCancelBlocked: 'Cancellation is not available: {reason}',
  actionNone: 'No authorised action is shown for this order. The cancel permission or its deployment gate may be off.',
  accountingPostedLine: 'Posted: linked invoice and receipt.',
  accountingNotPostedLine: 'Not posted to accounting yet. Payment status does not imply an accounting entry.',
  contactSection: 'Buyer and contact',
  itemsSection: 'Items',
  paymentSection: 'Payment',
  accountingSection: 'Accounting posting',
  totalsSection: 'Totals',
  noItems: 'No items.',
};

export const wholesaleOrdersMessages = defineMessages(ar, en);
export type WholesaleOrdersMessageKey = keyof typeof ar;
