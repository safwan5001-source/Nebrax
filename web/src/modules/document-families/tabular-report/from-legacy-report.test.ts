import { describe, expect, it } from 'vitest';
import { buildTabularReportDocument } from './from-legacy-report';

describe('Tabular report family builder', () => {
  it('keeps source rows and total row in a structured export contract', () => {
    const document = buildTabularReportDocument({
      reportKey: 'customer_balances',
      title: 'أرصدة العملاء',
      asOf: '2026-08-22',
      company: { name: 'نبراس', vat_number: '310122334400003' },
      columns: [
        { label: 'العميل', align: 'start' },
        { label: 'الرصيد', align: 'end' },
      ],
      rows: [
        ['شركة الندى', '1,650.00'],
        ['مؤسسة الأفق', '500.00'],
      ],
      totalRow: ['الإجمالي', '2,150.00'],
      generatedAt: '2026-08-22T09:00:00.000Z',
    });

    expect(document.family).toBe('tabular_report');
    expect(document.columns).toEqual([
      { id: 'column_0', labelKey: 'العميل', valueKind: 'text', alignment: 'start' },
      { id: 'column_1', labelKey: 'الرصيد', valueKind: 'text', alignment: 'end' },
    ]);
    expect(document.groups[0].rows[0].cells).toEqual({
      column_0: { kind: 'text', value: 'شركة الندى' },
      column_1: { kind: 'text', value: '1,650.00' },
    });
    expect(document.grandTotal).toEqual({
      column_0: { kind: 'text', value: 'الإجمالي' },
      column_1: { kind: 'text', value: '2,150.00' },
    });
  });
});
