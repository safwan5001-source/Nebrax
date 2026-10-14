'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { currentUser } from '@/lib/auth';
import { displayLocale } from '@/lib/formatting';
import { hasPermission } from '@/lib/permissions';
import { coversPermissions, effectivePermissions, resolveRoleLabel, type RoleSummary } from '@/modules/users/model';
import {
  accessSummary,
  adoptActorScope,
  createPayload,
  diffPayload,
  isDirty,
  scopeDraftFromStored,
  scopeIssues,
  type EditorCapabilities,
  type EditorForm,
  type ScopeDraft,
} from '@/modules/users/editor';
import { AccessScopeEditor, useScopeLookups } from './access-scope-editor';
import { useScopeText } from './scope-language';

interface EmployeeOption {
  id: string;
  name: string;
  employee_no?: string;
}

export interface EditableUser {
  id: string;
  name: string;
  email: string;
  role: string;
  is_active: boolean;
  employee_id?: string | null;
  branch_ids?: string[];
  warehouse_ids?: string[];
}

// الأدوار النظامية الأربعة لها ترجمة جاهزة؛ المخصَّصة تُعرض باسمها كما أُدخل.
export const SYSTEM_ROLE_KEYS: Record<string, string> = {
  admin: 'roles.admin',
  accountant: 'roles.accountant',
  staff: 'roles.staff',
};

export interface ActorScope {
  branches: string[];
  warehouses: string[];
}

const SECTION = 'space-y-3 border-t border-border pt-5 first:border-t-0 first:pt-0';

/**
 * محرّر المستخدم (AC-UX-02): لوحة جانبية بدل نافذة صغيرة لأن فيها دوراً ونطاقين وملخّصاً.
 *
 * - **الإسناد المصدري فقط**: يقرأ ويكتب الدور والحالة والفروع والمستودعات؛ لا يحسب صلاحيات.
 * - **الواجهة ليست حدّاً أمنياً**: الخادم يفرض سقف المنح (AC-UX-00A)؛ هنا نعرض ما سيقبله فقط
 *   (أدوار ضمن سقف المشاهد، لا «الكل» لمن نطاقه مقيَّد) ونُظهر رسالة الخادم كما هي عند الرفض.
 * - كل قائمة مرجعية خلف صلاحيتها المستقلة (D-J): بلا صلاحيتها لا طلب ولا حقل مُرسَل
 *   (غياب المفتاح = «بلا تغيير» في الخادم) — والحمولة عند التعديل هي **الفروقات وحدها**.
 */
