/* @vitest-environment jsdom */
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoleDialog, type Role } from './role-dialog';

/**
 * ACL-ROLE-UI-1 — يثبت أن `RoleDialog` يحتفظ بمفتاح الصلاحية الكنسي كما هو
 * (من الكتالوج) عبر الاختيار والتبديل والحفظ، بصرف النظر عن عدد مقاطعه، وأن
 * تسمية العرض (`permLabel`) دالةٌ مشتقّة بحتة لا تُغذّى مجدداً إلى منطق
 * التخويل. كل الصلاحيات هنا صيغتها الحقيقية من `App\Support\Rbac::PERMISSIONS`
 * (وليست مُخترَعة)، ما عدا `future.module.frobnicate` المستخدَمة حصراً لاختبار
 * أمان العرض الاحتياطي لفعلٍ مستقبلي غير معروف.
 */

const { api, translate } = vi.hoisted(() => {
  const strings: Record<string, string> = {
    role_name: 'Role name',
    select_permissions: 'Permissions',
    owner_immutable: 'Owner role cannot be edited',
    system_role_note: 'System role',
    wildcard_downgrade_note: 'Full access will be downgraded to the selected permissions',
    view_role: 'View role',
    edit_role: 'Edit role',
    add_role: 'Add role',
    close: 'Close',
    cancel: 'Cancel',
    save: 'Save',
    updated: 'Updated',
    created: 'Created',
    saveFailed: 'Save failed',
  };
  // مطابقة لبنية `perm_modules`/`perm_actions` الحقيقية في en.json — مجموعة فرعية تكفي للاختبار.
  const rawMaps: Record<string, Record<string, string>> = {
    perm_modules: { products: 'Products', pos: 'POS', documents: 'Documents' },
    perm_actions: {
      view: 'View',
      manage: 'Manage',
      export: 'Export',
      review: 'Review',
      approve: 'Approve',
      build_draft: 'Build draft',
    },
  };
  const translator = Object.assign(
    (key: string) => strings[key] ?? key,
    { raw: (key: string) => rawMaps[key] ?? {} }
  );
  return { api: vi.fn(), translate: translator };
});

vi.mock('next-intl', () => ({ useTranslations: () => translate }));
vi.mock('@/lib/api', () => ({ api, ApiError: class ApiError extends Error {} }));
vi.mock('@/components/ui/toast', () => {
  const fns = { success: vi.fn(), error: vi.fn() };
  return { useToast: () => fns };
});
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children, title }: { open: boolean; children: React.ReactNode; title: string }) =>
    open ? <div role="dialog" aria-label={title}>{children}</div> : null,
}));
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ComponentProps<'button'>) => <button {...props}>{children}</button>,
}));
vi.mock('@/components/ui/input', () => ({ Input: (props: React.ComponentProps<'input'>) => <input {...props} /> }));
vi.mock('@/components/ui/label', () => ({
  Label: ({ children, ...props }: React.ComponentProps<'label'>) => <label {...props}>{children}</label>,
}));

/**
 * كتالوج اختبار بصلاحيات حقيقية من `Rbac::PERMISSIONS`:
 * - `pos.audit.view` / `pos.audit.review` / `pos.audit.export` — ثلاثيّة تشارك
 *   نفس أول مقطعين؛ العلّة القديمة كانت تختزلها كلّها إلى `pos.audit`.
 * - `pos.variance.approve` — فعلٌ دلاليّ آخر غير view/manage.
 * - `documents.center.build_draft` — فعلٌ متعدد الكلمات (snake_case) بمقطعين وسيطين مختلفين.
 * - `future.module.frobnicate` — فعلٌ **غير موجود** في الكتالوج الحقيقي ولا في `perm_actions`؛
 *   يُستخدم حصراً لإثبات أمان الاحتياط العرضي (Test 6)، وليس زعماً بأن الخادم يقبله.
 */
const catalog = [
  'products.view',
  'products.manage',
  'pos.audit.view',
  'pos.audit.review',
  'pos.audit.export',
  'pos.variance.approve',
  'documents.center.build_draft',
  'future.module.frobnicate',
];

function renderDialog(role: Role | null = null) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(<RoleDialog open onClose={onClose} onSaved={onSaved} role={role} catalog={catalog} />);
  return { onClose, onSaved };
}

async function fillNameAndSave(name = 'Test Role') {
  await userEvent.type(screen.getByLabelText('Role name'), name);
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
}

function lastSubmittedPermissions(): string[] {
  const call = api.mock.calls.at(-1);
  return (call?.[1] as { body: { permissions: string[] } }).body.permissions;
}

