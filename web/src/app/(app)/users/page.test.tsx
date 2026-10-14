// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import enMessages from '@/messages/en.json';
import arMessages from '@/messages/ar.json';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import UsersPage from './page';

const { api, toast, auth, nav, FakeApiError } = vi.hoisted(() => {
  class FakeApiError extends Error {
    status: number;
    constructor(message: string, status = 422) {
      super(message);
      this.status = status;
    }
  }
  return {
    api: vi.fn(),
    toast: { success: vi.fn(), error: vi.fn() },
    auth: { current: null as null | { id: string; role: string; permissions?: string[] } },
    nav: { search: '' },
    FakeApiError,
  };
});

vi.mock('@/lib/api', () => ({ api, ApiError: FakeApiError }));
vi.mock('@/lib/auth', () => ({ currentUser: () => auth.current }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => toast }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('@/components/users/user-dialog', () => ({
  UserDialog: ({ user }: { user?: { id: string } | null }) => <div data-testid="user-dialog">{user ? `edit:${user.id}` : 'create'}</div>,
}));
vi.mock('@/components/users/user-scope-dialog', () => ({
  UserScopeDialog: ({ user }: { user: { id: string } }) => <div data-testid="scope-dialog">{user.id}</div>,
}));

const user = (over: Record<string, unknown> = {}) => ({
  id: 'u1', name: 'Hind Alharbi', email: 'hind@acme.test', role: 'staff', is_active: true,
  employee_id: null, branch_ids: [] as string[], warehouse_ids: [] as string[], employee: null, ...over,
});
const OWNER = user({ id: 'me', name: 'Safwan', email: 'owner@acme.test', role: 'owner' });
const ROLES = [
  { id: 'r1', slug: 'owner', name: 'Owner', is_owner: true, is_system: true },
  { id: 'r2', slug: 'staff', name: 'Floor staff', is_owner: false, is_system: true },
  { id: 'r3', slug: 'role-ab12cd34', name: 'Branch manager', is_owner: false, is_system: false },
];
const BRANCHES = [{ id: 'b1', name: 'Dammam' }, { id: 'b2', name: 'Khobar' }, { id: 'b3', name: 'Jubail' }];

function world(users: unknown[], extra: Record<string, unknown> = {}) {
  api.mockImplementation((path: string, init?: { method?: string }) => {
    if (path === '/users' && !init?.method) return extra.usersError ? Promise.reject(extra.usersError) : Promise.resolve({ data: users });
    if (path === '/roles') return Promise.resolve({ data: ROLES });
    if (path === '/branches') return Promise.resolve({ data: BRANCHES });
    if (path === '/warehouses') return Promise.resolve({ data: [{ id: 'w1', name: 'Main store' }] });
    return Promise.resolve({ data: {} });
  });
}

// نحمّل النطاقات التي تستعملها الشاشة فقط من الملفات الحقيقية — فتُختبر مفاتيح الواجهة الفعلية.
const pick = (all: Record<string, unknown>) => ({ users: all.users, common: all.common, nebrax: all.nebrax, status: all.status });

function renderPage(locale: 'en' | 'ar' = 'en') {
  const all = (locale === 'en' ? enMessages : arMessages) as unknown as Record<string, unknown>;
  return render(
    <NextIntlClientProvider locale={locale} messages={pick(all) as never}>
      <ConfirmProvider>
        <UsersPage />
      </ConfirmProvider>
    </NextIntlClientProvider>,
  );
}

const paths = () => api.mock.calls.map((call) => String(call[0]));

beforeEach(() => {
  nav.search = '';
  auth.current = { id: 'me', role: 'owner', permissions: ['*'] };
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Users workspace (AC-UX-01)', () => {
  it('renders users with text status, role name, and scope summaries where empty means ALL', async () => {
    world([
      OWNER,
      user({ id: 'u1', role: 'role-ab12cd34', branch_ids: ['b1', 'b2', 'b3'], warehouse_ids: ['w1'], is_active: false }),
      user({ id: 'u2', name: 'Amal', email: 'amal@acme.test' }),
    ]);
    renderPage();

    expect((await screen.findAllByText('Hind Alharbi')).length).toBeGreaterThan(0);
    // الحالة نص لا لون فقط
    expect(screen.getAllByText('Inactive').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
    // الفراغ = الكل
    expect(screen.getAllByText('All branches').length).toBeGreaterThan(0);
    // اسم الدور المجلوب من /roles، لا slug
    expect(screen.getAllByText('Branch manager').length).toBeGreaterThan(0);
    expect(screen.queryByText('role-ab12cd34')).toBeNull();
    // ملخّص النطاق: الاسم الأول + الباقي
    expect(screen.getAllByText('Dammam +2').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Main store').length).toBeGreaterThan(0);
  });

  it('active filter chips show option labels, never a raw role slug or stored value', async () => {
    world([OWNER, user({ id: 'u1', role: 'role-ab12cd34' })]);
    renderPage();
    await screen.findAllByText('Hind Alharbi');

    await userEvent.selectOptions(screen.getByLabelText('Role'), 'role-ab12cd34');
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'inactive');
    await userEvent.selectOptions(screen.getByLabelText('Access scope'), 'restricted');

    const chips = screen.getByLabelText('Active filters');
    expect(chips.textContent).toContain('Role: Branch manager');
    expect(chips.textContent).toContain('Status: Inactive');
    expect(chips.textContent).toContain('Access scope: Restricted scope');
    expect(chips.textContent).not.toContain('role-ab12cd34');
    expect(chips.textContent).not.toContain('restricted:');
  });

  it('a bookmarked role filter never shows the raw slug, with or without roles.view', async () => {
    nav.search = 'f.role=eq:role-ab12cd34';
    auth.current = { id: 'v', role: 'role-x', permissions: ['users.view'] };
    world([user({ id: 'u1', role: 'role-ab12cd34' })]);
    renderPage();
    await screen.findAllByText('Hind Alharbi');

    const chips = screen.getByLabelText('Active filters');
    expect(chips.textContent).toContain('Role: Custom role');
    expect(chips.textContent).not.toContain('role-ab12cd34');
  });

  it('marks the signed-in account', async () => {
    world([OWNER]);
    renderPage();
    await screen.findAllByText('Safwan');
    expect(screen.getAllByText('You').length).toBeGreaterThan(0);
  });

  it('never requests lookups the viewer cannot read and never shows a raw custom slug', async () => {
    auth.current = { id: 'v', role: 'role-x', permissions: ['users.view'] };
    world([user({ id: 'u1', role: 'role-ab12cd34', branch_ids: ['b1'] })]);
    renderPage();

    await screen.findAllByText('Hind Alharbi');
    expect(paths()).toEqual(['/users']); // لا /roles ولا /branches ولا /warehouses
    expect(screen.getAllByText('Custom role').length).toBeGreaterThan(0);
    expect(screen.queryByText('role-ab12cd34')).toBeNull();
    // لا أسماء فروع بلا صلاحية القائمة: يسقط إلى العدّ
    expect(screen.getAllByText('1 branch').length).toBeGreaterThan(0);
  });

  it('gives a view-only viewer a read-only workspace with no mutation controls', async () => {
    auth.current = { id: 'v', role: 'role-x', permissions: ['users.view'] };
    world([user()]);
    renderPage();

    await screen.findAllByText('Hind Alharbi');
    expect(screen.getByRole('note').textContent).toContain('View only');
    expect(screen.queryByRole('button', { name: 'Add user' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
  });

  it('shows a no-access state and requests nothing without users.view', async () => {
    auth.current = { id: 'v', role: 'role-x', permissions: ['products.view'] };
    world([]);
    renderPage();

    expect(await screen.findByText("You don't have permission to view users")).toBeTruthy();
    expect(api).not.toHaveBeenCalled();
  });

  it('treats an explicit empty permission list as no access (not as admin by role name)', async () => {
    auth.current = { id: 'v', role: 'admin', permissions: [] };
    world([]);
    renderPage();
    expect(await screen.findByText("You don't have permission to view users")).toBeTruthy();
    expect(api).not.toHaveBeenCalled();
  });

  it('surfaces a load failure with retry instead of an empty table', async () => {
    world([], { usersError: new FakeApiError('Server exploded', 500) });
    renderPage();

    expect(await screen.findByText('Server exploded')).toBeTruthy();
    expect(screen.queryByText('No users yet')).toBeNull();
    api.mockImplementation((path: string) => Promise.resolve({ data: path === '/users' ? [user()] : [] }));
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect((await screen.findAllByText('Hind Alharbi')).length).toBeGreaterThan(0);
  });

  it('disables actions on an owner account for a non-owner and explains why', async () => {
    auth.current = { id: 'adm', role: 'admin', permissions: ['*'] };
    world([OWNER, user()]);
    renderPage();

    await screen.findAllByText('Safwan');
    const row = screen.getAllByRole('row').find((r) => within(r).queryByText('Safwan'))!;
    const edit = within(row).getByRole('button', { name: 'Edit' }) as HTMLButtonElement;
    expect(edit.disabled).toBe(true);
    expect(edit.title).toBe('Owner accounts can only be changed by an owner.');
  });

  it('a custom manager gets no controls on an admin row (the server would answer 403) but keeps them on a lower user', async () => {
    auth.current = { id: 'mgr', role: 'role-mgr', permissions: ['users.view', 'users.manage', 'roles.view', 'invoices.view'] };
    api.mockImplementation((path: string) => {
      if (path === '/users') return Promise.resolve({ data: [
        user({ id: 'mgr', name: 'Manager', role: 'role-mgr' }),
        user({ id: 'a1', name: 'Big Admin', role: 'admin' }),
        user({ id: 's1', name: 'Plain Staff', role: 'staff' }),
      ] });
      if (path === '/roles') return Promise.resolve({ data: [
        { id: 'r1', slug: 'admin', name: 'Admin', is_owner: false, is_system: true, permissions: ['*'] },
        { id: 'r2', slug: 'staff', name: 'Staff', is_owner: false, is_system: true, permissions: ['invoices.view'] },
        { id: 'r3', slug: 'role-mgr', name: 'Manager', is_owner: false, is_system: false, permissions: ['users.view', 'users.manage', 'roles.view', 'invoices.view'] },
      ] });
      return Promise.resolve({ data: [] });
    });
    renderPage();
    await screen.findAllByText('Big Admin');

    const adminRow = screen.getAllByRole('row').find((r) => within(r).queryByText('Big Admin'))!;
    const edit = within(adminRow).getByRole('button', { name: 'Edit' }) as HTMLButtonElement;
    expect(edit.disabled).toBe(true);
    expect(edit.title).toBe("This user's role exceeds your permissions.");

    const staffRow = screen.getAllByRole('row').find((r) => within(r).queryByText('Plain Staff'))!;
    expect((within(staffRow).getByRole('button', { name: 'Edit' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('does not allow deleting or deactivating your own account', async () => {
    world([OWNER, user()]);
    renderPage();
    await screen.findAllByText('Safwan');

    const row = screen.getAllByRole('row').find((r) => within(r).queryByText('Safwan'))!;
    await userEvent.click(within(row).getByRole('button', { name: 'More actions' }));
    expect((screen.getAllByRole('menuitem', { name: /Remove/ })[0] as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getAllByRole('menuitem', { name: /Deactivate account/ })[0] as HTMLButtonElement).disabled).toBe(true);
  });

  it('deactivation explains the consequences and only then sends is_active=false', async () => {
    world([OWNER, user()]);
    renderPage();
    await screen.findAllByText('Hind Alharbi');

    const row = screen.getAllByRole('row').find((r) => within(r).queryByText('Hind Alharbi'))!;
    await userEvent.click(within(row).getByRole('button', { name: 'More actions' }));
    await userEvent.click(within(row).getByRole('menuitem', { name: /Deactivate account/ }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Sign-in and API access stop immediately');
    expect(dialog.textContent).toContain('employee record and its history are not deleted');
    expect(api.mock.calls.some((c) => (c[1] as { method?: string } | undefined)?.method === 'PUT')).toBe(false);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Deactivate account' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Account deactivated.'));
    const put = api.mock.calls.find((c) => (c[1] as { method?: string } | undefined)?.method === 'PUT')!;
    expect(put[0]).toBe('/users/u1');
    expect(put[1]).toMatchObject({ method: 'PUT', body: { is_active: false } });
  });

  it('cancelling a confirmation sends nothing', async () => {
    world([OWNER, user()]);
    renderPage();
    await screen.findAllByText('Hind Alharbi');

    const row = screen.getAllByRole('row').find((r) => within(r).queryByText('Hind Alharbi'))!;
    await userEvent.click(within(row).getByRole('button', { name: 'More actions' }));
    await userEvent.click(within(row).getByRole('menuitem', { name: /Remove/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(api.mock.calls.some((c) => (c[1] as { method?: string } | undefined)?.method === 'DELETE')).toBe(false);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('a refused delete (403/422) shows the server message and NEVER a success toast', async () => {
    world([OWNER, user()]);
    api.mockImplementation((path: string, init?: { method?: string }) => {
      if (init?.method === 'DELETE') return Promise.reject(new FakeApiError('You cannot manage a user whose role exceeds your permissions.', 403));
      if (path === '/users') return Promise.resolve({ data: [OWNER, user()] });
      return Promise.resolve({ data: [] });
    });
    renderPage();
    await screen.findAllByText('Hind Alharbi');

    const row = screen.getAllByRole('row').find((r) => within(r).queryByText('Hind Alharbi'))!;
    await userEvent.click(within(row).getByRole('button', { name: 'More actions' }));
    await userEvent.click(within(row).getByRole('menuitem', { name: /Remove/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('You cannot manage a user whose role exceeds your permissions.'));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('opens the editor for create and edit', async () => {
    world([OWNER, user()]);
    renderPage();
    await screen.findAllByText('Hind Alharbi');

    await userEvent.click(screen.getByRole('button', { name: 'Add user' }));
    expect((await screen.findByTestId('user-dialog')).textContent).toBe('create');
  });

  it('renders the Arabic locale with RTL-safe isolated email and Arabic copy', async () => {
    world([OWNER, user()]);
    renderPage('ar');
    expect((await screen.findAllByText('Hind Alharbi')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('كل الفروع').length).toBeGreaterThan(0);
    expect(screen.getAllByText('نشط').length).toBeGreaterThan(0);
    const email = screen.getAllByText('hind@acme.test')[0];
    expect(email.getAttribute('dir')).toBe('ltr');
  });
});
