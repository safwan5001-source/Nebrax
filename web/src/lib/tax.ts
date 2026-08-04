import { api } from './api';

interface TaxDef { name: string; rate: number; inclusive: boolean }

/**
 * الوضع الافتراضي للضريبة من إعدادات النظام (`sales-config/taxes`):
 * هل الضريبة الرئيسية — أول نسبة موجبة، وإلا الأولى — «متضمَّنة» في السعر؟
 * مصدر واحد تستهلكه كل شاشات الإنشاء (فاتورة/عرض سعر/مشتريات/POS) فيتّسق الوضع.
 */
export async function getSystemTaxInclusive(): Promise<boolean> {
  try {
    const r = await api<{ data: TaxDef[] }>('/sales-config/taxes');
    const primary = r.data.find((x) => Number(x.rate) > 0) ?? r.data[0];
    return !!primary?.inclusive;
  } catch {
    return false;
  }
}
