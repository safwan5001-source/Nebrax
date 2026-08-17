import { describe, expect, it } from 'vitest';
import { mockApi } from '@/lib/mock-data';

describe('بيانات العرض لتقارير العملاء', () => {
  it('تعيد المبيعات والأرصدة وسندات القبض بعقود الواجهة المتوقعة', async () => {
    const sales = await mockApi<{ view: string; data: Array<{ invoices: number; amount: string }>; totals: { net_sales: string; tax: string }; scope: { source: string } }>('/reports/customers?view=sales');
    const balances = await mockApi<{ data: Array<{ balance: string }>; totals: { balance: string } }>('/reports/customers?view=balances');
    const receipts = await mockApi<{ data: Array<{ receipts: number; amount: string }>; totals: { receipts: number }; scope: { source: string } }>('/reports/customers?view=payments');

    expect(sales.scope.source).toBe('posted_customer_invoices');
    expect(sales.data[0]).toMatchObject({ invoices: expect.any(Number), amount: expect.any(String) });
    expect(sales.totals).toMatchObject({ net_sales: expect.any(String), tax: expect.any(String) });
    expect(balances.data[0]?.balance).toEqual(expect.any(String));
    expect(balances.totals.balance).toEqual(expect.any(String));
    expect(receipts.scope.source).toBe('posted_customer_receipts');
    expect(receipts.data[0]).toMatchObject({ receipts: expect.any(Number), amount: expect.any(String) });
  });

  it('تعيد تقرير المواعيد بحالاته التشغيلية الثلاث كاملة', async () => {
    const report = await mockApi<{ view: string; data: Array<{ appointments: number; scheduled: number; done: number; cancelled: number }>; totals: { appointments: number; scheduled: number; done: number; cancelled: number }; scope: { source: string } }>('/reports/customers?view=appointments');

    expect(report.scope.source).toBe('customer_appointments');
    expect(report.data[0]).toMatchObject({ appointments: expect.any(Number), scheduled: expect.any(Number), done: expect.any(Number), cancelled: expect.any(Number) });
    expect(report.totals.appointments).toBe(report.totals.scheduled + report.totals.done + report.totals.cancelled);
  });
});
