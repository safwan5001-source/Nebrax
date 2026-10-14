// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import enMessages from '@/messages/en.json';
import arMessages from '@/messages/ar.json';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import RolesPage from './page';

const { api, toast, auth, FakeApiError } = vi.hoisted(() => {
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
    FakeApiError,
  };
});

vi.mock('@/lib/api', () => ({ api, ApiError: FakeApiError }));
vi.mock('@/lib/auth', () => ({ currentUser: () => auth.current }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => toast }));
vi.mock('@/components/roles/role-editor-sheet', () => ({
  RoleEditorSheet: ({ role, seed, sourceName }: { role?: { id: string } | null; seed?: { name: string; permissions: string[]; skipped: number }; sourceName?: string }) => (
    <div data-testid="role-dialog" data-seed={seed ? JSON.stringify(seed) : ''} data-source={sourceName ?? ''}>
      {role ? `edit:${role.id}` : seed ? 'clone' : 'create'}
    </div>
  ),
}));

const CATALOG = ['invoices.view', 'invoices.manage', 'users.view', 'pos.audit.export', 'pos.audit.view'];
const ROLES = [
  { id: 'r1', slug: 'owner', name: 'Owner', permissions: ['*'], is_system: true, is_owner: true, users_count: 1 },
  { id: 'r2', slug: 'staff', name: 'Floor staff', permissions: ['invoices.view'], is_system: true, is_owner: false, users_count: 4 },
  { id: 'r3', slug: 'role-ab12cd34', name: 'Branch manager', permissions: ['invoices.view', 'invoices.manage', 'pos.audit.view'], is_system: false, is_owner: false, users_count: 0 },
  { id: 'r4', slug: 'role-ff00ee11', name: 'Night auditor', permissions: ['pos.audit.view'], is_system: false, is_owner: false, users_count: 2 },
];

function world(opts: { rolesError?: Error; roles?: unknown[]; deleteError?: Error } = {}) {
  api.mockImplementation((path: string, init?: { method?: string }) => {
    if (path === '/roles' && !init?.method) {
      return opts.rolesError ? Promise.reject(opts.rolesError) : Promise.resolve({ data: opts.roles ?? ROLES, meta: { permissions: CATALOG } });
    }
    if (init?.method === 'DELETE') return opts.deleteError ? Promise.reject(opts.deleteError) : Promise.resolve({ message: 'deleted' });
    return Promise.resolve({ data: {} });
  });
}

const pick = (all: Record<string, unknown>) => ({ rolesPage: all.rolesPage, hr: all.hr, common: all.common, nebrax: all.nebrax });

function renderPage(locale: 'en' | 'ar' = 'en') {
  const all = (locale === 'en' ? enMessages : arMessages) as unknown as Record<string, unknown>;
  return render(
    <NextIntlClientProvider locale={locale} messages={pick(all) as never}>
      <ConfirmProvider>
        <RolesPage />
      </ConfirmProvider>
    </NextIntlClientProvider>,
  );
}

const selectRole = async (name: string) => userEvent.click(await screen.findByRole('button', { name: new RegExp(name) }));

beforeEach(() => {
  auth.current = { id: 'me', role: 'owner', permissions: ['*'] };
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Roles workspace (AC-UX-03A)', () => {
  it('lists roles with name, kind, permission and user counts, and never shows a raw slug', async () => {
    world();
    renderPage();

    const rail = await screen.findByRole('navigation', { name: 'Roles' });
    expect(within(rail).getByText('Branch manager')).toBeTruthy();
    expect(within(rail).getByText(/3 of 5 permissions · No users assigned|3 of 5 permissions · 0 users/)).toBeTruthy();
    expect(within(rail).getAllByText('System role').length).toBe(2);
    expect(screen.queryByText('role-ab12cd34')).toBeNull();
  });

  it('shows the selected role\'s catalogue grouped by module, with granted and not-granted as text', async () => {
    world();
    renderPage();

    await selectRole('Branch manager');
    const detail = await screen.findByRole('region', { name: 'Branch manager' });
    expect(within(detail).getByRole('region', { name: 'Invoices' })).toBeTruthy();
    expect(within(detail).getByText('2 of 2')).toBeTruthy();
    // pos.audit.export غير ممنوحة: النص يقولها، لا اللون وحده
    const audit = within(detail).getByRole('region', { name: 'Point of sale' });
    expect(within(audit).getAllByText('Granted')).toHaveLength(1);
    expect(within(audit).getAllByText('Not granted')).toHaveLength(1);
    // المفتاح الكنسي الدقيق متاح
    expect(within(detail).getByText('pos.audit.export')).toBeTruthy();
  });

  it('expands the wildcard: the owner role shows every permission granted and full access', async () => {
    world();
    renderPage();

    const detail = await screen.findByRole('region', { name: 'Owner' });
    expect(within(detail).getAllByText('Full access').length).toBeGreaterThan(0);
    expect(within(detail).queryByText('Not granted')).toBeNull();
    expect(within(detail).getByText(/The owner role is protected/)).toBeTruthy();
  });

  it('searches the catalogue and filters to granted only', async () => {
    world();
    renderPage();
    await selectRole('Branch manager');
    const detail = await screen.findByRole('region', { name: 'Branch manager' });

    await userEvent.type(within(detail).getByLabelText('Search permissions…'), 'export');
    expect(within(detail).queryByRole('region', { name: 'Invoices' })).toBeNull();
    expect(within(detail).getByText('pos.audit.export')).toBeTruthy();

    await userEvent.clear(within(detail).getByLabelText('Search permissions…'));
    await userEvent.click(within(detail).getByRole('switch', { name: 'Granted only' }));
    expect(within(detail).queryByText('pos.audit.export')).toBeNull();
    expect(within(detail).getByText('pos.audit.view')).toBeTruthy();

    await userEvent.type(within(detail).getByLabelText('Search permissions…'), 'zzzz');
    expect(within(detail).getByText('No matching permissions')).toBeTruthy();
  });

  it('filters the role rail by name', async () => {
    world();
    renderPage();
    const rail = await screen.findByRole('navigation', { name: 'Roles' });
    await userEvent.type(within(rail).getByLabelText('Search roles…'), 'night');
    expect(within(rail).queryByText('Branch manager')).toBeNull();
    expect(within(rail).getByText('Night auditor')).toBeTruthy();
  });
});

