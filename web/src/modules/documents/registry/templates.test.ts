import { describe, expect, it } from 'vitest';
import { DEFAULT_TEMPLATE_ID, getTemplate, listTemplates, listTemplatesForDocumentType } from './templates';
import { TaxInvoiceClassic } from '../templates/tax-invoice-classic';
import { TaxInvoiceClassicV2 } from '../templates/tax-invoice-classic-v2';
import { TaxInvoiceErp } from '../templates/tax-invoice-erp';
import { TaxInvoiceErpV2 } from '../templates/tax-invoice-erp-v2';
import { TaxInvoiceModern } from '../templates/tax-invoice-modern';
import { TaxInvoiceModernV2 } from '../templates/tax-invoice-modern-v2';
import { TaxInvoiceMinimal } from '../templates/tax-invoice-minimal';
import { TaxInvoiceMinimalV2 } from '../templates/tax-invoice-minimal-v2';
import { TaxInvoiceRetail } from '../templates/tax-invoice-retail';
import { TaxInvoiceRetailV2 } from '../templates/tax-invoice-retail-v2';
import { QuotationProposal } from '../templates/quotation-proposal';
import { PurchaseOrderFormal } from '../templates/purchase-order-formal';

describe('سجل قوالب المستندات', () => {
  it('يبقي الافتراضي classic ولا يعيد تفسير modern كـ v2', () => {
    expect(DEFAULT_TEMPLATE_ID).toBe('tax-invoice-classic');
    expect(getTemplate(null).id).toBe('tax-invoice-classic');
    expect(getTemplate(undefined).id).toBe('tax-invoice-classic');
    expect(getTemplate('unknown-template-id').id).toBe('tax-invoice-classic');
    expect(getTemplate('unknown-template-id').component).toBe(TaxInvoiceClassic);
  });

  it('يسجّل tax-invoice-modern وtax-invoice-modern-v2 كهويتين مستقلتين', () => {
    const modern = getTemplate('tax-invoice-modern');
    const modernV2 = getTemplate('tax-invoice-modern-v2');

    expect(modern.id).toBe('tax-invoice-modern');
    expect(modern.nameKey).toBe('modern');
    expect(modern.component).toBe(TaxInvoiceModern);

    expect(modernV2.id).toBe('tax-invoice-modern-v2');
    expect(modernV2.nameKey).toBe('modern_v2');
    expect(modernV2.component).toBe(TaxInvoiceModernV2);

    expect(modern.component).not.toBe(modernV2.component);
    expect(modern).not.toBe(modernV2);
  });

  it('يُظهر V2 في الكتالوج دون alias من modern', () => {
    const ids = listTemplates().map((template) => template.id);
    expect(ids).toContain('tax-invoice-modern');
    expect(ids).toContain('tax-invoice-modern-v2');
    expect(ids.filter((id) => id === 'tax-invoice-modern')).toHaveLength(1);
    expect(ids.filter((id) => id === 'tax-invoice-modern-v2')).toHaveLength(1);
  });

  it('يسجّل tax-invoice-erp وtax-invoice-erp-v2 كهويتين مستقلتين بلا alias', () => {
    const erp = getTemplate('tax-invoice-erp');
    const erpV2 = getTemplate('tax-invoice-erp-v2');

    expect(erp.id).toBe('tax-invoice-erp');
    expect(erp.nameKey).toBe('erp');
    expect(erp.component).toBe(TaxInvoiceErp);
    expect(erp.defaultTheme).toBe('gray');

    expect(erpV2.id).toBe('tax-invoice-erp-v2');
    expect(erpV2.nameKey).toBe('erp_v2');
    expect(erpV2.component).toBe(TaxInvoiceErpV2);
    expect(erpV2.defaultTheme).toBe('gray');

    expect(erp.component).not.toBe(erpV2.component);
    expect(erp).not.toBe(erpV2);

    const ids = listTemplates().map((template) => template.id);
    expect(ids).toContain('tax-invoice-erp');
    expect(ids).toContain('tax-invoice-erp-v2');
    expect(ids.filter((id) => id === 'tax-invoice-erp')).toHaveLength(1);
    expect(ids.filter((id) => id === 'tax-invoice-erp-v2')).toHaveLength(1);
  });

  it('يسجّل tax-invoice-classic وtax-invoice-classic-v2 كهويتين مستقلتين بلا alias', () => {
    const classic = getTemplate('tax-invoice-classic');
    const classicV2 = getTemplate('tax-invoice-classic-v2');

    expect(classic.id).toBe('tax-invoice-classic');
    expect(classic.nameKey).toBe('classic');
    expect(classic.component).toBe(TaxInvoiceClassic);
    expect(classic.defaultTheme).toBe('blue');

    expect(classicV2.id).toBe('tax-invoice-classic-v2');
    expect(classicV2.nameKey).toBe('classic_v2');
    expect(classicV2.component).toBe(TaxInvoiceClassicV2);
    expect(classicV2.defaultTheme).toBe('blue');

    expect(classic.component).not.toBe(classicV2.component);
    expect(classic).not.toBe(classicV2);
    expect(DEFAULT_TEMPLATE_ID).toBe('tax-invoice-classic');

    const ids = listTemplates().map((template) => template.id);
    expect(ids).toContain('tax-invoice-classic');
    expect(ids).toContain('tax-invoice-classic-v2');
    expect(ids.filter((id) => id === 'tax-invoice-classic')).toHaveLength(1);
    expect(ids.filter((id) => id === 'tax-invoice-classic-v2')).toHaveLength(1);
  });

  it('يسجّل tax-invoice-minimal وtax-invoice-minimal-v2 كهويتين مستقلتين بلا alias', () => {
    const minimal = getTemplate('tax-invoice-minimal');
    const minimalV2 = getTemplate('tax-invoice-minimal-v2');

    expect(minimal.id).toBe('tax-invoice-minimal');
    expect(minimal.nameKey).toBe('minimal');
    expect(minimal.component).toBe(TaxInvoiceMinimal);
    expect(minimal.defaultTheme).toBe('black');

    expect(minimalV2.id).toBe('tax-invoice-minimal-v2');
    expect(minimalV2.nameKey).toBe('minimal_v2');
    expect(minimalV2.component).toBe(TaxInvoiceMinimalV2);
    expect(minimalV2.defaultTheme).toBe('black');

    expect(minimal.component).not.toBe(minimalV2.component);
    expect(minimal).not.toBe(minimalV2);
    expect(DEFAULT_TEMPLATE_ID).toBe('tax-invoice-classic');

    const ids = listTemplates().map((template) => template.id);
    expect(ids).toContain('tax-invoice-minimal');
    expect(ids).toContain('tax-invoice-minimal-v2');
    expect(ids.filter((id) => id === 'tax-invoice-minimal')).toHaveLength(1);
    expect(ids.filter((id) => id === 'tax-invoice-minimal-v2')).toHaveLength(1);
  });

  it('يسجّل tax-invoice-retail وtax-invoice-retail-v2 كهويتين مستقلتين بلا alias', () => {
    const retail = getTemplate('tax-invoice-retail');
    const retailV2 = getTemplate('tax-invoice-retail-v2');

    expect(retail.id).toBe('tax-invoice-retail');
    expect(retail.nameKey).toBe('retail');
    expect(retail.component).toBe(TaxInvoiceRetail);
    expect(retail.defaultTheme).toBe('blue');

    expect(retailV2.id).toBe('tax-invoice-retail-v2');
    expect(retailV2.nameKey).toBe('retail_v2');
    expect(retailV2.component).toBe(TaxInvoiceRetailV2);
    expect(retailV2.defaultTheme).toBe('blue');

    expect(retail.component).not.toBe(retailV2.component);
    expect(retail).not.toBe(retailV2);
    expect(DEFAULT_TEMPLATE_ID).toBe('tax-invoice-classic');

    const ids = listTemplates().map((template) => template.id);
    expect(ids).toContain('tax-invoice-retail');
    expect(ids).toContain('tax-invoice-retail-v2');
    expect(ids.filter((id) => id === 'tax-invoice-retail')).toHaveLength(1);
    expect(ids.filter((id) => id === 'tax-invoice-retail-v2')).toHaveLength(1);
  });

  it('يسجّل quotation-proposal بهوية مستقلة بلا alias إلى الفاتورة', () => {
    const proposal = getTemplate('quotation-proposal');
    expect(proposal.id).toBe('quotation-proposal');
    expect(proposal.nameKey).toBe('quotation_proposal');
    expect(proposal.component).toBe(QuotationProposal);
    expect(proposal.defaultTheme).toBe('blue');
    expect(proposal.documentTypes).toEqual(['quotation']);
    expect(proposal.supportedPaper).toEqual(['a4', 'a4_landscape', 'letter', 'legal']);
    expect(DEFAULT_TEMPLATE_ID).toBe('tax-invoice-classic');
    expect(getTemplate('unknown-template-id').id).toBe('tax-invoice-classic');
    expect(getTemplate('quotation-proposal').component).not.toBe(TaxInvoiceClassic);

    const ids = listTemplates().map((template) => template.id);
    expect(ids).toContain('quotation-proposal');
    expect(ids.filter((id) => id === 'quotation-proposal')).toHaveLength(1);
    expect(ids).not.toContain('tax-invoice-quotation');
  });

  it('يظهر quotation-proposal في كتالوج عرض السعر فقط لا الفاتورة ولا الحراري', () => {
    const quotationIds = listTemplatesForDocumentType('quotation').map((template) => template.id);
    const invoiceIds = listTemplatesForDocumentType('tax_invoice').map((template) => template.id);
    const thermalIds = listTemplatesForDocumentType('tax_invoice')
      .filter((template) => template.supportedPaper.some((paper) => paper.startsWith('thermal_')))
      .map((template) => template.id);

    expect(quotationIds).toContain('quotation-proposal');
    expect(quotationIds).toContain('tax-invoice-classic');
    expect(invoiceIds).not.toContain('quotation-proposal');
    expect(invoiceIds).toContain('tax-invoice-classic');
    expect(invoiceIds).toContain('tax-invoice-classic-v2');
    expect(thermalIds).toContain('tax-invoice-thermal58');
    expect(thermalIds).toContain('tax-invoice-thermal80');
    expect(thermalIds).not.toContain('quotation-proposal');
  });

  it('يسجّل purchase-order-formal بهوية مستقلة بلا alias إلى الفاتورة أو عرض السعر', () => {
    const formal = getTemplate('purchase-order-formal');
    expect(formal.id).toBe('purchase-order-formal');
    expect(formal.nameKey).toBe('purchase_order_formal');
    expect(formal.component).toBe(PurchaseOrderFormal);
    expect(formal.defaultTheme).toBe('gray');
    expect(formal.documentTypes).toEqual(['purchase_order']);
    expect(formal.supportedPaper).toEqual(['a4', 'a4_landscape', 'letter', 'legal']);
    expect(DEFAULT_TEMPLATE_ID).toBe('tax-invoice-classic');
    expect(getTemplate('unknown-template-id').id).toBe('tax-invoice-classic');
    expect(getTemplate('purchase-order-formal').component).not.toBe(TaxInvoiceClassic);
    expect(getTemplate('purchase-order-formal').component).not.toBe(QuotationProposal);

    const ids = listTemplates().map((template) => template.id);
    expect(ids).toContain('purchase-order-formal');
    expect(ids.filter((id) => id === 'purchase-order-formal')).toHaveLength(1);
    expect(ids).not.toContain('tax-invoice-purchase-order');
    expect(ids).not.toContain('quotation-proposal-purchase');
  });

  it('يظهر purchase-order-formal في كتالوج أمر الشراء فقط لا الفاتورة ولا عرض السعر ولا الحراري', () => {
    const purchaseOrderIds = listTemplatesForDocumentType('purchase_order').map((template) => template.id);
    const quotationIds = listTemplatesForDocumentType('quotation').map((template) => template.id);
    const invoiceIds = listTemplatesForDocumentType('tax_invoice').map((template) => template.id);
    const thermalIds = listTemplatesForDocumentType('tax_invoice')
      .filter((template) => template.supportedPaper.some((paper) => paper.startsWith('thermal_')))
      .map((template) => template.id);

    expect(purchaseOrderIds).toContain('purchase-order-formal');
    expect(purchaseOrderIds).toContain('tax-invoice-classic');
    expect(purchaseOrderIds).not.toContain('quotation-proposal');
    expect(quotationIds).not.toContain('purchase-order-formal');
    expect(quotationIds).toContain('quotation-proposal');
    expect(invoiceIds).not.toContain('purchase-order-formal');
    expect(invoiceIds).toContain('tax-invoice-classic');
    expect(thermalIds).toContain('tax-invoice-thermal58');
    expect(thermalIds).toContain('tax-invoice-thermal80');
    expect(thermalIds).not.toContain('purchase-order-formal');
  });
});
