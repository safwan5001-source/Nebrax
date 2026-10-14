// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import enMessages from '@/messages/en.json';
import CashBankFormPage from './page';

const { api, auth, nav, push, toast, FakeApiError } = vi.hoisted(() => ({
  api: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() }, // مرجعٌ ثابت: الصفحة تعتمد على `toastError` في useCallback
  auth: { current: { id: 'me', role: 'admin', permissions: ['*'] } as { id: string; role: string; permissions?: string[] } },
  nav: { search: '' },
  push: vi.fn(),
  FakeApiError: class FakeApiError extends Error {},
}));
vi.mock('@/lib/api', () => ({ api, ApiError: FakeApiError }));
vi.mock('@/lib/auth', () => ({ currentUser: () => auth.current }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => toast }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const all = enMessages as unknown as Record<string, unknown>;
const messages = { cashBank: all.cashBank, users: all.users, common: all.common };

const ACCOUNT = {
  id: 'a1', account_id: 'x', type: 'cash', name: 'Main cashbox', currency: 'SAR', is_active: true, is_main: true, balance: '0',
  deposit_scope: 'role', deposit_scope_subject: 'role-ab12cd34', withdraw_scope: 'all', withdraw_scope_subject: null,
};

function respond() {
  api.mockImplementation((path: string, init?: { method?: string }) => {
    if (init?.method) return Promise.resolve({ data: { id: 'a9' } });
    if (path === '/cash-bank-accounts/a1') return Promise.resolve({ data: ACCOUNT });
    if (path === '/roles') return Promise.resolve({ data: [{ id: 'r1', slug: 'staff', name: 'Floor staff', is_owner: false }, { id: 'r2', slug: 'role-ab12cd34', name: 'Cashier', is_owner: false }] });
    if (path === '/users') return Promise.resolve({ data: [{ id: 'u1', name: 'Hind', email: 'hind@acme.test' }] });
    if (path === '/branches') return Promise.resolve({ data: [{ id: 'b1', name: 'Dammam' }] });
    return Promise.resolve({ data: [] });
  });
}
const render_ = () => render(<NextIntlClientProvider locale="en" messages={messages as never}><CashBankFormPage /></NextIntlClientProvider>);
const writes = () => api.mock.calls.filter((c) => (c[1] as { method?: string } | undefined)?.method) as [string, { method: string; body: Record<string, unknown> }][];
const save = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
const rule = (name: string) => within(screen.getByRole('group', { name }));

beforeEach(() => {
  nav.search = '';
  auth.current = { id: 'me', role: 'admin', permissions: ['*'] };
  respond();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Cash & bank form — access rules (AC-UX-06)', () => {
  it('creates with "All" by default and sends null subjects (the server rejects a subject for "all")', async () => {
    render_();
    await userEvent.type((await screen.findAllByRole('textbox'))[0], 'Petty cash');
    await userEvent.click(save());
    await waitFor(() => expect(writes()).toHaveLength(1));
    const [path, init] = writes()[0];
    expect(path).toBe('/cash-bank-accounts');
    expect(init.body).toMatchObject({ deposit_scope: 'all', deposit_scope_subject: null, withdraw_scope: 'all', withdraw_scope_subject: null });
  });

  it('a role rule needs a named choice before it can be saved; the payload carries the slug', async () => {
    render_();
    await userEvent.type((await screen.findAllByRole('textbox'))[0], 'Petty cash');
    await userEvent.click(rule('Who may deposit').getByRole('radio', { name: /Role/ }));
    expect(save().disabled).toBe(true);
    expect(screen.getByText('Choose a role, or switch to "All".')).toBeTruthy();

    await userEvent.selectOptions(rule('Who may deposit').getByLabelText('Role', { selector: 'select' }), 'role-ab12cd34');
    expect(save().disabled).toBe(false);
    await userEvent.click(save());
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][1].body).toMatchObject({ deposit_scope: 'role', deposit_scope_subject: 'role-ab12cd34', withdraw_scope: 'all', withdraw_scope_subject: null });
  });

  it('edit shows the saved rule by name (never the raw slug) and saves it unchanged', async () => {
    nav.search = 'edit=a1';
    render_();
    expect(await screen.findByText('Only users with the role “Cashier” can deposit.')).toBeTruthy();
    expect(screen.queryByText('role-ab12cd34')).toBeNull();
    await userEvent.click(save());
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][0]).toBe('/cash-bank-accounts/a1');
    expect(writes()[0][1]).toMatchObject({ method: 'PUT', body: { deposit_scope: 'role', deposit_scope_subject: 'role-ab12cd34' } });
  });

  it('a manager without roles/users/branches view still edits the account: saved rule kept, other scopes locked, nothing lost', async () => {
    nav.search = 'edit=a1';
    auth.current = { id: 'me', role: 'role-x', permissions: ['payments.manage'] };
    render_();
    expect(await screen.findByText(/A specific role is set \(its name isn't available to you\)/)).toBeTruthy();
    const deposit = rule('Who may deposit');
    expect((deposit.getByRole('radio', { name: /User/ }) as HTMLInputElement).disabled).toBe(true);
    await userEvent.click(save());
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][1].body).toMatchObject({ deposit_scope: 'role', deposit_scope_subject: 'role-ab12cd34' });
    expect(api.mock.calls.map((c) => c[0])).not.toContain('/roles');
  });
});
