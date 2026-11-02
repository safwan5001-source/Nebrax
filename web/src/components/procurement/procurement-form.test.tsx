// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import enMessages from '@/messages/en.json';
import type { ProcurementType } from '@/lib/procurement';
import { ProcurementForm } from './procurement-form';

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

/**
 * ERP-PRODUCT-LINK-B: وصف السطر المخصَّص و`product_id` قيمتان متوازيتان.
 * كان معالج الوصف يمسح `productId` فيُحفَظ مستند الشراء بسطرٍ بلا منتج، ثم يتحوّل
 * أمر الشراء إلى فاتورة مشتريات بلا منتج فلا يُستلم مخزون ولا تُحمَّل تكلفة.
 * المحرر مشترك بين الأنواع الأربعة، فيُختبر كلٌّ منها.
 */
const messages = enMessages as unknown as Record<string, unknown>;

const PRODUCTS = [
  { id: 'prod-a', name: 'A4 paper carton', cost_price: '40.00', sale_price: '95.00', tax_rate: 15, is_active: true },
  { id: 'prod-b', name: 'Toner cartridge', cost_price: '180.00', sale_price: '240.00', tax_rate: 5, is_active: true },
];

const TYPES: ProcurementType[] = ['order', 'quotation', 'request', 'rfq'];

function respond() {
  api.mockImplementation((path: string, init?: { method?: string }) => {
    if (init?.method === 'POST') return Promise.resolve({ data: { id: 'doc-1' } });
    if (path.startsWith('/partners')) return Promise.resolve({ data: [{ id: 's1', name: 'Gulf Supplies Co.' }] });
    if (path === '/products') return Promise.resolve({ data: PRODUCTS });
    return Promise.resolve({ data: [] });
  });
}

const view = (type: ProcurementType) => render(
  <NextIntlClientProvider locale="en" messages={messages as never} timeZone="Asia/Riyadh">
    <ProcurementForm type={type} />
  </NextIntlClientProvider>
);

const productSelect = () => screen.getByLabelText('Product') as HTMLSelectElement;
const description = () => screen.getByLabelText('Description') as HTMLInputElement;
const qty = () => screen.getByLabelText('Qty') as HTMLInputElement;
const cost = () => screen.getByLabelText('Cost') as HTMLInputElement;
const tax = () => screen.getByLabelText('Tax %') as HTMLInputElement;
const posts = () => api.mock.calls.filter((c) => (c[1] as { method?: string } | undefined)?.method === 'POST') as [string, { body: Record<string, unknown> & { items: Record<string, unknown>[] } }][];

const has = (select: HTMLSelectElement, id: string) => Array.from(select.options).some((o) => o.value === id);

async function ready(type: ProcurementType) {
  view(type);
  await waitFor(() => expect(has(productSelect(), 'prod-a')).toBe(true));
  if (type === 'order' || type === 'quotation') {
    await waitFor(() => expect(has(screen.getByLabelText('Supplier') as HTMLSelectElement, 's1')).toBe(true));
    await userEvent.selectOptions(screen.getByLabelText('Supplier'), 's1');
  }
}
async function selectProduct(id: string) {
  await userEvent.selectOptions(productSelect(), id);
}
async function editDescription(text: string) {
  await userEvent.clear(description());
  await userEvent.type(description(), text);
}
const save = () => userEvent.click(screen.getByRole('button', { name: 'Save document' }));

beforeEach(() => { respond(); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe.each(TYPES)('Procurement form (%s) — line description keeps the product link', (type) => {
  it('keeps the product selected and cost/qty/tax untouched after the description is edited', async () => {
    await ready(type);
    await selectProduct('prod-a');
    await userEvent.clear(qty());
    await userEvent.type(qty(), '3');
    await editDescription('A4 paper carton — bundled with delivery');

    expect(productSelect().value).toBe('prod-a');
    expect(productSelect().selectedOptions[0].textContent).toBe('A4 paper carton');
    expect(description().value).toBe('A4 paper carton — bundled with delivery');
    expect(qty().value).toBe('3');
    expect(cost().value).toBe('40.00');
    expect(tax().value).toBe('15');
  });

  it('submits both product_id and the customized description with unchanged money fields', async () => {
    await ready(type);
    await selectProduct('prod-a');
    await userEvent.clear(qty());
    await userEvent.type(qty(), '3');
    await editDescription('A4 paper carton — bundled with delivery');
    await save();

    await waitFor(() => expect(posts()).toHaveLength(1));
    const [path, init] = posts()[0];
    expect(path).toBe('/procurement');
    expect(init.body.type).toBe(type);
    expect(init.body.items).toEqual([{
      product_id: 'prod-a',
      description: 'A4 paper carton — bundled with delivery',
      quantity: 3,
      unit_price: 4000,
      tax_rate: 15,
    }]);
  });
});

describe('Procurement form — existing behaviour is preserved', () => {
  it('keeps explicit manual entry: choosing "Manual entry" clears only the product link', async () => {
    await ready('order');
    await selectProduct('prod-a');
    await editDescription('Custom text');
    await userEvent.selectOptions(productSelect(), '');

    expect(productSelect().value).toBe('');
    expect(description().value).toBe('Custom text');
    expect(cost().value).toBe('40.00');
    await save();
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0][1].body.items[0]).toMatchObject({ product_id: null, description: 'Custom text', unit_price: 4000 });
  });

  it('keeps a manual line manual while its description is typed', async () => {
    await ready('order');
    await userEvent.type(description(), 'Freight charges');
    await userEvent.type(cost(), '120');

    expect(productSelect().value).toBe('');
    await save();
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0][1].body.items[0]).toMatchObject({ product_id: null, description: 'Freight charges', unit_price: 12000 });
  });

  it('keeps default filling (description, cost price, tax) when another product is selected', async () => {
    await ready('order');
    await selectProduct('prod-a');
    await editDescription('Custom text');
    await selectProduct('prod-b');

    expect(productSelect().value).toBe('prod-b');
    expect(description().value).toBe('Toner cartridge');
    expect(cost().value).toBe('180.00');
    expect(tax().value).toBe('5');
  });

  it('allows a request/RFQ line without a price: quantity and product are enough', async () => {
    await ready('request');
    await selectProduct('prod-a');
    await userEvent.clear(cost());
    await editDescription('Needed by March');
    await save();

    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0][1].body.items[0]).toMatchObject({ product_id: 'prod-a', description: 'Needed by March', unit_price: 0 });
  });

  it('does not change the line or document totals when only the description changes', async () => {
    await ready('order');
    await selectProduct('prod-a');
    await userEvent.clear(qty());
    await userEvent.type(qty(), '3');
    const summary = () => ['Subtotal', 'Tax', 'Total'].map((label) => {
      const matches = screen.getAllByText(label);
      return matches[matches.length - 1].parentElement?.textContent;
    });
    const before = summary();
    expect(before[2]).toMatch(/138/);
    await editDescription('Different wording');
    expect(summary()).toEqual(before);
  });
});
