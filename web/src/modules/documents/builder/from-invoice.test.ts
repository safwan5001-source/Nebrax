import { describe, expect, it } from 'vitest';
import { buildInvoiceDocumentModel } from './from-invoice';

describe('buildInvoiceDocumentModel', () => {
  it('preserves the product snapshot and net unit price for document columns', () => {
    const model = buildInvoiceDocumentModel({
      invoice: {
        number: 'INV-2026-0001',
        invoice_date: '2026-08-17',
        payment_type: 'cash',
        subtotal: '1000.00',
        tax_amount: '150.00',
        total: '1150.00',
        lines: [{
          id: 'line-1',
          product_name: 'صنف محفوظ',
          product_code: 'SKU-001',
          barcode: '6281234567890',
          description: 'وصف قديم',
          quantity: 1,
          unit_price: '1150.00',
          unit_price_before_tax: '1000.00',
          tax_rate: 15,
          line_tax: '150.00',
          line_total: '1150.00',
        }],
      },
      company: null,
      customer: null,
      qr: null,
    });

    expect(model.lines[0]).toMatchObject({
      productName: 'صنف محفوظ',
      productCode: 'SKU-001',
      barcode: '6281234567890',
      description: 'وصف قديم',
      priceBeforeTax: 100000,
      unitPrice: 115000,
    });
  });

  it('builds the seller national address and contact details from the company profile', () => {
    const model = buildInvoiceDocumentModel({
      invoice: {
        number: 'INV-2026-0002',
        invoice_date: '2026-08-18',
        payment_type: 'credit',
        subtotal: '100.00',
        tax_amount: '15.00',
        total: '115.00',
        lines: [],
      },
      company: {
        name: 'نبراس للتجارة',
        vat_number: '310122393500003',
        cr_number: '2050123456',
        building_no: '7404',
        street: 'شارع الحارث بن عبدالله',
        additional_no: '3185',
        district: 'الخضراء',
        city: 'مكة المكرمة',
        postal_code: '24267',
        short_address: 'RDHA7404',
        phone: '0123456789',
        mobile: '0551234567',
      },
      customer: null,
      qr: null,
    });

    expect(model.seller).toMatchObject({
      address: '7404، شارع الحارث بن عبدالله، 3185، الخضراء، مكة المكرمة، 24267',
      phone: '0123456789',
      mobile: '0551234567',
    });
  });
});