describe('RoleDialog — canonical permission integrity (ACL-ROLE-UI-1)', () => {
  beforeEach(() => {
    api.mockReset();
    api.mockResolvedValue({ data: { id: 'role-new' } });
  });
  afterEach(cleanup);

  it('Test 1 — a standard two-segment permission survives selection and submission unchanged', async () => {
    renderDialog();
    const btn = screen.getByRole('button', { name: 'View' }); // products.view — no middle segment
    expect(btn.getAttribute('aria-pressed')).toBe('false');

    await userEvent.click(btn);
    expect(btn.getAttribute('aria-pressed')).toBe('true');

    await fillNameAndSave();
    await waitFor(() => expect(api).toHaveBeenCalled());
    expect(lastSubmittedPermissions()).toEqual(['products.view']);
  });

  it('Test 2 — a multi-segment permission is retained character-for-character through selection and submission', async () => {
    renderDialog();
    const btn = screen.getByRole('button', { name: 'Center — Build draft' }); // documents.center.build_draft
    await userEvent.click(btn);

    await fillNameAndSave();
    await waitFor(() => expect(api).toHaveBeenCalled());
    expect(lastSubmittedPermissions()).toEqual(['documents.center.build_draft']);
  });

  it('Test 3 — collision protection: three permissions sharing "pos.audit" never collapse into one', async () => {
    renderDialog();
    // الثلاثة تظهر كأزرار منفصلة بتسميات متمايزة — لا تصادم بينها.
    const view = screen.getByRole('button', { name: 'Audit — View' });
    const review = screen.getByRole('button', { name: 'Audit — Review' });
    const exportBtn = screen.getByRole('button', { name: 'Audit — Export' });
    expect(view).not.toBe(review);
    expect(review).not.toBe(exportBtn);

    await userEvent.click(view);
    await userEvent.click(exportBtn);
    // review يبقى غير مُختار — إثبات أن التبديل لا يمسّ الأشقاء المشاركين للبادئة.
    expect(review.getAttribute('aria-pressed')).toBe('false');

    await fillNameAndSave();
    await waitFor(() => expect(api).toHaveBeenCalled());
    const sent = lastSubmittedPermissions();
    expect(sent).toEqual(expect.arrayContaining(['pos.audit.view', 'pos.audit.export']));
    expect(sent).not.toContain('pos.audit.review');
    expect(sent).not.toContain('pos.audit'); // القيمة المُقتطَعة قديماً يجب ألا تظهر أبداً
    expect(sent).toHaveLength(2);
  });

  it('Test 4 — a permission whose real action is "export" is never mislabeled "View"', () => {
    renderDialog();
    const btn = screen.getByRole('button', { name: 'Audit — Export' }); // pos.audit.export
    expect(btn.textContent).toBe('Audit — Export');
    expect(btn.textContent).not.toBe('View');
  });

  it('Test 5 — another semantic action ("approve") gets its own presentation, not "View"', () => {
    renderDialog();
    const btn = screen.getByRole('button', { name: 'Variance — Approve' }); // pos.variance.approve
    expect(btn.textContent).toBe('Variance — Approve');
    expect(btn.textContent).not.toBe('View');
  });

  it('Test 6 — an unknown/future action gets a safe readable fallback, never "View", and the canonical key is unaffected', async () => {
    renderDialog();
    // لا ترجمة لـ`frobnicate` في `perm_actions` — تنسيقٌ آمن بديل، وليس "عرض" زوراً.
    const btn = screen.getByRole('button', { name: 'Module — Frobnicate' }); // future.module.frobnicate
    expect(btn.textContent).not.toBe('View');

    await userEvent.click(btn);
    await fillNameAndSave();
    await waitFor(() => expect(api).toHaveBeenCalled());
    // القيمة الكنسية المُرسَلة تبقى الأصل الحرفي من الكتالوج، رغم التسمية الاحتياطية.
    expect(lastSubmittedPermissions()).toEqual(['future.module.frobnicate']);
  });

  it('Test 7 — editing an existing role preserves its currently-selected permissions, including a multi-segment one', () => {
    const role: Role = {
      id: 'role-1',
      slug: 'auditor',
      name: 'Auditor',
      permissions: ['products.view', 'pos.audit.export'],
      is_system: false,
      is_owner: false,
      users_count: 2,
    };
    renderDialog(role);

    expect(screen.getByRole('button', { name: 'View' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Audit — Export' }).getAttribute('aria-pressed')).toBe('true');
    // الصلاحيات غير المختارة تبقى كذلك — التبديل لاحقاً لن يمسّها ضمناً.
    expect(screen.getByRole('button', { name: 'Audit — View' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Manage' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('Test 8 — submission sends exactly the intended canonical permissions, with no reconstruction or truncation', async () => {
    const role: Role = {
      id: 'role-1',
      slug: 'auditor',
      name: 'Auditor',
      permissions: ['products.view', 'pos.audit.export'],
      is_system: false,
      is_owner: false,
      users_count: 2,
    };
    renderDialog(role);

    // يضيف صلاحية ثالثة ويزيل الأولى — الحالة النهائية يجب أن تعكس التبديلين تماماً.
    await userEvent.click(screen.getByRole('button', { name: 'Variance — Approve' }));
    await userEvent.click(screen.getByRole('button', { name: 'View' }));

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/roles/role-1', expect.objectContaining({
      method: 'PUT',
      body: expect.objectContaining({
        permissions: expect.arrayContaining(['pos.audit.export', 'pos.variance.approve']),
      }),
    })));
    const sent = lastSubmittedPermissions();
    expect(sent).not.toContain('products.view');
    expect(sent).toHaveLength(2);
  });
});
