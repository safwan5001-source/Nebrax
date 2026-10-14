// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import enMessages from '@/messages/en.json';
import { UserEditorSheet, type ActorScope } from './user-editor-sheet';

const { api, auth } = vi.hoisted(() => ({
  api: vi.fn(),
  auth: { current: null as null | { id: string; role: string; permissions?: string[] } },
}));

const { FakeApiError } = vi.hoisted(() => ({ FakeApiError: class FakeApiError extends Error {} }));
vi.mock('@/lib/api', () => ({ api, ApiError: FakeApiError }));
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
    if (path === '/warehouses') return Promise.resolve({ data: [{ id: 'w1', name: 'Main', branch_id: 'b1' }] });
    return Promise.resolve({ data: {} });
  });
}

function open(
  user: typeof existing | null,
  extra: { onClose?: () => void; onSaved?: () => void; actorScope?: ActorScope; locale?: 'en' } = {},
) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages as never}>
      <UserEditorSheet open onClose={extra.onClose ?? (() => {})} onSaved={extra.onSaved ?? (() => {})} user={user} actorScope={extra.actorScope} />
    </NextIntlClientProvider>,
  );
}

const readPaths = () => api.mock.calls.filter((c) => !(c[1] as { method?: string } | undefined)?.method).map((c) => String(c[0]));
const writes = () => api.mock.calls.filter((c) => (c[1] as { method?: string } | undefined)?.method);
const bodyOf = () => (writes()[0][1] as { body: Record<string, unknown> }).body;
const save = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
const ADMIN = { id: 'me', role: 'admin', permissions: ['*'] };

