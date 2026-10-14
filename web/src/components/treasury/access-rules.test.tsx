// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import enMessages from '@/messages/en.json';
import arMessages from '@/messages/ar.json';
import type { AccessLookups } from '@/modules/treasury/access';
import { AccessRuleField, useAccessLookups, type AccessRuleValue } from './access-rules';

const { api, auth } = vi.hoisted(() => ({
  api: vi.fn(),
  auth: { current: { id: 'me', role: 'admin', permissions: ['*'] } as { id: string; role: string; permissions?: string[] } },
}));
vi.mock('@/lib/api', () => ({ api, ApiError: class ApiError extends Error {} }));
vi.mock('@/lib/auth', () => ({ currentUser: () => auth.current }));

const wrap = (locale: 'en' | 'ar' = 'en') => {
  const all = (locale === 'en' ? enMessages : arMessages) as unknown as Record<string, unknown>;
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <NextIntlClientProvider locale={locale} messages={{ cashBank: all.cashBank, users: all.users } as never}>{children}</NextIntlClientProvider>
  );
  return Wrapper;
};

const FULL: AccessLookups = {
  roles: [
    { id: 'r1', slug: 'staff', name: 'Floor staff', is_owner: false, is_system: true },
    { id: 'r2', slug: 'role-ab12cd34', name: 'Cashier', is_owner: false, is_system: false },
  ] as never,
  users: [{ id: 'u1', name: 'Hind', email: 'hind@acme.test' }, { id: 'u2', name: 'Amal' }],
  branches: [{ id: 'b1', name: 'Dammam' }, { id: 'b2', name: 'Khobar' }],
};
const NONE: AccessLookups = { roles: null, users: null, branches: null };

function Harness({ initial, lookups = FULL, action = 'deposit' as const }: { initial: AccessRuleValue; lookups?: AccessLookups; action?: 'deposit' | 'withdraw' }) {
  const [value, setValue] = React.useState(initial);
  return (
    <>
      <AccessRuleField action={action} value={value} initial={initial} onChange={setValue} lookups={lookups} />
      <output data-testid="state">{JSON.stringify(value)}</output>
    </>
  );
}
const state = () => JSON.parse(screen.getByTestId('state').textContent!) as AccessRuleValue;

beforeEach(() => {
  auth.current = { id: 'me', role: 'admin', permissions: ['*'] };
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AccessRuleField — who may deposit / withdraw', () => {
  it('explains each option in plain language and summarises the current rule', () => {
    render(<Harness initial={{ scope: 'all', subject: '' }} />, { wrapper: wrap() });
    expect(screen.getByText('Anyone whose role allows cash and bank operations.')).toBeTruthy();
    expect(screen.getByText(/Only operations recorded in one specific branch/)).toBeTruthy();
    expect(screen.getByText('Anyone whose role allows it can deposit.')).toBeTruthy();
  });

  it('replaces the free-text identifier with a named picker; choosing stores the id, shows the name', async () => {
    render(<Harness initial={{ scope: 'all', subject: '' }} />, { wrapper: wrap() });
    await userEvent.click(screen.getByRole('radio', { name: /Role/ }));
    expect(state()).toEqual({ scope: 'role', subject: '' });
    expect(screen.getByText('Choose a role, or switch to "All".')).toBeTruthy(); // لا مرجع بعد

    await userEvent.selectOptions(screen.getByLabelText('Role', { selector: 'select' }), 'role-ab12cd34');
    expect(state()).toEqual({ scope: 'role', subject: 'role-ab12cd34' });
    expect(screen.getByText('Only users with the role “Cashier” can deposit.')).toBeTruthy();
    expect(screen.queryByText('role-ab12cd34')).toBeNull(); // لا slug خام
  });

  it('switching scope clears the subject (a role slug is never sent under a user scope)', async () => {
    render(<Harness initial={{ scope: 'role', subject: 'staff' }} action="withdraw" />, { wrapper: wrap() });
    expect(screen.getByText('Only users with the role “Floor staff” can withdraw.')).toBeTruthy();
    await userEvent.click(screen.getByRole('radio', { name: /User/ }));
    expect(state()).toEqual({ scope: 'user', subject: '' });
    await userEvent.selectOptions(screen.getByLabelText('User', { selector: 'select' }), 'u2');
    expect(screen.getByText('Only Amal can withdraw.')).toBeTruthy();
  });

  it('switching back to the saved scope restores the saved subject', async () => {
    render(<Harness initial={{ scope: 'branch', subject: 'b2' }} />, { wrapper: wrap() });
    await userEvent.click(screen.getByRole('radio', { name: /All/ }));
    await userEvent.click(screen.getByRole('radio', { name: /Branch/ }));
    expect(state()).toEqual({ scope: 'branch', subject: 'b2' });
  });

  it('warns that the viewer would lock themselves out (owners and admins are not exempt)', async () => {
    render(<Harness initial={{ scope: 'all', subject: '' }} />, { wrapper: wrap() });
    await userEvent.click(screen.getByRole('radio', { name: /Role/ }));
    await userEvent.selectOptions(screen.getByLabelText('Role', { selector: 'select' }), 'staff'); // أنا admin
    expect(screen.getByRole('note').textContent).toContain("Your own role isn't included");
    expect(screen.getByRole('note').textContent).toContain('owners and admins are not exempt');

    await userEvent.click(screen.getByRole('radio', { name: /User/ }));
    await userEvent.selectOptions(screen.getByLabelText('User', { selector: 'select' }), 'u1');
    expect(screen.getByRole('note').textContent).toContain("You aren't the selected user");
  });

  it('no warning for a branch rule (the active branch is only known at operation time)', async () => {
    render(<Harness initial={{ scope: 'branch', subject: 'b1' }} />, { wrapper: wrap() });
    expect(screen.queryByRole('note')).toBeNull();
  });
});

