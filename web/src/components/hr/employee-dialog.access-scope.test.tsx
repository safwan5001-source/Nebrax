// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import enMessages from '@/messages/en.json';
import { EmployeeDialog } from './employee-dialog';

/**
 * AC-UX-05: نموذج الموظف يستعمل محرّر النطاق المشترك — «الكل/محدَّد»، فراغ «محدَّد» ممنوع قبل أي طلب،
 * والحمولة بلغة شاشة المستخدمين نفسها (التعديل بالفروقات، الإنشاء بحذف مفتاح «الكل»).
 */
const { api, auth } = vi.hoisted(() => ({
  api: vi.fn(),
  auth: { current: { id: 'me', role: 'admin', permissions: ['*'] } as { id: string; role: string; permissions: string[] } },
}));

vi.mock('@/lib/api', () => ({ api, ApiError: class ApiError extends Error {}, fetchImageUrl: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/auth', () => ({ currentUser: () => auth.current }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/lib/use-number-preview', () => ({ useNumberPreview: () => ({ number: 'E-1', loading: false }) }));
vi.mock('@/components/ui/number-preview-field', () => ({ NumberPreviewField: () => null }));

const all = enMessages as unknown as Record<string, unknown>;
const messages = { hr: all.hr, users: all.users, common: all.common };

function respond() {
  api.mockImplementation((path: string, init?: { method?: string }) => {
    if (init?.method === 'POST' && path === '/employees') return Promise.resolve({ data: { id: 'e9' } });
    if (init?.method) return Promise.resolve({ data: {} });
    if (path === '/roles') return Promise.resolve({ data: [{ id: 'r1', slug: 'staff', name: 'Staff', is_owner: false }] });
    if (path === '/branches') return Promise.resolve({ data: [{ id: 'b1', name: 'Dammam' }, { id: 'b2', name: 'Khobar' }] });
    if (path === '/warehouses') return Promise.resolve({ data: [{ id: 'w1', name: 'Main', branch_id: 'b1' }] });
    return Promise.resolve({ data: [] });
  });
}

const writes = () => api.mock.calls.filter((c) => (c[1] as { method?: string } | undefined)?.method) as [string, { method: string; body: Record<string, unknown> }][];

type LinkedArg = { id: string; name: string; email: string; role: string; branch_ids?: string[]; warehouse_ids?: string[] };
type ScopeArg = { branches: string[]; warehouses: string[] } | null;

const tree = (linkedUser?: LinkedArg, actorScope?: ScopeArg) => (
  <NextIntlClientProvider locale="en" messages={messages as never}>
    <EmployeeDialog open onClose={() => {}} onSaved={() => {}} canManageUsers initialAllowAccess linkedUser={linkedUser as never} actorScope={actorScope} />
  </NextIntlClientProvider>
);

// الافتراضي `null` = انتهى تحميل نطاق الفاعل ولم يُعرف (يحسم الخادم)؛ `undefined` الصريح = ما زال يُحمَّل.
function open(linkedUser?: LinkedArg, actorScope: ScopeArg = null) {
  return render(tree(linkedUser, actorScope));
}

beforeEach(() => {
  auth.current = { id: 'me', role: 'admin', permissions: ['*'] };
  respond();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function fillNewUser() {
  await userEvent.type(screen.getByLabelText('Name'), 'Hind');
  await userEvent.type(screen.getByLabelText('Email'), 'hind@acme.test');
  await userEvent.type(screen.getByLabelText('Password'), 'secret-pass-1');
}

describe('EmployeeDialog access scope (shared editor)', () => {
  it('offers the All / Selected choice instead of an unlabeled checklist', async () => {
    open();
    expect((await screen.findByRole('radio', { name: /All branches/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole('radio', { name: /Selected warehouses only/ })).toBeTruthy();
  });

  it('create: "All" sends no scope key; "Selected" sends the ticked ids', async () => {
    open();
    await fillNewUser();
    await userEvent.click(screen.getByRole('radio', { name: /Selected branches only/ }));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Khobar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(writes().some(([p]) => p === '/users')).toBe(true));
    const [, init] = writes().find(([p]) => p === '/users')!;
    expect(init.body.branch_ids).toEqual(['b2']);
    expect(init.body).not.toHaveProperty('warehouse_ids');
  });

  it('refuses an empty "Selected" before any request — the employee is not saved either', async () => {
    open();
    await fillNewUser();
    await userEvent.click(screen.getByRole('radio', { name: /Selected branches only/ }));
    expect(await screen.findByText('Select at least one branch, or switch to all branches.')).toBeTruthy();
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(writes()).toEqual([]);
  });

  it('edit: sends only the scope dimension that changed on the linked user', async () => {
    open({ id: 'u1', name: 'Hind', email: 'hind@acme.test', role: 'staff', branch_ids: ['b1'], warehouse_ids: [] });
    await userEvent.type(screen.getByLabelText('Name'), 'Hind'); // الاسم مطلوب في نموذج الموظف
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Khobar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(writes().some(([p]) => p === '/users/u1')).toBe(true));
    const [, init] = writes().find(([p]) => p === '/users/u1')!;
    expect((init.body.branch_ids as string[]).sort()).toEqual(['b1', 'b2']);
    expect(init.body).not.toHaveProperty('warehouse_ids');
  });

  it('edit with no scope change sends no scope keys at all', async () => {
    open({ id: 'u1', name: 'Hind', email: 'hind@acme.test', role: 'staff', branch_ids: ['b1'], warehouse_ids: [] });
    await userEvent.type(screen.getByLabelText('Name'), 'Hind');
    await screen.findByRole('checkbox', { name: 'Dammam' });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writes().some(([p]) => p === '/users/u1')).toBe(true));
    const [, init] = writes().find(([p]) => p === '/users/u1')!;
    expect(init.body).not.toHaveProperty('branch_ids');
    expect(init.body).not.toHaveProperty('warehouse_ids');
  });
});

describe('EmployeeDialog access scope for a scope-limited actor', () => {
  it('cannot pick "All": starts on "Selected", is told why, and cannot save until something is ticked', async () => {
    open(undefined, { branches: ['b1'], warehouses: [] });
    const all = (await screen.findByRole('radio', { name: /All branches/ })) as HTMLInputElement;
    expect(all.disabled).toBe(true);
    expect((screen.getByRole('radio', { name: /Selected branches only/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/this list shows only those, and you can only assign branches from within it/)).toBeTruthy();

    await fillNewUser();
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    expect(writes()).toEqual([]); // الموظف لا يُحفظ ثم يفشل الدخول
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Dammam' }));
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writes().some(([p]) => p === '/users')).toBe(true));
    expect(writes().find(([p]) => p === '/users')![1].body.branch_ids).toEqual(['b1']);
  });

  it('an unlimited actor is unaffected', async () => {
    open(undefined, { branches: [], warehouses: [] });
    expect(((await screen.findByRole('radio', { name: /All branches/ })) as HTMLInputElement).disabled).toBe(false);
  });
});

describe('EmployeeDialog: the actor scope arrives after the dialog opened', () => {
  it('reseeds the untouched scope so a limited actor cannot submit "All" in the gap', async () => {
    const view = render(tree(undefined, undefined)); // قائمة المستخدمين لم تصل بعد
    expect(((await screen.findByRole('radio', { name: /All branches/ })) as HTMLInputElement).disabled).toBe(false);

    view.rerender(tree(undefined, { branches: ['b1'], warehouses: [] }));
    await waitFor(() => expect((screen.getByRole('radio', { name: /All branches/ }) as HTMLInputElement).disabled).toBe(true));
    expect((screen.getByRole('radio', { name: /Selected branches only/ }) as HTMLInputElement).checked).toBe(true);

    await fillNewUser();
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    expect(writes()).toEqual([]);
  });

  it('keeps a dimension the user already changed when the scope arrives', async () => {
    const view = render(tree(undefined, undefined));
    await userEvent.click(await screen.findByRole('radio', { name: /Selected branches only/ }));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Khobar' }));

    view.rerender(tree(undefined, { branches: ['b1', 'b2'], warehouses: [] }));
    await waitFor(() => expect((screen.getByRole('radio', { name: /All branches/ }) as HTMLInputElement).disabled).toBe(true));
    expect((screen.getByRole('checkbox', { name: 'Khobar' }) as HTMLInputElement).checked).toBe(true);
  });
});

describe('EmployeeDialog: login access is blocked until the actor scope is known', () => {
  it('while the scope is loading, Save is disabled with a reason and nothing is written; it unblocks when the scope arrives', async () => {
    const view = render(tree(undefined, undefined));
    await fillNewUser();
    expect(await screen.findByText('Checking your own access scope before login access can be granted…')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    expect(writes()).toEqual([]);

    view.rerender(tree(undefined, { branches: [], warehouses: [] }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByText(/Checking your own access scope/)).toBeNull();
  });

  it('a lookup that finished without a usable scope (null) never blocks creation — the server decides', async () => {
    open(undefined, null);
    await fillNewUser();
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('does not block an employee save that grants no login access', async () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages as never}>
        <EmployeeDialog open onClose={() => {}} onSaved={() => {}} canManageUsers actorScope={undefined} />
      </NextIntlClientProvider>,
    );
    await userEvent.type(screen.getByLabelText('Name'), 'Hind');
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