export function UserEditorSheet({
  open,
  onClose,
  onSaved,
  user,
  linkedEmployeeIds = [],
  actorScope,
  focusAccess = false,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** مستخدمٌ قائم = تعديل (PUT)؛ غيابه = إضافة (POST). */
  user?: EditableUser | null;
  /** موظفون مرتبطون بمستخدمين آخرين — يُستبعدون من الاختيار (ربطٌ واحد لكل موظف). */
  linkedEmployeeIds?: string[];
  /** نطاق المشاهد المخزَّن: فراغ في بُعدٍ = غير مقيَّد فيه. */
  actorScope?: ActorScope;
  /** يفتح عند قسم الوصول (من إجراء «نطاق الوصول» في الصف). */
  focusAccess?: boolean;
}) {
  const t = useTranslations('users');
  const tc = useTranslations('common');
  const locale = displayLocale(useLocale());
  const { success } = useToast();

  const me = currentUser();
  const isSelf = Boolean(user && me?.id && me.id === user.id);
  const can = (permission: string) => hasPermission(me?.permissions, me?.role, permission);
  const caps: EditorCapabilities = {
    role: can('roles.view'),
    employee: can('hr.view'),
    branches: can('branches.view'),
    warehouses: can('products.view'),
  };
  const actorBranchesRestricted = (actorScope?.branches.length ?? 0) > 0;
  const actorWarehousesRestricted = (actorScope?.warehouses.length ?? 0) > 0;

  const makeInitial = (): EditorForm => {
    // فاعلٌ مقيَّد لا يملك «الكل»: الإنشاء يبدأ على «محدَّد» فارغاً ليختار صراحةً.
    const blank = (restricted: boolean): ScopeDraft => (restricted ? { mode: 'selected', ids: [] } : { mode: 'all', ids: [] });
    return user
      ? {
          name: user.name,
          email: user.email,
          password: '',
          sendInvitation: false,
          role: user.role,
          employeeId: user.employee_id ?? '',
          isActive: user.is_active,
          branches: scopeDraftFromStored(user.branch_ids),
          warehouses: scopeDraftFromStored(user.warehouse_ids),
        }
      : {
          name: '',
          email: '',
          password: '',
          sendInvitation: false,
          role: 'staff',
          employeeId: '',
          isActive: true,
          branches: blank(actorBranchesRestricted),
          warehouses: blank(actorWarehousesRestricted),
        };
  };

  const [initial, setInitial] = useState<EditorForm>(makeInitial);
  const [form, setForm] = useState<EditorForm>(initial);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [roles, setRoles] = useState<RoleSummary[] | null>(null);
  const [roleOptions, setRoleOptions] = useState<RoleSummary[] | null>(null);
  const lookups = useScopeLookups(open, caps);
  const scopeText = useScopeText();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  // محتوى اللوحة يُركَّب في بوابة بعد العرض الأول، فيُمرَّر إلى قسم الوصول لحظة ظهوره لا قبلها.
  const accessRef = (node: HTMLElement | null) => {
    if (node && focusAccess) node.scrollIntoView?.({ block: 'start' });
  };

  const set = <K extends keyof EditorForm>(key: K, value: EditorForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    if (!open) return;
    if (caps.employee) {
      api<{ data: EmployeeOption[] }>('/employees').then((r) => setEmployees(r.data)).catch(() => {});
    }
    if (caps.role) {
      api<{ data: RoleSummary[] }>('/roles')
        .then((r) => {
          setRoles(r.data);
          // الخيارات = ما يقبله الخادم فعلاً (سقف المنح AC-UX-00A): المالك محجوز، ودورٌ صلاحياته
          // خارج صلاحيات المشاهد يُرفض بـ403 فلا يُعرض. دور الحساب الحالي يبقى دائماً (تغييرٌ بلا أثر).
          const mine = effectivePermissions(me?.permissions, me?.role);
          const grantable = r.data.filter(
            (role) => role.slug === user?.role || (!role.is_owner && coversPermissions(mine, role.permissions ?? [])),
          );
          setRoleOptions(grantable);
          // الإنشاء: الافتراضي «staff» قد لا يكون ضمن السقف ⇒ نختار أول خيار صالح بدل عرضٍ يخالف الحالة.
          if (!user && grantable.length > 0 && !grantable.some((role) => role.slug === 'staff')) {
            setInitial((f) => ({ ...f, role: grantable[0].slug }));
            setForm((f) => ({ ...f, role: grantable[0].slug }));
          }
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- تُحمَّل عند الفتح فقط
  }, [open]);


  // نطاق الفاعل يصل غير متزامنٍ: بُعد الإنشاء غير الملموس يُعاد بذره بحسب القيد المعروف الآن (انظر `adoptActorScope`).
  useEffect(() => {
    if (user) return;
    const restricted = { branches: actorBranchesRestricted, warehouses: actorWarehousesRestricted };
    const next = adoptActorScope(initial, form, restricted);
    setInitial((i) => ({ ...i, ...next.initial }));
    setForm((f) => ({ ...f, ...next.current }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- يتفاعل مع وصول القيد فقط
  }, [actorBranchesRestricted, actorWarehousesRestricted]);

  const dirty = isDirty(initial, form);

  const requestClose = () => {
    if (saving) return;
    if (dirty) setConfirmingDiscard(true);
    else onClose();
  };

  const availableEmployees = employees.filter((e) => !linkedEmployeeIds.includes(e.id));

  // الإنشاء: «الكل» يُحذف مفتاحه فيكون الخادم هو المرجع؛ «محدَّد» الفارغ ممنوع دائماً. التعديل: لا نتحقق إلا مما سيُرسَل فعلاً.
  const issues = scopeIssues(
    initial,
    form,
    caps,
    { branches: actorBranchesRestricted, warehouses: actorWarehousesRestricted },
    Boolean(user),
  );
  const branchIssue = issues.branches;
  const warehouseIssue = issues.warehouses;

  const createBlocked = !user && !caps.role; // الدور إلزامي عند الإنشاء ولا يُختار بلا roles.view.
  const nothingToSave = Boolean(user) && !dirty;
  const submitBlocked = saving || createBlocked || nothingToSave || Boolean(branchIssue) || Boolean(warehouseIssue);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitBlocked) return;
    setSaving(true);
    setError(null);
    try {
      if (user) {
        await api(`/users/${user.id}`, { method: 'PUT', body: diffPayload(initial, form, caps) });
        success(tc('updated'));
      } else {
        await api('/users', { method: 'POST', body: createPayload(form, caps) });
        success(tc('created'));
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError && err.message ? err.message : tc('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  const selectedRole = roleOptions?.find((role) => role.slug === form.role);
  const roleName = (() => {
    const label = resolveRoleLabel(form.role, roles ?? roleOptions, Object.fromEntries(Object.entries(SYSTEM_ROLE_KEYS).map(([slug, key]) => [slug, t(key)])));
    return label.kind === 'name' ? label.name : t('role_custom');
  })();
  const summary = accessSummary(form);
  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) requestClose(); }}>
      <SheetContent closeLabel={t('editor_close')} className="sm:max-w-xl">
        <header className="shrink-0 border-b border-border px-5 pb-3 pe-14 pt-4">
          <SheetTitle className="text-base font-semibold text-text">{user ? `${t('edit_title')} — ${user.name}` : t('add')}</SheetTitle>
          <SheetDescription className="mt-1 text-xs leading-relaxed text-muted">
            {user ? t('editor_description_edit') : t('editor_description_create')}
          </SheetDescription>
        </header>

        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate={false}>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
            <section className={SECTION} aria-labelledby="ue-identity">
              <h3 id="ue-identity" className="text-sm font-semibold text-text">{t('section_identity')}</h3>
              <div className="space-y-1.5">
                <Label htmlFor="uname">{t('name')}</Label>
                <Input id="uname" value={form.name} onChange={(e) => set('name', e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="uemail">{t('email')}</Label>
                <Input id="uemail" type="email" dir="ltr" value={form.email} onChange={(e) => set('email', e.target.value)} required disabled={!!user} />
                {user ? <p className="text-xs text-muted">{t('email_locked_hint')}</p> : null}
              </div>
              {!user ? (
                <div className="flex items-center justify-between gap-3 rounded border border-border p-3">
                  <div>
                    <Label htmlFor="send_invitation">{t('send_invitation')}</Label>
                    <p className="text-xs text-muted">{t('send_invitation_hint')}</p>
                  </div>
                  <Switch id="send_invitation" checked={form.sendInvitation} onCheckedChange={(v) => set('sendInvitation', v)} aria-label={t('send_invitation')} />
                </div>
              ) : null}
              {!(form.sendInvitation && !user) ? (
                <div className="space-y-1.5">
                  <Label htmlFor="upass">{t('password')}</Label>
                  <Input id="upass" type="password" dir="ltr" autoComplete="new-password" value={form.password} onChange={(e) => set('password', e.target.value)} required={!user && !form.sendInvitation} />
                  {user ? <p className="text-xs text-muted">{t('password_hint')}</p> : null}
                </div>
              ) : null}
              {caps.employee ? (
                <div className="space-y-1.5">
                  <Label htmlFor="uemployee">{t('link_employee')}</Label>
                  <Select id="uemployee" value={form.employeeId} onChange={(e) => set('employeeId', e.target.value)}>
                    <option value="">{t('no_employee_link')}</option>
                    {availableEmployees.map((emp) => (
                      <option key={emp.id} value={emp.id}>{emp.employee_no ? `${emp.employee_no} — ${emp.name}` : emp.name}</option>
                    ))}
                  </Select>
                  <p className="text-xs text-muted">{t('link_employee_hint')}</p>
                </div>
              ) : null}
            </section>

            <section className={SECTION} aria-labelledby="ue-role">
              <h3 id="ue-role" className="text-sm font-semibold text-text">{t('section_role_status')}</h3>
              <div className="space-y-1.5">
                <Label htmlFor="urole">{t('role')}</Label>
                {caps.role ? (
                  <>
                    <Select id="urole" value={form.role} onChange={(e) => set('role', e.target.value)}>
                      {(roleOptions ?? []).map((r) => (
                        <option key={r.id} value={r.slug}>{SYSTEM_ROLE_KEYS[r.slug] ? t(SYSTEM_ROLE_KEYS[r.slug]) : r.name}</option>
                      ))}
                    </Select>
                    {selectedRole?.permissions ? (
                      <p className="text-xs text-muted">
                        {selectedRole.permissions.includes('*')
                          ? t('role_summary_full')
                          : t('role_summary_count', { n: selectedRole.permissions.length, count: selectedRole.permissions.length.toLocaleString(locale) })}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <>
                    <Input id="urole" readOnly value={user ? roleName : ''} aria-describedby="urole-note" />
                    <p id="urole-note" className="text-xs text-muted">{user ? t('role_needs_view_edit') : t('role_needs_view_create')}</p>
                  </>
                )}
              </div>
              {user ? (
                <div className="space-y-1.5">
                  <Label htmlFor="ustatus">{t('status_label')}</Label>
                  <Select
                    id="ustatus"
                    value={form.isActive ? '1' : '0'}
                    onChange={(e) => set('isActive', e.target.value === '1')}
                    disabled={isSelf}
                    aria-describedby="ustatus-note"
                  >
                    <option value="1">{t('active')}</option>
                    <option value="0">{t('inactive')}</option>
                  </Select>
                  {/* التعطيل الذاتي يقفل صاحبه (وقد يقفل المؤسسة إن كان المالك الوحيد): لا يمرّ من هنا — عرضٌ لا أمان. */}
                  <p id="ustatus-note" className="text-xs text-muted">
                    {isSelf ? t('reason_self_deactivate') : form.isActive ? t('status_active_hint') : t('status_inactive_hint')}
                  </p>
                </div>
              ) : null}
            </section>

            <section className={SECTION} aria-labelledby="ue-access" ref={accessRef}>
              <h3 id="ue-access" className="text-sm font-semibold text-text">{t('section_access')}</h3>
              <p className="text-xs leading-relaxed text-muted">{t('access_intro')}</p>
              <AccessScopeEditor
                value={{ branches: form.branches, warehouses: form.warehouses }}
                onChange={(next) => setForm((f) => ({ ...f, ...next }))}
                caps={caps}
                restricted={{ branches: actorBranchesRestricted, warehouses: actorWarehousesRestricted }}
                issues={issues}
                branchOptions={lookups.branches}
                warehouseOptions={lookups.warehouses}
              />
            </section>

            <section className={SECTION} aria-labelledby="ue-summary">
              <h3 id="ue-summary" className="text-sm font-semibold text-text">{t('section_summary')}</h3>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded border border-border bg-background p-3 text-sm" aria-live="polite">
                <dt className="text-muted">{t('role')}</dt>
                <dd className="text-text">{roleName}</dd>
                <dt className="text-muted">{t('status_label')}</dt>
                <dd className="text-text">{form.isActive ? t('active') : t('inactive')}</dd>
                <dt className="text-muted">{t('scope_branches')}</dt>
                <dd className="text-text">{scopeText(summary.branches, 'branches')}</dd>
                <dt className="text-muted">{t('scope_warehouses')}</dt>
                <dd className="text-text">{scopeText(summary.warehouses, 'warehouses')}</dd>
              </dl>
              <p className="text-xs text-muted">{t('summary_note')}</p>
            </section>
          </div>

          <footer className="shrink-0 border-t border-border bg-surface px-5 py-3">
            {error ? <p role="alert" className="mb-2 rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p> : null}
            {confirmingDiscard ? (
              <div role="alert" className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-text">{t('discard_title')}</p>
                  <p className="text-xs text-muted">{t('discard_body')}</p>
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" autoFocus onClick={() => setConfirmingDiscard(false)}>{t('keep_editing')}</Button>
                  <Button type="button" variant="danger" onClick={onClose}>{t('discard')}</Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-end gap-2">
                {nothingToSave ? <span className="me-auto text-xs text-muted">{t('no_changes')}</span> : null}
                <Button type="button" variant="outline" onClick={requestClose}>{t('cancel')}</Button>
                <Button type="submit" disabled={submitBlocked}>{saving ? t('saving') : t('save')}</Button>
              </div>
            )}
          </footer>
        </form>
      </SheetContent>
    </Sheet>
  );
}
