import { describe, expect, it } from 'vitest';
import { compareTemplateRevisions, formatRevisionValue } from './revision-comparison';

describe('مقارنة مراجعات القالب', () => {
  it('تعرض فقط الحقول التي تغيرت بين تعريفين محفوظين', () => {
    const changes = compareTemplateRevisions(
      {
        documentTypes: ['quotation', 'tax_invoice'],
        definition: {
          template_id: 'tax-invoice-classic',
          footer_text: 'تذييل سابق',
          layout: [{ key: 'header', visible: true }],
        },
      },
      {
        documentTypes: ['tax_invoice', 'quotation'],
        definition: {
          template_id: 'tax-invoice-classic',
          footer_text: 'تذييل لاحق',
          layout: [{ key: 'header', visible: true }, { key: 'footer', visible: true }],
        },
      },
    );

    expect(changes).toEqual([
      { path: 'definition.footer_text', before: 'تذييل سابق', after: 'تذييل لاحق' },
      {
        path: 'definition.layout',
        before: [{ key: 'header', visible: true }],
        after: [{ key: 'header', visible: true }, { key: 'footer', visible: true }],
      },
    ]);
  });

  it('يفرق بين إضافة الحقل وحذفه ويعرض القيمة الغائبة بوضوح', () => {
    const changes = compareTemplateRevisions(
      { documentTypes: ['tax_invoice'], definition: { template_id: 'tax-invoice-classic', footer_text: 'حذف' } },
      { documentTypes: ['tax_invoice'], definition: { template_id: 'tax-invoice-classic', terms_text: 'إضافة' } },
    );

    expect(changes).toEqual([
      { path: 'definition.footer_text', before: 'حذف', after: undefined },
      { path: 'definition.terms_text', before: undefined, after: 'إضافة' },
    ]);
    expect(formatRevisionValue(changes[0].after, '—')).toBe('—');
  });

  it('يكشف تغيير ترتيب الكتل بوصفه تغييراً بنيوياً مقصوداً', () => {
    const changes = compareTemplateRevisions(
      { documentTypes: ['tax_invoice'], definition: { layout: [{ key: 'header' }, { key: 'items' }] } },
      { documentTypes: ['tax_invoice'], definition: { layout: [{ key: 'items' }, { key: 'header' }] } },
    );

    expect(changes).toHaveLength(1);
    expect(changes[0].path).toBe('definition.layout');
  });
});
