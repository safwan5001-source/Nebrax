import { describe, expect, it } from 'vitest';
import type { SourceCompany, SourceCustomer, SourceInvoice } from '@/modules/documents/builder/from-invoice';
import { buildInvoiceLineItemDocument } from './from-invoice';
import { lineItemDocumentToLegacyModel } from './to-legacy-document-model';

const company: SourceCompany = {
  name: 'نبراس للتجارة',
  vat_number: '310122393500003',
  cr_number: '2050123456',
  building_no: '7404',
  street: 'شارع الحارث بن عبدالله',
  additional_no: '3185',
  district: 'الخضراء',
  city: 'مكة المكرمة',
  postal_code: '24267',
  phone: '0123456789',
};

const customer: SourceCustomer = {
  name: 'مؤسسة العميل',
  vat_number: '310000000000003',
  city: 'الدمام',
};

const invoice: SourceInvoice = {
  number: 'INV-2026-0101',
  invoice_date: '2026-08-22',
  payment_type: 'cash',
  subtotal: '1,000.00',
  tax_amount: '150.00',
  total: '1,150.00',
  notes: 'تنفيذ شهري',
  lines: [{
    id: 'line-1',
    product_name: 'خدمة استشارية',
    product_code: 'SRV-100',
    barcode: '628100000001',
    description: 'خدمة شهر أغسطس',
    quantity: 1,
    unit_price: '1,150.00',
    unit_price_before_tax: '1,000.00',
    tax_rate: 15,
    line_tax: '150.00',
    line_total: '1,150.00',
  }],
};

describe('Line-item family builder', () => {
  it('builds a line-item contract with source totals and no voucher body', () => {
    const document = buildInvoiceLineItemDocument({ invoice, company, customer, qr: 'preview-qr' });

    expect(document.family).toBe('line_item');
    expect(document.type).toBe('tax_invoice');
    expect(document.totals).toEqual({ subtotal: 100000, tax: 15000, total: 115000 });
    expect(document.lines[0]).toMatchObject({
      productName: 'خدمة استشارية',
      productCode: 'SRV-100',
      barcode: '628100000001',
      priceBeforeTax: 100000,
      unitPrice: 115000,
    });
    expect('voucher' in document).toBe(false);
  });

  it('preserves national address details and QR when crossing to the legacy renderer', () => {
    const document = buildInvoiceLineItemDocument({ invoice, company, customer, qr: 'preview-qr' });
    const legacy = lineItemDocumentToLegacyModel(document);

    expect(legacy.seller).toMatchObject({
      address: '7404، شارع الحارث بن عبدالله، 3185، الخضراء، مكة المكرمة، 24267',
      phone: '0123456789',
    });
    expect(legacy.qr).toEqual({ value: 'preview-qr' });
    expect(legacy.voucher).toBeNull();
  });
});
