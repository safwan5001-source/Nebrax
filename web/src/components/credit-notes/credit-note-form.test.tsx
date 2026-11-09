// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import enMessages from '@/messages/en.json';
import { CreditNoteForm } from './credit-note-form';

const { api, push, toast, FakeApiError } = vi.hoisted(() => ({
  api: vi.fn(),
  push: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
  FakeApiError: class FakeApiError extends Error {},
}));

vi.mock('@/lib/api', () => ({ api, ApiError: FakeApiError }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => toast }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock('@/lib/use-number-preview', () => ({ useNumberPreview: () => ({ number: null, loading: false }) }));
vi.mock('./credit-note-linked-form', () => ({ CreditNoteLinkedForm: () => null }));

/**
 * ERP-PRODUCT-LINK-D: نموذج الإشعار المستقل مشترك بين الدائن والمدين.
 * كان معالج الوصف يمرّر `productId: null` مع كل ضغطة مفتاح، فيُرسل الإشعار بلا منتج.
 * الاختبارات تغطي المسارين: مبيعات (دائن) ومشتريات (مدين).
 */
const messages = enMessages as unknown as Record<string, unknown>;

const PRODUCTS = [
  { id: 'prod-a', name: 'A4 paper carton', sale_price: '95.00', tax_rate: 15, is_active: true },
  { id: 'prod-b', name: 'Toner cartridge', sale_price: '240.00', tax_rate: 5, is_active: true },
];

function respond() {
  api.mockImplementation((path: string, init?: { method?: string }) => {
    if (init?.method === 'POST') return Promise.resolve({ data: { id: 'note-1' } });
    if (path === '/sales-settings') return Promise.resolve({ data: { allow_standalone_credit_notes: true, default_tax_rate: 15 } });
    if (path === '/partners?type=customer') return Promise.resolve({ data: [{ id: 'c1', name: 'Gulf Trading Est.' }] });
    if (path === '/partners?type=supplier') return Promise.resolve({ data: [{ id: 's1', name: 'Supplier Co.' }] });
    if (path === '/products') return Promise.resolve({ data: PRODUCTS });
    return Promise.resolve({ data: [] });
  });
}

const view = (type: 'sales' | 'purchase') => render(
  <NextIntlClientProvider locale="en" messages={messages as never} timeZone="Asia/Riyadh">
    <CreditNoteForm type={type} />
  </NextIntlClientProvider>
);

/** الإشعار المبيعات يفتح افتراضياً على «المرتبط»؛ نضغط زر المستقل أولاً. */
async function openStandalone(type: 'sales' | 'purchase') {
  view(type);
  if (type === 'sales') {
    const toggle = await screen.findByRole('button', { name: 'Standalone (no invoice)' });
    await userEvent.click(toggle);
  }
  await waitFor(() => expect(Array.from(productSelect().options).some((o) => o.value === 'prod-a')).toBe(true));
  await waitFor(() => expect(partnerSelect().options.length).toBeGreaterThan(0));
}

const productSelect = () => screen.getByLabelText('Product') as HTMLSelectElement;
const partnerSelect = () => document.getElementById('partner') as HTMLSelectElement;
const description = () => screen.getByLabelText('Description') as HTMLInputElement;
const qty = () => screen.getByLabelText('Qty') as HTMLInputElement;
const price = () => screen.getByLabelText('Unit price') as HTMLInputElement;
const tax = () => screen.getByLabelText('Tax %') as HTMLInputElement;
const posts = () => api.mock.calls.filter((c) => (c[1] as { method?: string } | undefined)?.method === 'POST') as [string, { body: Record<string, unknown> & { items: Record<string, unknown>[] } }][];

const selectProduct = (id: string) => userEvent.selectOptions(productSelect(), id);
async function editDescription(text: string) {
  await userEvent.clear(description());
  await userEvent.type(description(), text);
}
const save = () => userEvent.click(screen.getByRole('button', { name: 'Save credit note' }));

beforeEach(() => { respond(); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe.each([
  ['sales credit note', 'sales'],
  ['purchase debit note', 'purchase'],
] as const)('standalone %s — line description keeps the product link', (_label, type) => {
  it('keeps the selected product after the description is edited', async () => {
    await openStandalone(type);
    await selectProduct('prod-a');
    await editDescription('A4 paper carton — bundled with delivery');

    expect(productSelect().value).toBe('prod-a');
    expect(productSelect().selectedOptions[0].textContent).toBe('A4 paper carton');
    expect(description().value).toBe('A4 paper carton — bundled with delivery');
  });

  it('leaves quantity, price and tax untouched when only the description changes', async () => {
    await openStandalone(type);
    await selectProduct('prod-a');
    await userEvent.clear(qty());
    await userEvent.type(qty(), '3');
    await editDescription('Custom text');

    expect(qty().value).toBe('3');
    expect(price().value).toBe('95.00');
    expect(tax().value).toBe('15');
  });

  it('submits product_id together with the custom description', async () => {
    await openStandalone(type);
    await selectProduct('prod-a');
    await userEvent.clear(qty());
    await userEvent.type(qty(), '3');
    await editDescription('A4 paper carton — bundled with delivery');
    await save();

    await waitFor(() => expect(posts()).toHaveLength(1));
    const [path, init] = posts()[0];
    expect(path).toBe('/credit-notes');
    expect(init.body.type).toBe(type);
    expect(init.body.items).toEqual([{
      product_id: 'prod-a',
      description: 'A4 paper carton — bundled with delivery',
      quantity: 3,
      unit_price: 9500,
      tax_rate: 15,
    }]);
  });

  it('keeps explicit manual entry: choosing "Manual entry" clears only the product link', async () => {
    await openStandalone(type);
    await selectProduct('prod-a');
    await editDescription('Custom text');
    await userEvent.selectOptions(productSelect(), '');

    expect(productSelect().value).toBe('');
    expect(description().value).toBe('Custom text');
    expect(price().value).toBe('95.00');
    await save();
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0][1].body.items[0]).toMatchObject({ product_id: null, description: 'Custom text', unit_price: 9500 });
  });

  it('keeps a manual line manual while its description is typed', async () => {
    await openStandalone(type);
    await userEvent.type(description(), 'Supplier discount');
    await userEvent.type(price(), '120');

    expect(productSelect().value).toBe('');
    await save();
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0][1].body.items[0]).toMatchObject({ product_id: null, description: 'Supplier discount', unit_price: 12000 });
  });

  it('keeps product-change defaults: choosing another product refills description, price and tax', async () => {
    await openStandalone(type);
    await selectProduct('prod-a');
    await editDescription('Custom text');
    await selectProduct('prod-b');

    expect(productSelect().value).toBe('prod-b');
    expect(description().value).toBe('Toner cartridge');
    expect(price().value).toBe('240.00');
    expect(tax().value).toBe('5');
  });

  it('does not change totals when only the description changes', async () => {
    await openStandalone(type);
    await selectProduct('prod-a');
    await userEvent.clear(qty());
    await userEvent.type(qty(), '3');
    // المجموع الفرعي والضريبة والإجمالي: آخر ما يحمل الوسم في بطاقة المجاميع.
    const totals = () => ['Subtotal', 'Total tax', 'Total'].map((label) => {
      const matches = screen.getAllByText(label);
      return matches[matches.length - 1].parentElement?.textContent;
    });
    const before = totals();
    expect(before[2]).toMatch(/327\.75/);
    await editDescription('Different wording');
    expect(totals()).toEqual(before);
  });
});
