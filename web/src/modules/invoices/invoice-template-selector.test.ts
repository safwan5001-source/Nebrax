import { describe, expect, it } from 'vitest';
import {
  findInvoiceDesignTemplate,
  invoiceDesignCatalogType,
  invoiceDesignCompatibleTypes,
  isThermalPrintDefinition,
  publishedInvoiceDesignTemplates,
  revisionSupportsInvoiceDesign,
  selectedInvoiceDesignIsCompatible,
  type InvoiceLibraryTemplate,
} from './invoice-template-selector';

function template(partial: Partial<InvoiceLibraryTemplate> & Pick<InvoiceLibraryTemplate, 'id' | 'name'>): InvoiceLibraryTemplate {
  return {
    document_types: ['tax_invoice'],
    published_revision_id: `${partial.id}-rev`,
    published_revision: {
      id: `${partial.id}-rev`,
      status: 'published',
      document_types: partial.document_types ?? ['tax_invoice'],
      definition: { template_id: 'tax-invoice-classic' },
    },
    ...partial,
  };
}

describe('invoiceDesignCatalogType', () => {
  it('يربط المبسطة بنوع الكتالوج المستقل', () => {
    expect(invoiceDesignCatalogType('simplified')).toBe('simplified_tax_invoice');
    expect(invoiceDesignCatalogType('standard')).toBe('tax_invoice');
    expect(invoiceDesignCatalogType(null)).toBe('tax_invoice');
  });
});

describe('revisionSupportsInvoiceDesign', () => {
  it('يقبل قالب فاتورة ضريبية لفاتورة قياسية', () => {
    expect(revisionSupportsInvoiceDesign(
      ['tax_invoice'],
      { template_id: 'tax-invoice-modern' },
      'tax_invoice',
    )).toBe(true);
  });

  it('يقبل قالب tax_invoice لفاتورة مبسطة كما يسقط التعيين الحي', () => {
    expect(invoiceDesignCompatibleTypes('simplified_tax_invoice')).toEqual([
      'simplified_tax_invoice',
      'tax_invoice',
    ]);
    expect(revisionSupportsInvoiceDesign(
      ['tax_invoice'],
      { template_id: 'tax-invoice-classic' },
      'simplified_tax_invoice',
    )).toBe(true);
  });

  it('يرفض الحراري وعرض السعر وأمر الشراء', () => {
    expect(isThermalPrintDefinition({ template_id: 'tax-invoice-thermal80' })).toBe(true);
    expect(revisionSupportsInvoiceDesign(
      ['tax_invoice'],
      { template_id: 'tax-invoice-thermal80' },
      'tax_invoice',
    )).toBe(false);
    expect(revisionSupportsInvoiceDesign(
      ['quotation'],
      { template_id: 'quotation-proposal' },
      'tax_invoice',
    )).toBe(false);
    expect(revisionSupportsInvoiceDesign(
      ['purchase_order'],
      { template_id: 'purchase-order-formal' },
      'tax_invoice',
    )).toBe(false);
  });
});

describe('publishedInvoiceDesignTemplates', () => {
  const library: InvoiceLibraryTemplate[] = [
    template({ id: 'classic', name: 'كلاسيك' }),
    template({
      id: 'thermal',
      name: 'حراري',
      published_revision: {
        id: 'thermal-rev',
        status: 'published',
        document_types: ['tax_invoice'],
        definition: { template_id: 'tax-invoice-thermal58' },
      },
      published_revision_id: 'thermal-rev',
    }),
    template({
      id: 'quote',
      name: 'عرض',
      document_types: ['quotation'],
      published_revision_id: 'quote-rev',
      published_revision: {
        id: 'quote-rev',
        status: 'published',
        document_types: ['quotation'],
        definition: { template_id: 'quotation-proposal' },
      },
    }),
    template({
      id: 'draft-only',
      name: 'مسودة',
      published_revision_id: null,
      published_revision: null,
    }),
    template({
      id: 'simple',
      name: 'مبسطة',
      document_types: ['simplified_tax_invoice'],
      published_revision_id: 'simple-rev',
      published_revision: {
        id: 'simple-rev',
        status: 'published',
        document_types: ['simplified_tax_invoice'],
        definition: { template_id: 'tax-invoice-minimal' },
      },
    }),
  ];

  it('يُظهر المنشورة المتوافقة فقط ويستبعد الحراري وغير الفاتورة', () => {
    const filtered = publishedInvoiceDesignTemplates(library, 'tax_invoice');
    expect(filtered.map((item) => item.id)).toEqual(['classic']);
  });

  it('يُظهر قوالب المبسطة وtax_invoice معاً لنوع مبسطة', () => {
    const filtered = publishedInvoiceDesignTemplates(library, 'simplified_tax_invoice');
    expect(filtered.map((item) => item.id).sort()).toEqual(['classic', 'simple']);
  });

  it('يعتبر التجاوز متوافقاً فقط إن وُجد في القائمة المفلترة', () => {
    expect(selectedInvoiceDesignIsCompatible(library, 'tax_invoice', null)).toBe(true);
    expect(selectedInvoiceDesignIsCompatible(library, 'tax_invoice', 'classic-rev')).toBe(true);
    expect(selectedInvoiceDesignIsCompatible(library, 'tax_invoice', 'thermal-rev')).toBe(false);
    expect(findInvoiceDesignTemplate(library, 'classic-rev')?.name).toBe('كلاسيك');
  });
});
