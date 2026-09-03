/**
 * قواعد عرض مساحة قائمة فواتير المبيعات — اشتقاق بصري فقط من حقول الـ API.
 * لا يعيد حساب مبلغاً مالياً ولا يخترع حالة مجال جديدة.
 */

export function todayIsoDate(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isInvoiceDraft(status: string): boolean {
  return status === 'draft';
}

/**
 * تلميح تأخير للعرض: فاتورة مرحّلة لها متبقٍّ وتاريخ استحقاق أقدم من اليوم.
 * ليس حالة API ولا فلتر عقد.
 */
export function isInvoiceOverdue(
  invoice: {
    status: string;
    remaining: string | number | null | undefined;
    due_date: string | null | undefined;
  },
  today = todayIsoDate(),
): boolean {
  if (invoice.status !== 'posted') return false;
  if (!invoice.due_date) return false;
  if (Number(invoice.remaining) <= 0) return false;
  return invoice.due_date < today;
}

export const INVOICE_LIST_SORT_COLUMNS = ['number', 'invoice_date', 'due_date', 'total', 'remaining'] as const;

export const INVOICE_SUPPORTING_COLUMN_DEFAULTS: Record<string, boolean> = {
  subtotal: false,
  tax_amount: false,
  paid_amount: false,
};

export function hasActiveInvoiceQuery(search: string, filters: { key: string }[]): boolean {
  return Boolean(search.trim() || filters.length > 0);
}
