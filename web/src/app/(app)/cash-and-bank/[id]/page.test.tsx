// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import enMessages from '@/messages/en.json';
import arMessages from '@/messages/ar.json';
import CashBankDetailPage from './page';

const { api, auth, toast } = vi.hoisted(() => ({
  api: vi.fn(),
  auth: { current: { id: 'me', role: 'admin', permissions: ['*'] } as { id: string; role: string; permissions?: string[] } },
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/api', () => ({ api, ApiError: class ApiError extends Error {} }));
vi.mock('@/lib/auth', () => ({ currentUser: () => auth.current }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => toast }));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'a1' }), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const ACCOUNT = {
  id: 'a1', account_id: 'x', account_code: '1110', account_name: 'Cash', type: 'cash', name: 'Main cashbox', currency: 'SAR',
  is_active: true, is_main: true, balance: '1000',
  deposit_scope: 'user', deposit_scope_subject: '0b9f6c1e-aaaa-bbbb-cccc-111122223333', withdraw_scope: 'role', withdraw_scope_subject: 'role-ab12cd34',
};

function respond() {
  api.mockImplementation((path: string) => {
    if (path === '/cash-bank-accounts/a1') return Promise.resolve({ data: ACCOUNT });
    if (path.startsWith('/cash-bank-transfers')) return Promise.resolve({ data: [] });
    if (path === '/roles') return Promise.resolve({ data: [{ id: 'r2', slug: 'role-ab12cd34', name: 'Cashier', is_owner: false }] });
    if (path === '/users') return Promise.resolve({ data: [{ id: '0b9f6c1e-aaaa-bbbb-cccc-111122223333', name: 'Hind', email: 'hind@acme.test' }] });
    return Promise.resolve({ data: [] });
  });
}
const view = (locale: 'en' | 'ar' = 'en') => {
  const all = (locale === 'en' ? enMessages : arMessages) as unknown as Record<string, unknown>;
  return render(
    <NextIntlClientProvider locale={locale} messages={{ cashBank: all.cashBank, users: all.users, common: all.common } as never}>
      <CashBankDetailPage />
    </NextIntlClientProvider>,
  );
};

beforeEach(() => {
  auth.current = { id: 'me', role: 'admin', permissions: ['*'] };
  respond();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Cash & bank detail — access rules read as sentences (AC-UX-06)', () => {
  it('names the user and role instead of printing raw identifiers', async () => {
    view();
    expect((await screen.findAllByText('Only Hind \u2068(hind@acme.test)\u2069 can deposit.')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('Only users with the role “Cashier” can withdraw.')).length).toBeGreaterThan(0);
    expect(screen.queryByText(/0b9f6c1e/)).toBeNull();
    expect(screen.queryByText(/role-ab12cd34/)).toBeNull();
  });

  it('a viewer who cannot list users/roles still sees a sentence — never the identifier', async () => {
    auth.current = { id: 'me', role: 'role-x', permissions: ['payments.view'] };
    view();
    expect((await screen.findAllByText('Only a specific user can deposit.')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Only a specific role can withdraw.').length).toBeGreaterThan(0);
    expect(screen.queryByText(/0b9f6c1e/)).toBeNull();
    expect(api.mock.calls.map((c) => c[0])).not.toContain('/users');
  });

  it('renders in Arabic', async () => {
    view('ar');
    expect((await screen.findAllByText('يقتصر السحب على المستخدمين أصحاب الدور «Cashier».')).length).toBeGreaterThan(0);
  });
});
