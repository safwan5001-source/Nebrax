// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import enMessages from '@/messages/en.json';
import { UserDialog } from './user-dialog';

const { api, auth } = vi.hoisted(() => ({
  api: vi.fn(),
  auth: { current: null as null | { id: string; role: string; permissions?: string[] } },
}));

vi.mock('@/lib/api', () => ({ api, ApiError: class ApiError extends Error {} }));
vi.mock('@/lib/auth', () => ({ currentUser: () => auth.current }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

const messages = (() => {
  const all = enMessages as unknown as Record<string, unknown>;
  return { users: all.users, common: all.common };
})();

const existing = {
  id: 'u1', name: 'Hind', email: 'hind@acme.test', role: 'role-ab12cd34', is_active: true,
  employee_id: 'e1', branch_ids: ['b1'], warehouse_ids: [] as string[],
};

function respond() {
  api.mockImplementation((path: string) => {
    if (path === '/roles') return Promise.resolve({ data: [{ id: 'r1', slug: 'staff', name: 'Staff', is_owner: false }, { id: 'r2', slug: 'role-ab12cd34', name: 'Branch manager', is_owner: false }] });
    if (path === '/employees') return Promise.resolve({ data: [{ id: 'e1', name: 'Hind', employee_no: 'E-1' }] });
    if (path === '/branches') return Promise.resolve({ data: [{ id: 'b1', name: 'Dammam' }, { id: 'b2', name: 'Khobar' }] });
    if (path === '/warehouses') return Promise.resolve({ data: [{ id: 'w1', name: 'Main' }] });
    return Promise.resolve({ data: {} });
  });
}

function open(user: typeof existing | null) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <UserDialog open onClose={() => {}} onSaved={() => {}} user={user} />
    </NextIntlClientProvider>,
  );
}

const readPaths = () => api.mock.calls.filter((c) => !(c[1] as { method?: string } | undefined)?.method).map((c) => String(c[0]));
const writes = () => api.mock.calls.filter((c) => (c[1] as { method?: string } | undefined)?.method);

beforeEach(() => respond());
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('UserDialog — independently gated inputs (D-J)', () => {
  it('requests every lookup when the viewer may read them and sends every field', async () => {
    auth.current = { id: 'me', role: 'admin', permissions: ['*'] };
    open(existing);

    await screen.findByDisplayValue('hind@acme.test');
    await waitFor(() => expect(new Set(readPaths())).toEqual(new Set(['/roles', '/employees', '/branches', '/warehouses'])));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    const [path, init] = writes()[0] as [string, { method: string; body: Record<string, unknown> }];
    expect(path).toBe('/users/u1');
    expect(Object.keys(init.body).sort()).toEqual(['branch_ids', 'employee_id', 'is_active', 'name', 'role', 'warehouse_ids']);
    expect(init.body.role).toBe('role-ab12cd34');
  });

  it('with users.manage alone: no lookup requests, role/employee/scope are read-only and never sent', async () => {
    auth.current = { id: 'me', role: 'role-x', permissions: ['users.view', 'users.manage'] };
    open(existing);

    await screen.findByDisplayValue('hind@acme.test');
    expect(readPaths()).toEqual([]); // لا طلب يُعرف سلفاً أنه 403
    expect(screen.getByText(/Changing the role requires the "view roles" permission/)).toBeTruthy();
    expect(screen.getByText(/Editing branches requires/)).toBeTruthy();
    expect(screen.getByText(/Editing warehouses requires/)).toBeTruthy();
    expect(screen.queryByLabelText('Link to employee')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    const body = (writes()[0][1] as { body: Record<string, unknown> }).body;
    // غياب المفتاح = «بلا تغيير» في الخادم: لا يُمحى دورٌ ولا نطاقٌ ولا ربطٌ بالسهو.
    expect(Object.keys(body).sort()).toEqual(['is_active', 'name']);
  });

  it('cannot create a user without roles.view (role is required) and says why', async () => {
    auth.current = { id: 'me', role: 'role-x', permissions: ['users.manage'] };
    open(null);

    expect(await screen.findByText(/Creating a user requires the "view roles" permission/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    expect(readPaths()).toEqual([]);
  });

  it('keeps the owner role as the selected value when an owner edits an owner account', async () => {
    auth.current = { id: 'me', role: 'owner', permissions: ['*'] };
    api.mockImplementation((path: string) => {
      if (path === '/roles') return Promise.resolve({ data: [{ id: 'r0', slug: 'owner', name: 'Owner', is_owner: true }, { id: 'r1', slug: 'staff', name: 'Staff', is_owner: false }] });
      return Promise.resolve({ data: [] });
    });
    open({ ...existing, id: 'me', role: 'owner', employee_id: null as unknown as string });

    const select = (await screen.findByLabelText('Role')) as HTMLSelectElement;
    await waitFor(() => expect(Array.from(select.options).map((o) => o.value)).toContain('owner'));
    expect(select.value).toBe('owner');
  });
});
