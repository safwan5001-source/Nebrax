import type { PosCustomer } from '@/components/pos/customer-picker';

/**
 * يحوّل مرجع العميل الافتراضي القادم من إعدادات POS إلى **كيان عميل فعلي**
 * يستهلكه الكاشير، أو `null` لتبقى السلة بلا مرجع عميل حتى يختار الكاشير عميلاً مسجلاً قبل التحصيل.
 *
 * المعرّف مصدر الحقيقة: الخادم (`normalizePosDefaultCustomerForRead`) يعيد حلّه
 * داخل نطاق المستأجر/الفرع الحالي ويعيده `null` إن لم يكن عميلاً نشطاً مرئياً.
 * لذلك وجود `default_customer_id` هنا يعني مرجعاً صالحاً في السياق الحالي؛ لا
 * نعيد مطابقة الاسم ولا نبني كياناً موازياً. الاسم للعرض فقط ويُطبّع من السجل،
 * ونسقط على تسمية «العميل النقدي» إن غاب.
 */
export function resolvePosDefaultCustomer(
  config: { default_customer_id: string | null; default_customer: string },
  walkinName: string,
): PosCustomer | null {
  const id = config.default_customer_id;
  if (typeof id !== 'string' || id === '') {
    return null;
  }

  return { id, name: config.default_customer?.trim() || walkinName };
}
