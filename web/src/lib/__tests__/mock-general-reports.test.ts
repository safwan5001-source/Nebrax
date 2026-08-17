import { describe, expect, it } from 'vitest';
import { mockApi } from '../mock-data';

describe('بيانات العرض لتقارير الحسابات العامة', () => {
  it('تعيد التدفق النقدي المباشر بأقسامه الثلاثة كاملة', async () => {
    const response = await mockApi<{
      operating: { entries: unknown[] };
      investing: { entries: unknown[] };
      financing: { entries: unknown[] };
      net_cash_flow: string;
    }>('/reports/cash-flow');

    expect(Array.isArray(response.operating.entries)).toBe(true);
    expect(Array.isArray(response.investing.entries)).toBe(true);
    expect(Array.isArray(response.financing.entries)).toBe(true);
    expect(response.net_cash_flow).toMatch(/^-?\d+\.\d{2}$/);
  });

  it('تعيد القيود والضريبة وكشف الأستاذ بعقود العرض المتوقعة', async () => {
    const [journal, tax, ledger] = await Promise.all([
      mockApi<{ rows: unknown[]; total_debit: string; total_credit: string }>('/reports/journal-entries'),
      mockApi<{ input_vat: string; output_vat: string; net_vat: string; status: string }>('/reports/tax-report'),
      mockApi<{ account: { code: string }; rows: unknown[]; closing_balance: string }>('/reports/account-ledger/a1110'),
    ]);

    expect(Array.isArray(journal.rows)).toBe(true);
    expect(journal.total_debit).toBe(journal.total_credit);
    expect(tax.status).toBe('payable');
    expect(ledger.account.code).toBe('1110');
    expect(Array.isArray(ledger.rows)).toBe(true);
    expect(ledger.closing_balance).toMatch(/^-?\d+\.\d{2}$/);
  });
});
