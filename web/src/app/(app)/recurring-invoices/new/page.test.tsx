// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import enMessages from '@/messages/en.json';
import NewRecurringPage from './page';

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

const all = enMessages as unknown as Record<string, unknown>;
const messages = { recurring: all.recurring, invoiceForm: all.invoiceForm, common: all.common };

const PRODUCTS = [
  { id: 'prod-a', name: 'A4 paper carton', sale_price: '95.00', tax_rate: 15, is_active: true },
  { id: 'prod-b', name: 'Toner cartridge', sale_price: '240.00', tax_rate: 5, is_active: true },
];

function respond() {
  api.mockImplementation((path: string, init?: { method?: string }) => {
    if (init?.method === 'POST') return Promise.resolve({ data: { id: 'rec-1' } });
    if (path === '/partners') return Promise.resolve({ data: [{ id: 'c1', name: 'Gulf Trading Est.' }] });
    if (path === '/products') return Promise.resolve({ data: PRODUCTS });
    return Promise.resolve({ data: [] });
  });
}
const view = () => render(<NextIntlClientProvider locale="en" messages={messages as never}><NewRecurringPage /></NextIntlClientProvider>);
const productSelect = () => screen.getByLabelText('Product') as HTMLSelectElement;
const description = () => screen.getByLabelText('Description') as HTMLInputElement;
const qty = () => screen.getByLabelText('Qty') as HTMLInputElement;
const price = () => screen.getByLabelText('Unit price') as HTMLInputElement;
const tax = () => screen.getByLabelText('Tax %') as HTMLInputElement;
const posts = () => api.mock.calls.filter((c) => (c[1] as { method?: string } | undefined)?.method === 'POST') as [string, { body: { items: Record<string, unknown>[] } }][];

async function selectProduct(id: string) {
  await waitFor(() => expect(within_(productSelect()).has(id)).toBe(true));
  await userEvent.selectOptions(productSelect(), id);
}
const within_ = (select: HTMLSelectElement) => ({ has: (id: string) => Array.from(select.options).some((o) => o.value === id) });
async function editDescription(text: string) {
  await userEvent.clear(description());
  await userEvent.type(description(), text);
}

beforeEach(() => { respond(); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('New recurring invoice — line description keeps the product link', () => {
  it('keeps the product selected and price/qty/tax untouched after the description is edited', async () => {
    view();
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
    view();
    await selectProduct('prod-a');
    await editDescription('A4 paper carton — bundled with delivery');
    await userEvent.click(screen.getByRole('button', { name: 'Save template' }));

    await waitFor(() => expect(posts()).toHaveLength(1));
    const [path, init] = posts()[0];
    expect(path).toBe('/recurring-invoices');
    expect(init.body.items).toEqual([{
      product_id: 'prod-a',
      description: 'A4 paper carton — bundled with delivery',
      quantity: 1,
      unit_price: 9500,
      tax_rate: 15,
    }]);
  });

  it('keeps explicit manual entry: choosing "Manual entry" clears only the product link', async () => {
    view();
    await selectProduct('prod-a');
    await editDescription('Custom text');
    await userEvent.selectOptions(productSelect(), '');

    expect(productSelect().value).toBe('');
    expect(description().value).toBe('Custom text');
    expect(price().value).toBe('95.00');
    await userEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0][1].body.items[0]).toMatchObject({ product_id: null, description: 'Custom text', unit_price: 9500 });
  });

  it('keeps a manual line manual while its description is typed', async () => {
    view();
    await userEvent.type(description(), 'Consulting hours');
    await userEvent.type(price(), '120');
    expect(productSelect().value).toBe('');
    await userEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0][1].body.items[0]).toMatchObject({ product_id: null, description: 'Consulting hours', unit_price: 12000 });
  });

  it('keeps default filling when another product is selected after a custom description', async () => {
    view();
    await selectProduct('prod-a');
    await editDescription('Custom text');
    await selectProduct('prod-b');

    expect(productSelect().value).toBe('prod-b');
    expect(description().value).toBe('Toner cartridge');
    expect(price().value).toBe('240.00');
    expect(tax().value).toBe('5');
  });

  it('does not change the line total or the template totals when only the description changes', async () => {
    view();
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
