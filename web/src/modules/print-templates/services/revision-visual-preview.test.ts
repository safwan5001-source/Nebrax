import { describe, expect, it } from 'vitest';
import { getRevisionVisualPreview } from './revision-visual-preview';

describe('معاينة المراجعة المرئية', () => {
  it('يبني معاينة آمنة من تعريف المراجعة المجمدة', () => {
    const preview = getRevisionVisualPreview({
      id: 'revision-2',
      version: 2,
      document_types: ['quotation'],
      definition: {
        template_id: 'tax-invoice-modern',
        theme_id: 'gray',
        show_logo: false,
        footer_text: 'تذييل مراجعة محفوظة',
        layout: [{ key: 'header', visible: true }, { key: 'footer', visible: true }],
      },
    });

    expect(preview).toMatchObject({
      documentType: 'quotation',
      templateId: 'tax-invoice-modern',
      themeId: 'gray',
      showLogo: false,
      rootId: 'print-template-revision-preview-revision-2',
    });
    expect(preview.model.footerText).toBe('تذييل مراجعة محفوظة');
    expect(preview.layout).toEqual([{ key: 'header', visible: true }, { key: 'footer', visible: true }]);
  });

  it('يعرض المراجعة القديمة بتخطيط افتراضي آمن عند غياب الخصائص الحديثة', () => {
    const preview = getRevisionVisualPreview({
      id: 'legacy-revision',
      version: 1,
      document_types: ['نوع غير معروف'],
      definition: { theme_id: 'legacy-unknown-theme' },
    });

    expect(preview.documentType).toBe('tax_invoice');
    expect(preview.templateId).toBe('tax-invoice-classic');
    expect(preview.themeId).toBe('blue');
    expect(preview.showLogo).toBe(true);
    expect(preview.layout.map((item) => item.key)).toContain('items');
  });
});
