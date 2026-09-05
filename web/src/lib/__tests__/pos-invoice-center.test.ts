import { describe, expect, it } from 'vitest';
import { filterPosCenterInvoices, type PosCenterInvoice } from '@/lib/pos-invoice-center';

function invoice(overrides: Partial<PosCenterInvoice>): PosCenterInvoice {
  return {
    id: overrides.id ?? 'inv-1',
    number: overrides.number ?? 'INV-0001',
    invoice_date: overrides.invoice_date ?? '2026-01-01',
    created_at: overrides.created_at ?? '2026-01-01T10:00:00Z',
    customer_name: overrides.customer_name ?? null,
    total: overrides.total ?? '100.00',
    payment_status: overrides.payment_status ?? 'paid',
    payment_methods: overrides.payment_methods ?? [],
    status: overrides.status ?? 'posted',
  };
}

describe('filterPosCenterInvoices', () => {
  it('يعيد القائمة كاملة حين يكون الاستعلام فارغاً', () => {
    const list = [invoice({ id: '1' }), invoice({ id: '2' })];
    expect(filterPosCenterInvoices(list, '')).toHaveLength(2);
    expect(filterPosCenterInvoices(list, '   ')).toHaveLength(2);
  });

  it('يطابق رقم الفاتورة جزئياً وبلا حساسية لحالة الأحرف', () => {
    const list = [invoice({ id: '1', number: 'INV-2026-0042' }), invoice({ id: '2', number: 'INV-2026-0099' })];
    expect(filterPosCenterInvoices(list, '0042')).toEqual([list[0]]);
    expect(filterPosCenterInvoices(list, 'inv-2026-0099')).toEqual([list[1]]);
  });

  it('يطابق اسم العميل جزئياً', () => {
    const list = [invoice({ id: '1', customer_name: 'محمد أحمد' }), invoice({ id: '2', customer_name: 'سارة علي' })];
    expect(filterPosCenterInvoices(list, 'أحمد')).toEqual([list[0]]);
  });

  it('لا ينهار حين يكون اسم العميل غائباً (فاتورة بلا عميل مرتبط)', () => {
    const list = [invoice({ id: '1', customer_name: null })];
    expect(filterPosCenterInvoices(list, 'أي شيء')).toEqual([]);
    expect(filterPosCenterInvoices(list, '')).toEqual(list);
  });

  it('لا يطابق شيئاً حين لا يوجد تقاطع', () => {
    const list = [invoice({ id: '1', number: 'INV-1', customer_name: 'خالد' })];
    expect(filterPosCenterInvoices(list, 'غير موجود')).toEqual([]);
  });
});
