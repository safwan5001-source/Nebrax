// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import enMessages from '@/messages/en.json';
import arMessages from '@/messages/ar.json';
import type { CatalogLabels, RoleRecord } from '@/modules/roles/catalog';
import { cloneSeed, type CloneSeed } from '@/modules/roles/editor';
import { RoleEditorSheet } from './role-editor-sheet';

const { api, toast, FakeApiError } = vi.hoisted(() => ({
  api: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
  FakeApiError: class FakeApiError extends Error {},
}));

vi.mock('@/lib/api', () => ({ api, ApiError: FakeApiError }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => toast }));

/**
 * ACL-ROLE-UI-1 (موروث من RoleDialog) + AC-UX-03B: المفتاح الكنسي يُحفظ ويُرسَل حرفياً من الكتالوج
 * بصرف النظر عن عدد مقاطعه؛ التسمية دالةٌ عرضية لا تُغذّى مجدداً إلى التخويل. المفاتيح هنا من
 * `Rbac::PERMISSIONS` الحقيقية، عدا `future.module.frobnicate` لاختبار أمان الاحتياط العرضي.
 */
const LABELS: CatalogLabels = {
  modules: { products: 'Products', pos: 'POS', documents: 'Documents', users: 'Users', zatca: 'E-invoicing', payments: 'Payments' },
  actions: { view: 'View', manage: 'Manage', export: 'Export', review: 'Review', approve: 'Approve', build_draft: 'Build draft', submit: 'Submit' },
  areas: { audit: 'Audit', variance: 'Variance', center: 'Center' },
};
const CATALOG = [
  'products.view', 'products.manage',
  'pos.audit.view', 'pos.audit.review', 'pos.audit.export', 'pos.variance.approve',
  'documents.center.build_draft',
  'users.view', 'users.manage', 'payments.manage',
  'zatca.view', 'zatca.submit',
  'future.module.frobnicate',
];

const role = (over: Partial<RoleRecord> = {}): RoleRecord => ({
  id: 'r1', slug: 'role-ab12cd34', name: 'Auditor', permissions: ['products.view', 'pos.audit.export'],
  is_system: false, is_owner: false, users_count: 2, ...over,
});

const pick = (all: Record<string, unknown>) => ({ roleEditor: all.roleEditor, common: all.common });

function open(
  r: RoleRecord | null,
  extra: { actor?: string[]; onClose?: () => void; onSaved?: (id?: string) => void; locale?: 'en' | 'ar'; seed?: CloneSeed; source?: string } = {},
) {
  const locale = extra.locale ?? 'en';
  const all = (locale === 'en' ? enMessages : arMessages) as unknown as Record<string, unknown>;
  return render(
    <NextIntlClientProvider locale={locale} messages={pick(all) as never}>
      <RoleEditorSheet
        open
        onClose={extra.onClose ?? (() => {})}
        onSaved={extra.onSaved ?? (() => {})}
        role={r}
        catalog={CATALOG}
        labels={LABELS}
        actorPermissions={extra.actor ?? ['*']}
        seed={extra.seed}
        sourceName={extra.source}
      />
    </NextIntlClientProvider>,
  );
}

const box = (name: RegExp | string, module?: string) => {
  const scope = module ? within(screen.getByRole('region', { name: module })) : screen;
  return scope.getByRole('checkbox', { name }) as HTMLInputElement;
};
const save = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
const lastBody = () => (api.mock.calls.at(-1)?.[1] as { body: { name: string; permissions: string[] } }).body;

