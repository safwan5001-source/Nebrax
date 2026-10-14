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

function open(linkedUser?: { id: string; name: string; email: string; role: string; branch_ids?: string[]; warehouse_ids?: string[] }) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages as never}>
      <EmployeeDialog open onClose={() => {}} onSaved={() => {}} canManageUsers initialAllowAccess linkedUser={linkedUser as never} />
    </NextIntlClientProvider>,
  );
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