describe('viewer types (§4.8)', () => {
  it('* holder: can create, edit, and delete a deletable custom role', async () => {
    world();
    renderPage();
    await selectRole('Branch manager');
    const detail = await screen.findByRole('region', { name: 'Branch manager' });

    expect(screen.getByRole('button', { name: 'New role' })).toBeTruthy();
    expect((within(detail).getByRole('button', { name: 'Edit role' }) as HTMLButtonElement).disabled).toBe(false);
    expect((within(detail).getByRole('button', { name: 'Delete role' }) as HTMLButtonElement).disabled).toBe(false);

    await userEvent.click(within(detail).getByRole('button', { name: 'Edit role' }));
    expect((await screen.findByTestId('role-dialog')).textContent).toBe('edit:r3');
  });

  it('Duplicate opens a seeded create (not an edit) and leaves the source role untouched', async () => {
    world();
    renderPage();
    await selectRole('Branch manager');
    const detail = await screen.findByRole('region', { name: 'Branch manager' });
    const before = JSON.stringify(ROLES);

    await userEvent.click(within(detail).getByRole('button', { name: 'Duplicate role' }));
    const editor = await screen.findByTestId('role-dialog');
    expect(editor.textContent).toBe('clone');
    expect(editor.getAttribute('data-source')).toBe('Branch manager');
    expect(JSON.parse(editor.getAttribute('data-seed')!)).toEqual({
      name: 'Branch manager (copy)',
      permissions: ['invoices.view', 'invoices.manage', 'pos.audit.view'],
      skipped: 0,
    });
    expect(JSON.stringify(ROLES)).toBe(before);
    // لا نداء كتابة عند مجرد فتح المحرّر
    expect(api.mock.calls.filter((c) => (c[1] as { method?: string } | undefined)?.method)).toEqual([]);
  });

  it('Duplicate drops permissions a limited manager cannot grant, and counts them', async () => {
    auth.current = { id: 'me', role: 'role-mgr', permissions: ['roles.view', 'roles.manage', 'invoices.view', 'pos.audit.view'] };
    world();
    renderPage();
    await selectRole('Branch manager'); // يحمل invoices.manage خارج صلاحياته
    const detail = await screen.findByRole('region', { name: 'Branch manager' });
    await userEvent.click(within(detail).getByRole('button', { name: 'Duplicate role' }));
    const seed = JSON.parse((await screen.findByTestId('role-dialog')).getAttribute('data-seed')!);
    expect(seed.permissions).toEqual(['invoices.view', 'pos.audit.view']);
    expect(seed.skipped).toBe(1);
  });

  it('view-only holders get no Duplicate control', async () => {
    auth.current = { id: 'me', role: 'role-x', permissions: ['roles.view'] };
    world();
    renderPage();
    await screen.findByRole('region', { name: 'Owner' });
    expect(screen.queryByRole('button', { name: 'Duplicate role' })).toBeNull();
  });

  it('disables with a reason what the server would refuse: owner, system delete, role with users', async () => {
    world();
    renderPage();

    const owner = await screen.findByRole('region', { name: 'Owner' });
    const ownerEdit = within(owner).getByRole('button', { name: 'Edit role' }) as HTMLButtonElement;
    expect(ownerEdit.disabled).toBe(true);
    expect(ownerEdit.title).toBe('The owner role cannot be changed.');

    await selectRole('Floor staff');
    const staff = await screen.findByRole('region', { name: 'Floor staff' });
    expect((within(staff).getByRole('button', { name: 'Edit role' }) as HTMLButtonElement).disabled).toBe(false);
    const staffDelete = within(staff).getByRole('button', { name: 'Delete role' }) as HTMLButtonElement;
    expect(staffDelete.disabled).toBe(true);
    expect(staffDelete.title).toBe('System roles cannot be deleted.');

    await selectRole('Night auditor');
    const night = await screen.findByRole('region', { name: 'Night auditor' });
    expect((within(night).getByRole('button', { name: 'Delete role' }) as HTMLButtonElement).title).toBe('Reassign its users before deleting this role.');
  });

  it('manage holder without * cannot edit a role above their own permissions', async () => {
    auth.current = { id: 'me', role: 'role-mgr', permissions: ['roles.view', 'roles.manage', 'invoices.view', 'pos.audit.view'] };
    world();
    renderPage();

    await selectRole('Branch manager'); // يحمل invoices.manage خارج صلاحياته
    const above = await screen.findByRole('region', { name: 'Branch manager' });
    const edit = within(above).getByRole('button', { name: 'Edit role' }) as HTMLButtonElement;
    expect(edit.disabled).toBe(true);
    expect(edit.title).toBe("This role's permissions exceed yours.");

    await selectRole('Night auditor');
    const below = await screen.findByRole('region', { name: 'Night auditor' });
    expect((within(below).getByRole('button', { name: 'Edit role' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('view-only holder gets a read-only workspace: no create, edit or delete controls', async () => {
    auth.current = { id: 'me', role: 'role-x', permissions: ['roles.view'] };
    world();
    renderPage();

    await screen.findByRole('region', { name: 'Owner' });
    expect(screen.getByRole('note').textContent).toContain('View only');
    expect(screen.queryByRole('button', { name: 'New role' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit role' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete role' })).toBeNull();
    // الكتالوج نفسه يبقى مقروءاً
    expect(screen.getAllByText('Granted').length).toBeGreaterThan(0);
  });

  it('without roles.view: a no-access state and no request is made', async () => {
    auth.current = { id: 'me', role: 'role-x', permissions: ['users.view'] };
    world();
    renderPage();

    expect(await screen.findByText("You don't have permission to view roles")).toBeTruthy();
    expect(api).not.toHaveBeenCalled();
  });
});

describe('failure and state handling', () => {
  it('shows the server message when delete is refused and does not report success', async () => {
    world({ deleteError: new FakeApiError('Cannot delete: users are assigned to this role.') });
    renderPage();
    await selectRole('Branch manager');
    const detail = await screen.findByRole('region', { name: 'Branch manager' });

    await userEvent.click(within(detail).getByRole('button', { name: 'Delete role' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Delete the role "Branch manager"?');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete role' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Cannot delete: users are assigned to this role.'));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('deletes after confirmation and reloads', async () => {
    world();
    renderPage();
    await selectRole('Branch manager');
    const detail = await screen.findByRole('region', { name: 'Branch manager' });
    await userEvent.click(within(detail).getByRole('button', { name: 'Delete role' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete role' }));

    await waitFor(() => expect(api.mock.calls.some((c) => c[0] === '/roles/r3' && (c[1] as { method: string }).method === 'DELETE')).toBe(true));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(api.mock.calls.filter((c) => c[0] === '/roles' && !(c[1] as { method?: string } | undefined)?.method).length).toBeGreaterThanOrEqual(2);
  });

  it('a failed load shows an error with retry, not an empty list', async () => {
    world({ rolesError: new FakeApiError('Server unavailable', 500) });
    renderPage();
    expect(await screen.findByText('Server unavailable')).toBeTruthy();
    expect(screen.queryByText('No roles yet')).toBeNull();

    world();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('region', { name: 'Owner' })).toBeTruthy();
  });

  it('an empty tenant shows the empty state with a create action for managers', async () => {
    world({ roles: [] });
    renderPage();
    expect(await screen.findByText('No roles yet')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'New role' }).length).toBeGreaterThan(0);
  });

  it('renders Arabic copy with translated module and action labels and isolated keys', async () => {
    world();
    renderPage('ar');
    await selectRole('Branch manager');
    const detail = await screen.findByRole('region', { name: 'Branch manager' });
    expect(within(detail).getByRole('region', { name: 'نقطة البيع' })).toBeTruthy();
    expect(within(detail).getAllByText('ممنوحة').length).toBeGreaterThan(0);
    expect(within(detail).getByText('pos.audit.export').getAttribute('dir')).toBe('ltr');
    expect(within(detail).queryByText(/Audit/)).toBeNull(); // المجال مترجَم لا حرفياً
  });
});