beforeEach(() => respond());
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('UserEditorSheet — independently gated inputs (D-J)', () => {
  it('requests every lookup when the viewer may read them; Save stays off until something changes, then sends only the diff', async () => {
    auth.current = ADMIN;
    open(existing);

    await screen.findByDisplayValue('hind@acme.test');
    await waitFor(() => expect(new Set(readPaths())).toEqual(new Set(['/roles', '/employees', '/branches', '/warehouses'])));
    expect(save().disabled).toBe(true);
    expect(screen.getByText('No changes yet')).toBeTruthy();

    await userEvent.type(screen.getByLabelText('Name'), ' A.');
    expect(save().disabled).toBe(false);
    await userEvent.click(save());

    await waitFor(() => expect(writes()).toHaveLength(1));
    const [path, init] = writes()[0] as [string, { method: string; body: Record<string, unknown> }];
    expect(path).toBe('/users/u1');
    expect(init.method).toBe('PUT');
    // لا دور ولا نطاق ولا ربط: لم يُلمَس شيء منها فلا يُعاد إرساله.
    expect(init.body).toEqual({ name: 'Hind A.' });
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
    expect(screen.queryByRole('radio')).toBeNull();

    await userEvent.type(screen.getByLabelText('Name'), '!');
    await userEvent.click(save());
    await waitFor(() => expect(writes()).toHaveLength(1));
    // غياب المفتاح = «بلا تغيير» في الخادم: لا يُمحى دورٌ ولا نطاقٌ ولا ربطٌ بالسهو.
    expect(bodyOf()).toEqual({ name: 'Hind!' });
  });

  it('cannot create a user without roles.view (role is required) and says why', async () => {
    auth.current = { id: 'me', role: 'role-x', permissions: ['users.manage'] };
    open(null);

    expect(await screen.findByText(/Creating a user requires the "view roles" permission/)).toBeTruthy();
    expect(save().disabled).toBe(true);
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

  it("cannot deactivate your own account through the editor, but can for someone else", async () => {
    auth.current = { id: 'u1', role: 'admin', permissions: ['*'] };
    const { unmount } = open(existing); // المحرَّر هو المستخدم نفسه
    const own = (await screen.findByLabelText('Status')) as HTMLSelectElement;
    expect(own.disabled).toBe(true);
    expect(screen.getByText("You can't deactivate your own account from here.")).toBeTruthy();
    unmount();

    auth.current = { id: 'someone-else', role: 'admin', permissions: ['*'] };
    open(existing);
    expect(((await screen.findByLabelText('Status')) as HTMLSelectElement).disabled).toBe(false);
  });

  it("offers only roles the actor can grant (server ceiling), keeping the edited account's current role", async () => {
    auth.current = { id: 'me', role: 'role-mgr', permissions: ['users.manage', 'roles.view', 'invoices.view'] };
    api.mockImplementation((path: string) => {
      if (path === '/roles') return Promise.resolve({ data: [
        { id: 'r0', slug: 'owner', name: 'Owner', is_owner: true, permissions: ['*'] },
        { id: 'r1', slug: 'admin', name: 'Admin', is_owner: false, permissions: ['*'] },
        { id: 'r2', slug: 'staff', name: 'Staff', is_owner: false, permissions: ['invoices.view'] },
        { id: 'r3', slug: 'wide', name: 'Wide custom', is_owner: false, permissions: ['invoices.view', 'payments.manage'] },
        { id: 'r4', slug: 'role-ab12cd34', name: 'Branch manager', is_owner: false, permissions: ['invoices.view', 'users.manage'] },
      ] });
      return Promise.resolve({ data: [] });
    });
    open(null);

    const select = (await screen.findByLabelText('Role')) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBeGreaterThan(0));
    // admin (`*`) والدور الأوسع والمالك لا تظهر؛ staff والدور الأضيق يظهران
    expect(Array.from(select.options).map((o) => o.value).sort()).toEqual(['role-ab12cd34', 'staff']);
  });
});

describe('UserEditorSheet — access scope (All / Selected)', () => {
  it('shows an empty stored scope as "All", never as "none", and sends nothing for it', async () => {
    auth.current = ADMIN;
    open({ ...existing, branch_ids: [], warehouse_ids: [] });

    const all = (await screen.findByRole('radio', { name: /All branches/ })) as HTMLInputElement;
    expect(all.checked).toBe(true);
    expect((screen.getByRole('radio', { name: /All warehouses/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(save().disabled).toBe(true);
  });

  it('blocks "Selected" with nothing ticked (it would silently mean All) and sends the chosen ids once ticked', async () => {
    auth.current = ADMIN;
    open({ ...existing, branch_ids: [] });

    await userEvent.click(await screen.findByRole('radio', { name: /Selected branches only/ }));
    expect(await screen.findByText('Select at least one branch, or switch to all branches.')).toBeTruthy();
    expect(save().disabled).toBe(true);

    await userEvent.click(await screen.findByRole('checkbox', { name: 'Khobar' }));
    expect(save().disabled).toBe(false);
    await userEvent.click(save());
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(bodyOf()).toEqual({ branch_ids: ['b2'] });
  });

  it('switching a restricted user to "All" sends an empty list (unrestricted) — and only that key', async () => {
    auth.current = ADMIN;
    open(existing);

    await userEvent.click(await screen.findByRole('radio', { name: /All branches/ }));
    await userEvent.click(save());
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(bodyOf()).toEqual({ branch_ids: [] });
  });

  it('keeps assignments the viewer cannot see, says so, and sends them back with the change', async () => {
    auth.current = ADMIN;
    open({ ...existing, branch_ids: ['b1', 'b-hidden'] });

    expect(await screen.findByText(/1 existing assignment is outside what you can see/)).toBeTruthy();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Khobar' }));
    await userEvent.click(save());
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect((bodyOf().branch_ids as string[]).sort()).toEqual(['b-hidden', 'b1', 'b2']);
  });

  it('filters the list by search and shows the selected count', async () => {
    auth.current = ADMIN;
    open(existing);

    expect(await screen.findByText('1 of 2 selected')).toBeTruthy();
    await userEvent.type(screen.getByLabelText('Search branches'), 'khob');
    expect(screen.queryByRole('checkbox', { name: 'Dammam' })).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Khobar' })).toBeTruthy();
  });

  it('shows the parent branch next to each warehouse', async () => {
    auth.current = ADMIN;
    open({ ...existing, warehouse_ids: ['w1'] });

    const box = await screen.findByRole('checkbox', { name: /Main/ });
    await waitFor(() => expect(box.closest('label')?.textContent).toContain('Dammam'));
  });

  it('an actor limited to specific branches cannot pick "All", and must tick at least one when creating', async () => {
    auth.current = { id: 'me', role: 'role-mgr', permissions: ['users.manage', 'roles.view', 'branches.view'] };
    open(null, { actorScope: { branches: ['b1'], warehouses: [] } });

    const all = (await screen.findByRole('radio', { name: /All branches/ })) as HTMLInputElement;
    expect(all.disabled).toBe(true);
    expect(screen.getByText(/only assign branches from within it/)).toBeTruthy();
    expect((screen.getByRole('radio', { name: /Selected branches only/ }) as HTMLInputElement).checked).toBe(true);
    await userEvent.type(screen.getByLabelText('Name'), 'N');
    await userEvent.type(screen.getByLabelText('Email'), 'n@acme.test');
    await userEvent.type(screen.getByLabelText('Password'), 'secret-pass-1');
    await waitFor(() => expect(screen.getByLabelText('Role')).toBeTruthy());
    expect(save().disabled).toBe(true); // لم يُحدَّد فرع بعد
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Dammam' }));
    expect(save().disabled).toBe(false);
  });

  it('creating sends scope keys only for "Selected"; "All" omits them', async () => {
    auth.current = ADMIN;
    open(null);

    await userEvent.type(await screen.findByLabelText('Name'), 'New User');
    await userEvent.type(screen.getByLabelText('Email'), 'new@acme.test');
    await userEvent.type(screen.getByLabelText('Password'), 'secret-pass-1');
    await userEvent.click(save());
    await waitFor(() => expect(writes()).toHaveLength(1));
    const body = bodyOf();
    expect(writes()[0][0]).toBe('/users');
    expect(body).not.toHaveProperty('branch_ids');
    expect(body).not.toHaveProperty('warehouse_ids');
    expect(body.role).toBe('staff');
  });

  it('updates the access summary live before saving', async () => {
    auth.current = ADMIN;
    open(existing);

    const summary = (await screen.findByText('Access summary')).closest('section')!;
    expect(summary.textContent).toContain('1 branch');
    expect(summary.textContent).toContain('All warehouses');
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Khobar' }));
    expect(summary.textContent).toContain('2 branches');
  });
});

describe('UserEditorSheet — dirty state and failure handling', () => {
  it('closes at once when nothing changed', async () => {
    auth.current = ADMIN;
    const onClose = vi.fn();
    open(existing, { onClose });
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('asks before discarding edits: keep editing returns, discard closes', async () => {
    auth.current = ADMIN;
    const onClose = vi.fn();
    open(existing, { onClose });

    await userEvent.type(await screen.findByLabelText('Name'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(await screen.findByText('Discard unsaved changes?')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByText('Discard unsaved changes?')).toBeNull();
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Hindx');

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape on a dirty form asks instead of dropping the edits', async () => {
    auth.current = ADMIN;
    const onClose = vi.fn();
    open(existing, { onClose });
    await userEvent.type(await screen.findByLabelText('Name'), 'x');
    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    expect(await screen.findByText('Discard unsaved changes?')).toBeTruthy();
  });

  it('shows the server message on refusal and neither reports success nor closes', async () => {
    auth.current = ADMIN;
    const onSaved = vi.fn();
    const onClose = vi.fn();
    api.mockImplementation((path: string, init?: { method?: string }) => {
      if (init?.method === 'PUT') return Promise.reject(new FakeApiError('You cannot manage a user whose role exceeds your permissions.'));
      if (path === '/roles') return Promise.resolve({ data: [{ id: 'r2', slug: 'role-ab12cd34', name: 'Branch manager', is_owner: false }] });
      return Promise.resolve({ data: [] });
    });
    open(existing, { onSaved, onClose });

    await userEvent.type(await screen.findByLabelText('Name'), 'x');
    await userEvent.click(save());
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'You cannot manage a user whose role exceeds your permissions.');
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(save().disabled).toBe(false); // يمكن المحاولة ثانيةً بعد التصحيح
  });
});

describe('actor scope arriving after the editor opened (create)', () => {
  it('reseeds the untouched scope from the now-known restriction', async () => {
    auth.current = { id: 'me', role: 'role-mgr', permissions: ['users.manage', 'roles.view', 'branches.view'] };
    const tree = (actor?: ActorScope) => (
      <NextIntlClientProvider locale="en" messages={messages as never}>
        <RoleEditorHarness actor={actor} />
      </NextIntlClientProvider>
    );
    const view = render(tree(undefined));
    expect(((await screen.findByRole('radio', { name: /All branches/ })) as HTMLInputElement).disabled).toBe(false);
    view.rerender(tree({ branches: ['b1'], warehouses: [] }));
    await waitFor(() => expect((screen.getByRole('radio', { name: /All branches/ }) as HTMLInputElement).disabled).toBe(true));
    expect((screen.getByRole('radio', { name: /Selected branches only/ }) as HTMLInputElement).checked).toBe(true);
  });
});

function RoleEditorHarness({ actor }: { actor?: ActorScope }) {
  return <UserEditorSheet open onClose={() => {}} onSaved={() => {}} user={null} actorScope={actor} />;
}
