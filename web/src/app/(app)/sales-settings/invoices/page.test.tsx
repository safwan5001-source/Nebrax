/* @vitest-environment jsdom */
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import InvoiceSettingsPage from './page';

const { api, translate } = vi.hoisted(() => ({
  api: vi.fn(),
  translate: Object.assign((key: string) => key, { raw: () => ({}), rich: (key: string) => key }),
}));

vi.mock('next-intl', () => ({ useTranslations: () => translate, useLocale: () => 'en' }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('@/lib/api', () => ({ api, ApiError: class ApiError extends Error {} }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('lucide-react', () => new Proxy({ __esModule: true } as Record<string | symbol, unknown>, {
  get: (t, n) => (typeof n === 'symbol' || n === 'then' || n === '__esModule' ? Reflect.get(t, n) : () => <span />),
  has: () => true,
}));

const base = {
  default_tax_rate: 15, default_payment_type: 'cash', invoice_prefix: 'INV', require_return_source: false,
  return_window_days: 0, enforce_min_sale_price: true, allow_standalone_credit_notes: false, default_terms: '',
};

function respond(sales: Record<string, unknown>) {
  api.mockImplementation((path: string) => {
    if (path === '/sales-settings') return Promise.resolve({ data: { ...base, ...sales } });
    if (path === '/zatca-settings') return Promise.resolve({ data: { icv_scope: 'tenant' }, meta: { branch_scope_available: false, branch_scope_blocker: null } });
    return Promise.resolve({ data: {} });
  });
}

const putBody = () => {
  const call = api.mock.calls.filter((c) => c[0] === '/sales-settings' && (c[1] as { method?: string })?.method === 'PUT').at(-1);
  return (call?.[1] as { body: Record<string, unknown> }).body;
};

describe('Sales invoice settings — TREASURY-T4 cash-sale cashbox policy', () => {
  afterEach(cleanup);
  beforeEach(() => api.mockReset());

  it('locks the two routed options while the server gate is closed and still saves legacy', async () => {
    respond({ cash_sale_treasury_policy: 'legacy', cash_sale_treasury_routing_available: false });
    render(<InvoiceSettingsPage />);
    const select = (await screen.findByLabelText('cash_sale_treasury_policy')) as HTMLSelectElement;

    expect(select.value).toBe('legacy');
    const byValue = (v: string) => Array.from(select.options).find((o) => o.value === v)!;
    expect(byValue('legacy').disabled).toBe(false);
    expect(byValue('main').disabled).toBe(true);
    expect(byValue('explicit_required').disabled).toBe(true);
    expect(screen.getByText(/cash_sale_treasury_policy_locked/)).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'save' }));
    await waitFor(() => expect(putBody().cash_sale_treasury_policy).toBe('legacy'));
  });

  it('does not let a stored out-of-band value block saving the other settings while the gate is closed', async () => {
    respond({ cash_sale_treasury_policy: 'main', cash_sale_treasury_routing_available: false });
    render(<InvoiceSettingsPage />);
    await screen.findByLabelText('cash_sale_treasury_policy');

    await userEvent.click(screen.getByRole('button', { name: 'save' }));
    await waitFor(() => expect(api.mock.calls.some((c) => (c[1] as { method?: string })?.method === 'PUT' && c[0] === '/sales-settings')).toBe(true));
    expect('cash_sale_treasury_policy' in putBody()).toBe(false);
  });

  it('enables the options and sends the chosen policy once the gate is open', async () => {
    respond({ cash_sale_treasury_policy: 'legacy', cash_sale_treasury_routing_available: true });
    render(<InvoiceSettingsPage />);
    const select = (await screen.findByLabelText('cash_sale_treasury_policy')) as HTMLSelectElement;
    expect(Array.from(select.options).every((o) => !o.disabled)).toBe(true);
    expect(screen.queryByText(/cash_sale_treasury_policy_locked/)).toBeNull();

    await userEvent.selectOptions(select, 'explicit_required');
    await userEvent.click(screen.getByRole('button', { name: 'save' }));
    await waitFor(() => expect(putBody().cash_sale_treasury_policy).toBe('explicit_required'));
  });
});
