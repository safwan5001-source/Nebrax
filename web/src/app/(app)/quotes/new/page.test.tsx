// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import enMessages from '@/messages/en.json';
import NewQuotePage from './page';

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
vi.mock('@/lib/tax', () => ({ getSystemTaxInclusive: () => Promise.resolve(false) }));
vi.mock('@/components/partners/partner-dialog', () => ({ PartnerDialog: () => null }));
vi.mock('@/components/products/product-dialog', () => ({ ProductDialog: () => null }));

// الـ`Combobox` نافذةٌ منبثقة؛ بديلٌ أصليّ يكفي لإثبات الربط (كما في اختبار الفاتورة في PR #1919).
// يحاكي خيار «الإدخال اليدوي» بوصفه الخيار ذا القيمة الفارغة، كما يفعل المنتقي الحقيقي.
vi.mock('@/components/ui/combobox', () => ({
  Combobox: ({ id, value, onChange, options, clearLabel, placeholder, 'aria-label': ariaLabel }: {
    id?: string; value: string; onChange: (v: string) => void; placeholder: string; clearLabel?: string;
    options: { value: string; label: string }[]; 'aria-label'?: string;
  }) => (
    <select id={id} aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{clearLabel ?? placeholder}</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}));

/**
 * ERP-PRODUCT-LINK-C: وصف السطر المخصَّص و`product_id` قيمتان متوازيتان.
 * كان معالج الوصف في عرض السعر يمرّر `productId: null` مع كل ضغطة مفتاح، فيُحفَظ
 * العرض بسطر بلا منتج، ويتحوّل إلى فاتورة مبيعات بلا منتج فلا يُخصم مخزون ولا تُحمَّل تكلفة.
 */
const messages = enMessages as unknown as Record<string, unknown>;

const PRODUCTS = [
  { id: 'prod-a', name: 'A4 paper carton', sale_price: '95.00', tax_rate: 15, is_active: true },
  { id: 'prod-b', name: 'Toner cartridge', sale_price: '240.00', tax_rate: 5, is_active: true },
];

function respond() {
  api.mockImplementation((path: string, init?: { method?: string }) => {
    if (init?.method === 'POST') return Promise.resolve({ data: { id: 'quote-1' } });
    if (path === '/partners') return Promise.resolve({ data: [{ id: 'c1', name: 'Gulf Trading Est.', type: 'customer' }] });
    if (path === '/products') return Promise.resolve({ data: PRODUCTS });
    return Promise.resolve({ data: [] });
  });
}

const view = () => render(
  <NextIntlClientProvider locale="en" messages={messages as never} timeZone="Asia/Riyadh">
    <NewQuotePage />
  </NextIntlClientProvider>
);

const productSelect = () => screen.getByLabelText('Product') as HTMLSelectElement;
const description = () => screen.getByLabelText('Description') as HTMLInputElement;
const qty = () => screen.getByLabelText('Qty') as HTMLInputElement;
const price = () => screen.getByLabelText('Unit price') as HTMLInputElement;
const tax = () => screen.getByLabelText('Tax %') as HTMLInputElement;
const posts = () => api.mock.calls.filter((c) => (c[1] as { method?: string } | undefined)?.method === 'POST') as [string, { body: Record<string, unknown> & { items: Record<string, unknown>[] } }][];

async function ready() {
  view();
  await waitFor(() => expect(Array.from(productSelect().options).some((o) => o.value === 'prod-a')).toBe(true));
  await waitFor(() => expect(Array.from((screen.getByLabelText('Customer') as HTMLSelectElement).options).some((o) => o.value === 'c1')).toBe(true));
  await userEvent.selectOptions(screen.getByLabelText('Customer'), 'c1');
}
const selectProduct = (id: string) => userEvent.selectOptions(productSelect(), id);
async function editDescription(text: string) {
  await userEvent.clear(description());
  await userEvent.type(description(), text);
}
const save = () => userEvent.click(screen.getByRole('button', { name: 'Save quote' }));

beforeEach(() => { respond(); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('New quote — line description keeps the product link', () => {
  it('keeps the product selected and price/qty/tax untouched after the description is edited', async () => {
    await ready();
    await selectProduct('prod-a');
    await userEvent.clear(qty());
    await userEvent.type(qty(), '3');
    await editDescription('A4 paper carton — bundled with delivery');

    expect(productSelect().value).toBe('prod-a');
    expect(productSelect().selectedOptions[0].textContent).toBe('A4 paper carton');
    expect(description().value).toBe('A4 paper carton — bundled with delivery');
    expect(qty().value).toBe('3');
    expect(price().value).toBe('95.00');
    expect(tax().value).toBe('15');
  });

  it('submits both product_id and the customized description with unchanged money fields', async () => {
    await ready();
    await selectProduct('prod-a');
    await userEvent.clear(qty());
    await userEvent.type(qty(), '3');
    await editDescription('A4 paper carton — bundled with delivery');
    await save();

    await waitFor(() => expect(posts()).toHaveLength(1));
    const [path, init] = posts()[0];
    expect(path).toBe('/quotes');
    expect(init.body.items).toEqual([{
      product_id: 'prod-a',
      description: 'A4 paper carton — bundled with delivery',
      quantity: 3,
      unit_price: 9500,
      tax_rate: 15,
    }]);
  });

  it('keeps explicit manual entry: choosing "Manual entry" clears only the product link', async () => {
    await ready();
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
    await ready();
    await userEvent.type(description(), 'Consulting hours');
    await userEvent.type(price(), '120');

    expect(productSelect().value).toBe('');
    await save();
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0][1].body.items[0]).toMatchObject({ product_id: null, description: 'Consulting hours', unit_price: 12000 });
  });

  it('keeps default filling when another product is selected after a custom description', async () => {
    await ready();
    await selectProduct('prod-a');
    await editDescription('Custom text');
    await selectProduct('prod-b');

    expect(productSelect().value).toBe('prod-b');
    expect(description().value).toBe('Toner cartridge');
    expect(price().value).toBe('240.00');
    expect(tax().value).toBe('5');
  });

  it('does not change the line or document totals when only the description changes', async () => {
    await ready();
    await selectProduct('prod-a');
    await userEvent.clear(qty());
    await userEvent.type(qty(), '3');
    const summary = () => ['Subtotal', 'Total tax', 'Total'].map((label) => {
      const matches = screen.getAllByText(label);
      return matches[matches.length - 1].parentElement?.textContent;
    });
    const before = summary();
    expect(before[2]).toMatch(/327\.75/);
    await editDescription('Different wording');
    expect(summary()).toEqual(before);
  });
});
