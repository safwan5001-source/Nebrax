import { describe, expect, it } from 'vitest';
import { resolveLiveTemplateDefinition } from './live-template-definition';

describe('محول تعريف القالب الحي', () => {
  it('يحوّل المراجعة المنشورة الحديثة إلى قيم عارض الفاتورة', () => {
    const resolved = resolveLiveTemplateDefinition({
      print_template_revision_id: 'revision-1',
      revision: {
        id: 'revision-1',
        definition: {
          template_id: 'tax-invoice-modern',
          theme_id: 'gray',
          show_logo: false,
          footer_text: 'تذييل منشور',
          terms_text: 'شروط منشورة',
          bank_text: 'IBAN SA0000000000000000000000',
          layout: [
            { key: 'header', visible: true },
            { key: 'parties', visible: true },
            { key: 'items', visible: true },
            { key: 'summary', visible: true },
            { key: 'footer', visible: true },
          ],
        },
      },
    }, 'tax_invoice');

    expect(resolved).toMatchObject({
      templateId: 'tax-invoice-modern',
      themeId: 'gray',
      showLogo: false,
      footerText: 'تذييل منشور',
      termsText: 'شروط منشورة',
      bankText: 'IBAN SA0000000000000000000000',
    });
    expect(resolved?.layout).toHaveLength(5);
  });

  it('لا يفسر تعريف الهجرة القديم تفسيراً جزئياً ويترك الصفحة لمسار التوافق', () => {
    expect(resolveLiveTemplateDefinition({
      print_template_revision_id: 'legacy-revision',
      revision: {
        id: 'legacy-revision',
        definition: { legacy_sales_designs: { template: 'classic', footer_text: 'قديم' } },
      },
    }, 'tax_invoice')).toBeNull();
  });

  it('يملأ تخطيط النوع الافتراضي عند غيابه من تعريف حديث', () => {
    const resolved = resolveLiveTemplateDefinition({
      print_template_revision_id: 'revision-2',
      revision: { id: 'revision-2', definition: { template_id: 'tax-invoice-retail' } },
    }, 'tax_invoice');

    expect(resolved?.templateId).toBe('tax-invoice-retail');
    expect(resolved?.layout.map((block) => block.key)).toContain('items');
  });

  it('يطبق تعريف عرض السعر الحي على التذييل والشروط المنشورة', () => {
    const resolved = resolveLiveTemplateDefinition({
      print_template_revision_id: 'quote-revision',
      revision: {
        id: 'quote-revision',
        definition: { template_id: 'tax-invoice-modern', footer_text: 'تذييل عرض منشور', terms_text: 'شروط العرض' },
      },
    }, 'quotation');

    expect(resolved).toMatchObject({
      templateId: 'tax-invoice-modern',
      footerText: 'تذييل عرض منشور',
      termsText: 'شروط العرض',
    });
    expect(resolved?.layout.map((block) => block.key)).toContain('summary');
  });

  it('يحافظ على هوية tax-invoice-modern-v2 دون سقوط إلى التاريخي أو classic', () => {
    const resolved = resolveLiveTemplateDefinition({
      print_template_revision_id: 'v2-revision',
      revision: {
        id: 'v2-revision',
        definition: { template_id: 'tax-invoice-modern-v2', footer_text: 'تذييل V2' },
      },
    }, 'tax_invoice');

    expect(resolved?.templateId).toBe('tax-invoice-modern-v2');
    expect(resolved?.footerText).toBe('تذييل V2');
  });

  it('يطبق تعريف السند الحي على كتلة السند والبيانات البنكية', () => {
    const resolved = resolveLiveTemplateDefinition({
      print_template_revision_id: 'voucher-revision',
      revision: {
        id: 'voucher-revision',
        definition: { template_id: 'tax-invoice-classic', bank_text: 'IBAN SA0000000000000000000000' },
      },
    }, 'receipt_voucher');

    expect(resolved?.bankText).toBe('IBAN SA0000000000000000000000');
    expect(resolved?.layout.map((block) => block.key)).toContain('voucher');
  });
});
