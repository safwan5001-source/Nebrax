import { describe, expect, it } from 'vitest';
import { DEFAULT_TEMPLATE_ID, getTemplate, listTemplates } from './templates';
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
});
