import { describe, expect, it } from 'vitest';
import { buildQuoteDocumentModel } from './from-quote';

describe('buildQuoteDocumentModel', () => {
  const quote = {
    number: 'Q-2026-0001',
    quote_date: '2026-09-02',
    valid_until: '2026-09-16',
    subtotal: '100.00',
    tax_amount: '15.00',
    total: '115.00',
    lines: [] as { id: string; description: string | null; quantity: number; unit_price: string; line_tax: string; line_total: string }[],
  };

  it('defaults to SAR and rtl', () => {
    const model = buildQuoteDocumentModel({
      quote,
      company: { name: 'نبراس' },
      customer: { name: 'عميل' },
    });
    expect(model.type).toBe('quotation');
    expect(model.currency).toBe('SAR');
    expect(model.direction).toBe('rtl');
  });

  it('uses the company currency and explicit document direction', () => {
    const model = buildQuoteDocumentModel({
      quote,
      company: { name: 'AWJ Trading', currency: 'EUR', logo: 'https://assets.example/logo.png' },
      customer: { name: 'Buyer' },
      direction: 'ltr',
    });
    expect(model.currency).toBe('EUR');
    expect(model.direction).toBe('ltr');
    expect(model.seller.logoUrl).toBe('https://assets.example/logo.png');
  });

  it('falls back to SAR for an unknown company currency', () => {
    const model = buildQuoteDocumentModel({
      quote,
      company: { name: 'AWJ', currency: 'XYZ' },
      customer: null,
    });
    expect(model.currency).toBe('SAR');
  });
});
