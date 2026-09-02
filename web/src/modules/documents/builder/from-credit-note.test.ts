import { describe, expect, it } from 'vitest';
import { buildCreditNoteDocumentModel } from './from-credit-note';

describe('buildCreditNoteDocumentModel', () => {
  const note = {
    number: 'CN-2026-0001',
    note_date: '2026-09-02',
    subtotal: '100.00',
    tax_amount: '15.00',
    total: '115.00',
    reason: 'مرتجع جزئي',
    type: 'sales' as const,
    lines: [] as { id: string; description: string | null; quantity: number; unit_price: string; line_tax: string; line_total: string }[],
  };

  it('defaults to SAR and rtl for a sales credit note', () => {
    const model = buildCreditNoteDocumentModel({
      note,
      company: { name: 'نبراس' },
      customer: { name: 'عميل' },
    });
    expect(model.type).toBe('credit_note');
    expect(model.currency).toBe('SAR');
    expect(model.direction).toBe('rtl');
    expect(model.qr).toBeNull();
  });

  it('uses the company currency and explicit document direction', () => {
    const model = buildCreditNoteDocumentModel({
      note,
      company: { name: 'AWJ Trading', currency: 'EUR', logo: 'https://assets.example/logo.png' },
      customer: { name: 'Buyer' },
      direction: 'ltr',
    });
    expect(model.currency).toBe('EUR');
    expect(model.direction).toBe('ltr');
    expect(model.seller.logoUrl).toBe('https://assets.example/logo.png');
  });

  it('falls back to SAR for an unknown company currency', () => {
    const model = buildCreditNoteDocumentModel({
      note,
      company: { name: 'AWJ', currency: 'XYZ' },
      customer: null,
    });
    expect(model.currency).toBe('SAR');
  });

  it('maps a purchase note to debit_note with company currency and explicit direction', () => {
    const model = buildCreditNoteDocumentModel({
      note: { ...note, number: 'DN-2026-0001', type: 'purchase' },
      company: { name: 'AWJ Trading', currency: 'EUR', logo: 'https://assets.example/logo.png' },
      customer: { name: 'Supplier' },
      direction: 'ltr',
    });
    expect(model.type).toBe('debit_note');
    expect(model.currency).toBe('EUR');
    expect(model.direction).toBe('ltr');
    expect(model.seller.logoUrl).toBe('https://assets.example/logo.png');
  });
});
