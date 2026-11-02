// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import { InvoiceDocument, type InvoiceDoc } from './invoice-document';

afterEach(cleanup);

/**
 * مستند الفاتورة هو مصدر الطباعة والمعاينة معاً. وصف السطر المخصَّص يُحفَظ مع
 * `product_id` ولقطة اسم المنتج؛ والعرض يجب أن يُظهر الوصف كما كُتب لا اسمَ
 * المنتج الافتراضي.
 */
const invoice = (description: string | null, productName: string | null): InvoiceDoc => ({
  number: 'INV-2026-0001',
  invoice_date: '2026-08-17',
  payment_type: 'cash',
  subtotal: '95.00',
  tax_amount: '14.25',
  total: '109.25',
  lines: [{
    id: 'line-1',
    product_name: productName,
    product_code: 'SKU-003',
    barcode: null,
    description,
    quantity: 1,
    unit_price: '95.00',
    unit_price_before_tax: '95.00',
    tax_rate: 15,
    line_tax: '14.25',
    line_total: '109.25',
  }],
} as unknown as InvoiceDoc);

const view = (doc: InvoiceDoc) => render(
  <NextIntlClientProvider locale="en" messages={en as never}>
    <InvoiceDocument invoice={doc} company={null} customer={null} qr={null} />
  </NextIntlClientProvider>,
);

describe('InvoiceDocument — line description', () => {
  it('prints the customized description next to the product snapshot name', () => {
    const { container } = view(invoice('A4 paper carton — bundled with delivery', 'A4 paper carton'));
    const text = container.textContent ?? '';
    expect(text).toContain('A4 paper carton — bundled with delivery');
    expect(text).toContain('SKU-003');
  });
  it('still shows the description for a manual line that has no product name', () => {
    const { container } = view(invoice('Consulting hours', null));
    expect(container.textContent ?? '').toContain('Consulting hours');
  });
});
