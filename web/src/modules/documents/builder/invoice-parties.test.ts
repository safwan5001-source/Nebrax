import { describe, expect, it } from 'vitest';
import { buildInvoiceDocumentModel, type SourceInvoice } from './from-invoice';
import { isUsableParties, resolveInvoiceParties, type InvoiceParties } from './invoice-parties';

const parties: InvoiceParties = {
  version: 1,
  seller: {
    name: 'شركة الأفق', vat_number: '300000000000003', cr_number: '1010101010', country: 'SA',
    address: { building_no: '8228', street: 'شارع الملك فهد', additional_no: '1234', district: 'العليا', city: 'الرياض', postal_code: '12643', short_address: null },
    phone: '0112345678', mobile: null,
  },
  buyer: {
    partner_id: 'p1', entity_type: 'commercial', name: 'شركة الأمل', name_en: 'Al Amal', vat_number: '300111222333003', cr_number: null,
    address: { building_no: '1234', street: 'شارع القدس', district: 'الفيحاء', city: 'الدمام', postal_code: '31411', country: 'SA' },
  },
};

const liveCompany = { name: 'اسم حي جديد', vat_number: '399999999999993', city: 'جدة', logo: 'data:image/png;base64,LIVE', currency: 'SAR' };
const liveCustomer = { name: 'عميل حي جديد', vat_number: null, city: 'جدة' };

describe('resolveInvoiceParties (REM-14c)', () => {
  it('uses the issue-time snapshot for a posted invoice, ignoring later live edits', () => {
    const r = resolveInvoiceParties({ status: 'posted', parties, company: liveCompany, customer: liveCustomer });
    expect(r.source).toBe('snapshot');
    expect(r.company).toMatchObject({
      name: 'شركة الأفق', vat_number: '300000000000003', cr_number: '1010101010', city: 'الرياض', postal_code: '12643',
      building_no: '8228', phone: '0112345678', street: 'شارع الملك فهد',
    });
    expect(r.customer).toEqual({ name: 'شركة الأمل', vat_number: '300111222333003', city: 'الدمام' });
  });

  it('keeps only the non-legal branding fields (logo, currency) from the live company profile', () => {
    const r = resolveInvoiceParties({ status: 'posted', parties, company: liveCompany, customer: liveCustomer });
    expect(r.company?.logo).toBe('data:image/png;base64,LIVE');
    expect(r.company?.currency).toBe('SAR');
  });

  it('falls back to live data for drafts, even when parties is present', () => {
    const r = resolveInvoiceParties({ status: 'draft', parties, company: liveCompany, customer: liveCustomer });
    expect(r.source).toBe('live');
    expect(r.company).toBe(liveCompany);
    expect(r.customer).toBe(liveCustomer);
  });

  it('falls back to live data for legacy posted invoices without a snapshot (compatibility, not a historical guarantee)', () => {
    for (const p of [null, undefined]) {
      const r = resolveInvoiceParties({ status: 'posted', parties: p, company: liveCompany, customer: liveCustomer });
      expect(r.source).toBe('live');
      expect(r.customer).toBe(liveCustomer);
    }
  });

  it('treats an unknown version or a malformed snapshot as no snapshot', () => {
    expect(isUsableParties({ ...parties, version: 2 })).toBe(false);
    expect(isUsableParties({ version: 1 } as unknown as InvoiceParties)).toBe(false);
    expect(resolveInvoiceParties({ status: 'posted', parties: { ...parties, version: 2 }, company: liveCompany, customer: liveCustomer }).source).toBe('live');
  });

  it('keeps nulls as nulls (no invented defaults) and shows an em dash only for a missing name', () => {
    const sparse: InvoiceParties = {
      ...parties,
      seller: { ...parties.seller, name: null, vat_number: null, cr_number: null, address: { ...parties.seller.address, street: null, city: null } },
      buyer: { ...parties.buyer, name: null, vat_number: null, address: { ...parties.buyer.address, city: null } },
    };
    const r = resolveInvoiceParties({ status: 'posted', parties: sparse, company: null, customer: null });
    expect(r.company).toMatchObject({ name: '—', vat_number: null, cr_number: null, street: null, city: null, logo: null, currency: null });
    expect(r.customer).toEqual({ name: '—', vat_number: null, city: null });
  });
});

describe('buildInvoiceDocumentModel with a party snapshot', () => {
  const base = (over: Partial<SourceInvoice>): SourceInvoice => ({
    number: 'INV-1', invoice_date: '2026-10-15', payment_type: 'credit', subtotal: '100.00', tax_amount: '15.00', total: '115.00',
    status: 'posted', lines: [], ...over,
  });

  it('renders seller and buyer from the snapshot even when the live company/customer changed', () => {
    const model = buildInvoiceDocumentModel({ invoice: base({ parties }), company: liveCompany, customer: liveCustomer, qr: null });
    expect(model.seller.name).toBe('شركة الأفق');
    expect(model.seller.vatNumber).toBe('300000000000003');
    expect(model.seller.crNumber).toBe('1010101010');
    expect(model.seller.address).toContain('شارع الملك فهد');
    expect(model.seller.address).toContain('12643');
    expect(model.buyer).toEqual({ name: 'شركة الأمل', vatNumber: '300111222333003', city: 'الدمام' });
    expect(model.seller.logoUrl).toBe('data:image/png;base64,LIVE');
  });

  it('keeps AR/EN and RTL/LTR behaviour: language and direction are independent of the snapshot', () => {
    const ar = buildInvoiceDocumentModel({ invoice: base({ parties, language_effective: 'ar' }), company: liveCompany, customer: liveCustomer, qr: null });
    const en = buildInvoiceDocumentModel({ invoice: base({ parties, language_effective: 'en' }), company: liveCompany, customer: liveCustomer, qr: null });
    expect([ar.direction, ar.language]).toEqual(['rtl', 'ar']);
    expect([en.direction, en.language]).toEqual(['ltr', 'en']);
    expect(ar.seller.name).toBe(en.seller.name);
  });

  it('renders drafts and legacy posted invoices from live data', () => {
    const draft = buildInvoiceDocumentModel({ invoice: base({ status: 'draft', parties }), company: liveCompany, customer: liveCustomer, qr: null });
    const legacy = buildInvoiceDocumentModel({ invoice: base({ parties: null }), company: liveCompany, customer: liveCustomer, qr: null });
    expect(draft.seller.name).toBe('اسم حي جديد');
    expect(legacy.buyer.name).toBe('عميل حي جديد');
  });
});