beforeEach(() => {
  api.mockReset();
  api.mockResolvedValue({ data: { id: 'new-id' } });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('canonical permission integrity (ACL-ROLE-UI-1)', () => {
  it('a two-segment permission survives selection and submission unchanged', async () => {
    open(null);
    await userEvent.type(screen.getByLabelText('Role name'), 'Reader');
    await userEvent.click(box('View', 'Products'));
    await userEvent.click(save());
    await waitFor(() => expect(api).toHaveBeenCalled());
    expect(api.mock.calls[0][0]).toBe('/roles');
    expect(lastBody()).toEqual({ name: 'Reader', permissions: ['products.view'] });
  });

  it('a multi-segment permission is retained character-for-character', async () => {
    open(null);
    await userEvent.type(screen.getByLabelText('Role name'), 'Drafter');
    await userEvent.click(box(/Center — Build draft/));
    await userEvent.click(save());
    await waitFor(() => expect(api).toHaveBeenCalled());
    expect(lastBody().permissions).toEqual(['documents.center.build_draft']);
  });

  it('three permissions sharing "pos.audit" never collapse into one', async () => {
    open(null);
    await userEvent.type(screen.getByLabelText('Role name'), 'Audit');
    await userEvent.click(box(/Audit — View/));
    await userEvent.click(box(/Audit — Export/));
    expect(box(/Audit — Review/).checked).toBe(false);
    await userEvent.click(save());
    await waitFor(() => expect(api).toHaveBeenCalled());
    const sent = lastBody().permissions;
    expect(sent).toEqual(['pos.audit.view', 'pos.audit.export']);
    expect(sent).not.toContain('pos.audit');
  });

  it('never mislabels another action as "View", and an unknown action gets a safe fallback with an untouched key', async () => {
    open(null);
    expect(box('Audit — Export').closest('label')?.textContent).toContain('Audit — Export');
    expect(box(/Variance — Approve/)).toBeTruthy();
    const unknown = box(/Module — Frobnicate/);
    expect(unknown.closest('label')?.textContent).not.toMatch(/^View/);
    await userEvent.type(screen.getByLabelText('Role name'), 'Future');
    await userEvent.click(unknown);
    await userEvent.click(save());
    await waitFor(() => expect(api).toHaveBeenCalled());
    expect(lastBody().permissions).toEqual(['future.module.frobnicate']);
  });

  it('editing preserves the role\'s selections and sends exactly the intended keys', async () => {
    open(role());
    expect(box('View', 'Products').checked).toBe(true);
    expect(box(/Audit — Export/).checked).toBe(true);
    expect(box(/Audit — View/).checked).toBe(false);

    await userEvent.click(box(/Variance — Approve/));
    await userEvent.click(box('View', 'Products'));
    await userEvent.click(save());
    await waitFor(() => expect(api).toHaveBeenCalledWith('/roles/r1', expect.objectContaining({ method: 'PUT' })));
    expect(lastBody().permissions).toEqual(['pos.audit.export', 'pos.variance.approve']);
  });

  it('zatca.submit is a separate explicit grant: selecting zatca.view never selects it (REM-37)', async () => {
    open(null);
    await userEvent.type(screen.getByLabelText('Role name'), 'Tax');
    await userEvent.click(box('View', 'E-invoicing'));
    expect(box('Submit', 'E-invoicing').checked).toBe(false);
    await userEvent.click(save());
    await waitFor(() => expect(api).toHaveBeenCalled());
    expect(lastBody().permissions).toEqual(['zatca.view']);
  });
});

describe('selection model', () => {
  it('group checkbox is tri-state and toggles the whole module', async () => {
    open(role({ permissions: ['pos.audit.view'] }));
    const pos = screen.getByRole('region', { name: 'POS' });
    const group = within(pos).getByRole('checkbox', { name: 'Select all in POS' }) as HTMLInputElement;
    expect(group.indeterminate).toBe(true);
    expect(group.getAttribute('aria-checked')).toBe('mixed');

    await userEvent.click(group);
    expect(group.checked).toBe(true);
    expect(within(pos).getAllByRole('checkbox').every((c) => (c as HTMLInputElement).checked)).toBe(true);

    await userEvent.click(group);
    expect(within(pos).getAllByRole('checkbox').filter((c) => (c as HTMLInputElement).checked)).toHaveLength(0);
  });

  it('search narrows the list and "Select visible" only selects what is shown', async () => {
    open(null);
    await userEvent.type(screen.getByLabelText('Search permissions…'), 'pos.audit');
    expect(screen.queryByRole('region', { name: 'Products' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Select visible' }));
    await userEvent.clear(screen.getByLabelText('Search permissions…'));
    expect(box(/Audit — View/).checked).toBe(true);
    expect(box('View', 'Products').checked).toBe(false);
    expect(screen.getByText('3 of 13 selected')).toBeTruthy();
  });

  it('"Selected only" hides unselected rows', async () => {
    open(role());
    await userEvent.click(screen.getByRole('switch', { name: 'Selected only' }));
    expect(screen.queryByRole('checkbox', { name: /Audit — View/ })).toBeNull();
    expect(box(/Audit — Export/)).toBeTruthy();
  });
});

describe('risk treatment', () => {
  it('labels sensitive permissions with text, counts them, and lists new ones in the change summary', async () => {
    open(role({ permissions: ['products.view'] }));
    expect(screen.getByText('No sensitive permissions selected')).toBeTruthy();

    await userEvent.click(box('Manage', 'Users'));
    await userEvent.click(box('Manage', 'Payments'));
    expect(screen.getByText('2 sensitive permissions selected')).toBeTruthy();
    expect(screen.getAllByText(/Changes access or security/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Sensitive permissions being added: .*Users: Manage.*Payments: Manage/)).toBeTruthy();
    expect(screen.getByText('2 added · 0 removed')).toBeTruthy();
  });
});

describe('save rules, dirty state and failure handling', () => {
  it('Save stays off until something changes, and the name and a permission are required', async () => {
    open(null);
    expect(save().disabled).toBe(true);
    await userEvent.type(screen.getByLabelText('Role name'), 'X');
    expect(await screen.findByText('Select at least one permission.')).toBeTruthy();
    expect(save().disabled).toBe(true);
    await userEvent.click(box('View', 'Products'));
    expect(save().disabled).toBe(false);
  });

  it('says changes apply immediately to the users who hold the role', () => {
    open(role({ users_count: 3 }));
    expect(screen.getByRole('note').textContent).toBe('Changes apply immediately to the 3 users with this role.');
    cleanup();
    open(role({ users_count: 0 }));
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('warns that saving a full-access role narrows it, and starts clean', () => {
    open(role({ permissions: ['*'], is_system: true, slug: 'admin', name: 'Admin' }));
    expect(screen.getByText(/Saving narrows it to exactly the permissions selected/)).toBeTruthy();
    expect(save().disabled).toBe(true);
    expect(box(/Audit — View/).checked).toBe(true);
  });

  it('asks before discarding edits; Escape does not drop them', async () => {
    const onClose = vi.fn();
    open(role(), { onClose });
    await userEvent.click(box(/Audit — View/));
    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    expect(await screen.findByText('Discard unsaved changes?')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(box(/Audit — View/).checked).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the server message on refusal, reports no success and stays open', async () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    api.mockRejectedValue(new FakeApiError('You cannot grant permissions beyond your own.'));
    open(role(), { onSaved, onClose });
    await userEvent.click(box(/Audit — View/));
    await userEvent.click(save());
    expect((await screen.findByRole('alert')).textContent).toBe('You cannot grant permissions beyond your own.');
    expect(toast.success).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('on create, reports the new role id so the page can select it', async () => {
    const onSaved = vi.fn();
    open(null, { onSaved });
    await userEvent.type(screen.getByLabelText('Role name'), 'New');
    await userEvent.click(box('View', 'Products'));
    await userEvent.click(save());
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('new-id'));
  });
});

describe('grant ceiling mirror (display only)', () => {
  it('disables permissions the actor does not hold and never selects them via a group toggle', async () => {
    open(null, { actor: ['roles.manage', 'products.view'] });
    const manage = box('Manage', 'Products');
    expect(manage.disabled).toBe(true);
    expect(screen.getAllByText(/Beyond your own permissions/).length).toBeGreaterThan(0);

    const products = screen.getByRole('region', { name: 'Products' });
    await userEvent.click(within(products).getByRole('checkbox', { name: 'Select all in Products' }));
    expect(box('View', 'Products').checked).toBe(true);
    expect(manage.checked).toBe(false);
  });
});

describe('owner role', () => {
  it('is read-only: no inputs enabled, no Save', () => {
    open(role({ is_owner: true, permissions: ['*'], name: 'Owner', slug: 'owner' }));
    expect(screen.getByText('The owner role is protected and cannot be edited.')).toBeTruthy();
    expect((screen.getByLabelText('Role name') as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(box(/Audit — View/).disabled).toBe(true);
  });
});

describe('Arabic', () => {
  it('renders Arabic copy', () => {
    open(role(), { locale: 'ar' });
    expect(screen.getByText('اسم الدور')).toBeTruthy();
    expect(screen.getByText(/تسري التغييرات فوراً على المستخدمَين/)).toBeTruthy();
  });
});

describe('safe client-side clone (AC-UX-04)', () => {
  const source = role({ id: 'src', slug: 'role-src', name: 'Auditor', is_system: true, users_count: 7, permissions: ['products.view', 'pos.audit.export'] });
  const seedFor = (actor: string[] = ['*']) => cloneSeed(source, CATALOG, actor, 'Auditor (copy)');

  it('opens as a pre-filled NEW role: copy notice, seeded name and selection, Save enabled, and no source-only notes', () => {
    open(null, { seed: seedFor(), source: 'Auditor' });
    expect(screen.getByRole('heading', { name: 'Duplicate role' })).toBeTruthy();
    expect(screen.getByRole('note').textContent).toBe('Copied from "Auditor". Review the permissions before saving.');
    expect((screen.getByLabelText('Role name') as HTMLInputElement).value).toBe('Auditor (copy)');
    expect(box('View', 'Products').checked).toBe(true);
    expect(box(/Audit — Export/).checked).toBe(true);
    expect(box(/Audit — View/).checked).toBe(false);
    expect(save().disabled).toBe(false);
    // لا ملاحظة «تسري على N مستخدم» ولا «دور نظامي»: النسخة دورٌ جديد بلا مستخدمين
    expect(screen.queryByText(/Changes apply immediately/)).toBeNull();
    expect(screen.queryByText(/System role/)).toBeNull();
  });

  it('POSTs only name and permissions — no id, slug, system flag or user count — and never PUTs the source', async () => {
    const before = JSON.stringify(source);
    open(null, { seed: seedFor(), source: 'Auditor' });
    await userEvent.click(save());
    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    const [path, init] = api.mock.calls[0] as [string, { method: string; body: Record<string, unknown> }];
    expect(path).toBe('/roles');
    expect(init.method).toBe('POST');
    expect(Object.keys(init.body).sort()).toEqual(['name', 'permissions']);
    expect(init.body).toEqual({ name: 'Auditor (copy)', permissions: ['products.view', 'pos.audit.export'] });
    expect(JSON.stringify(source)).toBe(before);
  });

  it('editing the copy never alters the source role', async () => {
    const before = JSON.stringify(source);
    open(null, { seed: seedFor(), source: 'Auditor' });
    await userEvent.click(box(/Audit — View/));
    await userEvent.click(box('View', 'Products'));
    await userEvent.click(save());
    await waitFor(() => expect(api).toHaveBeenCalled());
    expect(lastBody().permissions).toEqual(['pos.audit.view', 'pos.audit.export']);
    expect(JSON.stringify(source)).toBe(before);
  });

  it('tells a limited actor what was left out, and the left-out permission cannot be re-added', async () => {
    open(null, { seed: seedFor(['products.view']), source: 'Auditor', actor: ['products.view'] });
    expect(screen.getByRole('note').textContent).toContain('1 permission you cannot grant was left out.');
    expect(box('View', 'Products').checked).toBe(true);
    expect(box(/Audit — Export/).checked).toBe(false);
    expect(box(/Audit — Export/).disabled).toBe(true);
  });

  it('an untouched copy is still unsaved work: closing asks first', async () => {
    const onClose = vi.fn();
    open(null, { seed: seedFor(), source: 'Auditor', onClose });
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(await screen.findByText('Discard unsaved changes?')).toBeTruthy();
  });

  it('a copy of an empty selection still requires a permission', async () => {
    open(null, { seed: { name: 'Empty (copy)', permissions: [], skipped: 3 }, source: 'Wide' });
    expect(save().disabled).toBe(true);
    expect(await screen.findByText('Select at least one permission.')).toBeTruthy();
  });
});