describe('permission degradation (D-J)', () => {
  it('without the lists, a saved subject is described but a new one cannot be chosen — and nothing raw is shown', () => {
    render(<Harness initial={{ scope: 'role', subject: 'role-ab12cd34' }} lookups={NONE} />, { wrapper: wrap() });
    expect(screen.getByText(/A specific role is set \(its name isn't available to you\)/)).toBeTruthy();
    expect(screen.getByText(/requires the "view roles" permission/)).toBeTruthy();
    expect(screen.queryByText('role-ab12cd34')).toBeNull();
    expect((screen.getByRole('radio', { name: /User/ }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('radio', { name: /Branch/ }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('radio', { name: /All/ }) as HTMLInputElement).disabled).toBe(false);
  });

  it('a system role keeps its translated name even without roles.view', () => {
    render(<Harness initial={{ scope: 'role', subject: 'staff' }} lookups={NONE} />, { wrapper: wrap() });
    expect(screen.getByText(/Currently set: Staff/)).toBeTruthy();
  });

  it('useAccessLookups requests only what the viewer may read', async () => {
    auth.current = { id: 'me', role: 'role-x', permissions: ['payments.manage', 'branches.view'] };
    api.mockResolvedValue({ data: [{ id: 'b1', name: 'Dammam' }] });
    function Probe() {
      const l = useAccessLookups(true);
      return <output data-testid="l">{JSON.stringify({ r: l.roles, u: l.users, b: l.branches })}</output>;
    }
    render(<Probe />, { wrapper: wrap() });
    await waitFor(() => expect(JSON.parse(screen.getByTestId('l').textContent!).b).toEqual([{ id: 'b1', name: 'Dammam' }]));
    expect(api.mock.calls.map((c) => c[0])).toEqual(['/branches']);
    expect(JSON.parse(screen.getByTestId('l').textContent!)).toMatchObject({ r: null, u: null });
  });
});

describe('Arabic', () => {
  it('renders the rule summary in Arabic with the named subject', () => {
    render(<Harness initial={{ scope: 'branch', subject: 'b1' }} />, { wrapper: wrap('ar') });
    expect(screen.getByText('يقتصر الإيداع على العمليات المسجّلة في فرع «Dammam».')).toBeTruthy();
  });
});
