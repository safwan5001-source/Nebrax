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
    expect(model.currency).toBe('SAR');
    expect(model.direction).toBe('rtl');
    expect(model.type).toBe('tax_invoice');
  });

  it('uses the company currency and explicit document direction and catalog type', () => {
    const model = buildInvoiceDocumentModel({
      invoice: {
        number: 'INV-USD-1',
        invoice_date: '2026-08-18',
        payment_type: 'cash',
        subtotal: '10.00',
        tax_amount: '1.50',
        total: '11.50',
        lines: [],
      },
      company: { name: 'AWJ Trading', currency: 'USD' },
      customer: null,
      qr: 'zatca-qr',
      type: 'simplified_tax_invoice',
      direction: 'ltr',
    });

    expect(model.currency).toBe('USD');
    expect(model.direction).toBe('ltr');
    expect(model.type).toBe('simplified_tax_invoice');
    expect(model.qr).toEqual({ value: 'zatca-qr' });
  });

  it('falls back to SAR for an unknown company currency', () => {
    const model = buildInvoiceDocumentModel({
      invoice: {
        number: 'INV-UNK-1',
        invoice_date: '2026-08-18',
        payment_type: 'cash',
        subtotal: '10.00',
        tax_amount: '1.50',
        total: '11.50',
        lines: [],
      },
      company: { name: 'AWJ', currency: 'XYZ' },
      customer: null,
      qr: null,
    });

    expect(model.currency).toBe('SAR');
  });

  it('يمرّر الحالة والاستحقاق والإجماليات الاختيارية من بيانات الفاتورة القائمة دون إعادة حساب', () => {
    const model = buildInvoiceDocumentModel({
      invoice: {
        number: 'INV-2026-0099',
        invoice_date: '2026-08-20',
        due_date: '2026-09-20',
        payment_type: 'credit',
        status: 'draft',
        subtotal: '1000.00',
        discount: '50.00',
        shipping: '25.00',
        adjustment: '-10.00',
        tax_amount: '150.00',
        total: '1115.00',
        lines: [],
      },
      company: null,
      customer: null,
      qr: null,
    });

    expect(model.status).toBe('draft');
    expect(model.meta.dueDate).toBe('2026-09-20');
    expect(model.totals).toMatchObject({
      subtotal: 100000,
      discount: 5000,
      shipping: 2500,
      adjustment: -1000,
      tax: 15000,
      total: 111500,
    });
  });

  it('يحذف الخصم والشحن الصفريين ولا يخترع استحقاقاً أو حالة', () => {
    const model = buildInvoiceDocumentModel({
      invoice: {
        number: 'INV-2026-0100',
        invoice_date: '2026-08-21',
        payment_type: 'cash',
        subtotal: '10.00',
        discount: '0.00',
        shipping: '0.00',
        tax_amount: '1.50',
        total: '11.50',
        lines: [],
      },
      company: null,
      customer: null,
      qr: null,
    });

    expect(model.status).toBeNull();
    expect(model.meta.dueDate).toBeNull();
    expect(model.totals.discount).toBeUndefined();
    expect(model.totals.shipping).toBeUndefined();
    expect(model.totals.adjustment).toBeUndefined();
  });
  describe('line detail for the premium tax-invoice template', () => {
    const build = (line: Record<string, unknown>) => buildInvoiceDocumentModel({
      invoice: {
        number: 'INV-1', invoice_date: '2026-11-20', payment_type: 'cash', subtotal: '1000.00', tax_amount: '150.00', total: '1150.00',
        lines: [{ id: 'l1', description: 'صنف', quantity: 10, unit_price: '100.00', tax_rate: 15, line_tax: '150.00', line_total: '1150.00', ...line }],
      },
      company: null, customer: null, qr: null,
    }).lines[0];

    it('adds unit, rate, stored discount and taxable amount when the stored line values reconcile', () => {
      const line = build({ unit_name: 'كرتون', line_subtotal: '1000.00', line_discount: '0.00' });
      expect(line).toMatchObject({ unit: 'كرتون', taxRate: 15, lineDiscount: 0, netAmount: 100000 });
    });

    it('takes the stored discount as-is and derives taxable = subtotal − discount only when it matches total − tax', () => {
      const line = build({ line_subtotal: '1100.00', line_discount: '100.00' });
      expect(line).toMatchObject({ lineDiscount: 10000, netAmount: 100000 });
    });

    it('leaves discount and taxable unknown (null, never zero/invented) when the stored values do not reconcile', () => {
      const line = build({ line_subtotal: '1000.00', line_discount: '50.00' });
      expect(line.lineDiscount).toBeNull();
      expect(line.netAmount).toBeNull();
      expect(line.taxRate).toBe(15);
    });

    it('never fills the shared `discount` field (it would add the discount note to published templates)', () => {
      expect(build({ line_subtotal: '1100.00', line_discount: '100.00' }).discount).toBeUndefined();
    });

    it('keeps a legacy payload (no line_subtotal) byte-for-byte unchanged — no detail keys at all', () => {
      const line = build({});
      expect(Object.keys(line).filter((key) => ['unit', 'taxRate', 'lineDiscount', 'netAmount'].includes(key))).toEqual([]);
    });
  });
  describe('logo source (real company logo, never a default image)', () => {
    const build = (over: { logoUrl?: string | null; companyLogo?: string | null }) => buildInvoiceDocumentModel({
      invoice: { number: 'INV-1', invoice_date: '2026-11-20', payment_type: 'cash', subtotal: '100.00', tax_amount: '15.00', total: '115.00', lines: [] },
      company: { name: 'منشأة', logo: over.companyLogo ?? null },
      customer: null, qr: null, logoUrl: over.logoUrl,
    });

    it('uses the company logo from the organisation profile', () => {
      expect(build({ companyLogo: 'data:image/png;base64,COMPANY' }).seller.logoUrl).toBe('data:image/png;base64,COMPANY');
    });

    it('lets a design-settings logo win over the company logo', () => {
      expect(build({ logoUrl: 'data:image/png;base64,DESIGN', companyLogo: 'data:image/png;base64,COMPANY' }).seller.logoUrl).toBe('data:image/png;base64,DESIGN');
    });

    it('has no logo (and no stamp/signature) when none is configured — nothing is invented', () => {
      const model = build({});
      expect(model.seller.logoUrl).toBeNull();
      expect(model.stampUrl).toBeNull();
      expect(model.signatureUrl).toBeNull();
    });
  });
});
