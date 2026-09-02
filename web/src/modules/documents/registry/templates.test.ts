import { describe, expect, it } from 'vitest';
import { DEFAULT_TEMPLATE_ID, getTemplate, listTemplates } from './templates';
import { TaxInvoiceClassic } from '../templates/tax-invoice-classic';
import { TaxInvoiceModern } from '../templates/tax-invoice-modern';
import { TaxInvoiceModernV2 } from '../templates/tax-invoice-modern-v2';

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
});
