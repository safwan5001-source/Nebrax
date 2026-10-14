// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import enMessages from '@/messages/en.json';
import arMessages from '@/messages/ar.json';
import { UserAccessSummarySheet } from './user-access-summary-sheet';

const { auth } = vi.hoisted(() => ({ auth: { current: null as null | { id: string; role: string; permissions?: string[] } } }));
vi.mock('@/lib/auth', () => ({ currentUser: () => auth.current }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const USER = {
  id: 'u1', name: 'Hind Alharbi', email: 'hind@acme.test', role: 'role-ab12cd34', is_active: true,
  branch_ids: ['b1', 'b2'], warehouse_ids: [] as string[], employee: null as null | { id: string; name: string; employee_no?: string },
};
const ROLES = [
  { id: 'r3', slug: 'role-ab12cd34', name: 'Branch manager', is_owner: false, is_system: false, permissions: ['invoices.view', 'roles.manage', 'users.manage'] },
];
const BRANCHES = [{ id: 'b1', name: 'Dammam' }, { id: 'b2', name: 'Khobar' }];

function renderSheet(over: Partial<React.ComponentProps<typeof UserAccessSummarySheet>> = {}, locale: 'en' | 'ar' = 'en') {
  const all = (locale === 'en' ? enMessages : arMessages) as unknown as Record<string, unknown>;
  const onClose = vi.fn();
  const view = render(
    <NextIntlClientProvider locale={locale} messages={{ users: all.users, rolesPage: all.rolesPage } as never}>
      <UserAccessSummarySheet
        user={USER}
        onClose={onClose}
        roles={ROLES}
        branches={BRANCHES}
        warehouses={null}
        isSelf={false}
        {...over}
      />
    </NextIntlClientProvider>,
  );
  return { ...view, onClose };
}

beforeEach(() => { auth.current = { id: 'me', role: 'owner', permissions: ['*'] }; });
afterEach(cleanup);

describe('UserAccessSummarySheet (AC-UX-08)', () => {
  it('summarises the source assignments: sign-in, role with counts, named branches, empty warehouses = all', () => {
    renderSheet();
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByText('Can sign in.')).toBeTruthy();
    expect(within(sheet).getByText('Branch manager')).toBeTruthy();
    expect(within(sheet).getByText('Custom role')).toBeTruthy();
    expect(within(sheet).getByText(/3 permissions/)).toBeTruthy();
    expect(within(sheet).getByText(/sensitive/)).toBeTruthy();
    expect(within(sheet).getByText('Limited to 2 branches')).toBeTruthy();
    expect(within(sheet).getByText('Dammam')).toBeTruthy();
    expect(within(sheet).getByText('Khobar')).toBeTruthy();
    expect(within(sheet).getByText(/All warehouses/)).toBeTruthy(); // الفراغ = الكل لا «لا شيء»
    expect(within(sheet).getByText('Not linked to an employee.')).toBeTruthy();
  });

  it('states plainly that it is not an effective-access calculation', () => {
    renderSheet();
    expect(screen.getByRole('note').textContent).toMatch(/only what is assigned/);
    expect(screen.getByRole('note').textContent).toMatch(/treasury account rules/);
  });

  it('inactive users are told they cannot sign in', () => {
    renderSheet({ user: { ...USER, is_active: false } });
    expect(screen.getByText(/Cannot sign in/)).toBeTruthy();
  });

  it('degrades without lookups: no invented names, counts only, system role keeps its name, no raw slug', () => {
    renderSheet({ roles: null, branches: null, user: { ...USER, role: 'role-ab12cd34' } });
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).queryByText('role-ab12cd34')).toBeNull();
    expect(within(sheet).getByText('Custom role')).toBeTruthy();
    expect(within(sheet).getByText(/Role permission details need access/)).toBeTruthy();
    expect(within(sheet).getByText('Limited to 2 branches')).toBeTruthy();
    expect(within(sheet).getByText(/Branch names need access/)).toBeTruthy();
    expect(within(sheet).queryByText('Dammam')).toBeNull();
  });

  it('ids the viewer cannot see are counted, not named', () => {
    renderSheet({ user: { ...USER, branch_ids: ['b1', 'ghost'] } });
    expect(screen.getByText('Limited to 2 branches')).toBeTruthy();
    expect(screen.getByText('and 1 more you cannot see')).toBeTruthy();
  });

  it('full-access role and the "You" marker', () => {
    renderSheet({
      user: { ...USER, role: 'owner', branch_ids: [] },
      roles: [{ id: 'r1', slug: 'owner', name: 'Owner', is_owner: true, is_system: true, permissions: ['*'] }],
      isSelf: true,
    });
    expect(screen.getByText('Owner role')).toBeTruthy();
    expect(screen.getByText(/Full access to everything/)).toBeTruthy();
    expect(screen.getByText(/You/)).toBeTruthy();
  });

  it('links the employee only for viewers who can open HR, and the roles shortcut only with roles.view', () => {
    auth.current = { id: 'me', role: 'x', permissions: ['users.view'] };
    renderSheet({ user: { ...USER, employee: { id: 'e1', name: 'Hind A.', employee_no: 'E-7' } } });
    expect(screen.getByText('E-7 — Hind A.').closest('a')).toBeNull();
    expect(screen.queryByText('Open roles')).toBeNull();
    cleanup();
    auth.current = { id: 'me', role: 'x', permissions: ['users.view', 'hr.view', 'roles.view'] };
    renderSheet({ user: { ...USER, employee: { id: 'e1', name: 'Hind A.', employee_no: 'E-7' } } });
    expect(screen.getByText('E-7 — Hind A.').closest('a')?.getAttribute('href')).toBe('/hr/employees/e1');
    expect(screen.getByText('Open roles').getAttribute('href')).toBe('/roles');
  });

  it('Edit appears only when the caller passes onEdit, and Close closes', async () => {
    const onEdit = vi.fn();
    const { onClose } = renderSheet({ onEdit });
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    cleanup();
    const second = renderSheet();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    await userEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]);
    expect(second.onClose).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Arabic renders translated sentences with plural forms', () => {
    renderSheet({}, 'ar');
    expect(screen.getByText('ملخّص الوصول', { exact: false })).toBeTruthy();
    expect(screen.getByText('مقيَّد بفرعين')).toBeTruthy();
    expect(screen.getByText(/كل المستودعات/)).toBeTruthy();
    expect(screen.getByRole('note').textContent).toMatch(/أُسنِد/);
  });
});
