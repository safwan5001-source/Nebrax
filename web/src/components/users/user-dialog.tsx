'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { currentUser } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { AccessScopeFields, useScopeAvailability, type AccessScope } from './access-scope-fields';

interface EmployeeOption {
  id: string;
  name: string;
  employee_no?: string;
}

interface RoleOption {
  id: string;
  slug: string;
  name: string;
  is_owner: boolean;
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

export function UserDialog({
  open,
  onClose,
  onSaved,
  linkedEmployeeIds = [],
  user,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** موظفون مرتبطون بمستخدمين آخرين بالفعل — يُستبعدون من قائمة الاختيار (ربطٌ واحد لكل موظف).
   *  لا يشمل ربط المستخدم الجاري تعديله نفسه — ذاك يبقى ظاهراً ومختاراً. */
  linkedEmployeeIds?: string[];
  /** مستخدمٌ قائم = تعديل (PUT)؛ غيابه = إضافة (POST). */
  user?: EditableUser | null;
}) {
  const t = useTranslations('users');
  const tc = useTranslations('common');
  const { success } = useToast();
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'staff', employee_id: '', is_active: true });
  const [sendInvitation, setSendInvitation] = useState(false);
  const [scope, setScope] = useState<AccessScope>({ branch_ids: [], warehouse_ids: [] });
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  // كل قائمة مرجعية خلف صلاحيتها المستقلة (D-J). بلا صلاحيتها لا نطلبها (فلا 403 معروف سلفاً)
  // ولا نُرسل حقلها: غياب المفتاح = «بلا تغيير» في الخادم، فلا يُمحى شيءٌ بالسهو.
  const me = currentUser();
  const canListRoles = hasPermission(me?.permissions, me?.role, 'roles.view');
  const canListEmployees = hasPermission(me?.permissions, me?.role, 'hr.view');
  const scopeAvailability = useScopeAvailability();

  // تُحمَّلان عند الفتح فقط — ولمن يملك صلاحية عرضهما.
  useEffect(() => {
    if (!open) return;
    if (canListEmployees) {
      api<{ data: EmployeeOption[] }>('/employees')
        .then((r) => setEmployees(r.data))
        .catch(() => {});
    }
    // دور المالك مستبعَد من الإسناد: منحه حكرٌ على المالك نفسه (`guardOwnerRole` بالخادم) —
    // إلا حين يكون هو دور الحساب المعدَّل نفسه، فيبقى خياراً وحيداً مطابقاً لقيمته.
    if (canListRoles) {
      api<{ data: RoleOption[] }>('/roles')
        .then((r) => setRoles(r.data.filter((role) => !role.is_owner || role.slug === user?.role)))
        .catch(() => {});
    }
  }, [open, canListEmployees, canListRoles, user?.role]);

  // تعبئة النموذج عند فتحه لمستخدمٍ قائم؛ تفريغه عند فتحه للإضافة.
  useEffect(() => {
    if (!open) return;
    if (user) {
      setForm({ name: user.name, email: user.email, password: '', role: user.role, employee_id: user.employee_id ?? '', is_active: user.is_active });
      setScope({ branch_ids: user.branch_ids ?? [], warehouse_ids: user.warehouse_ids ?? [] });
    } else {
      setForm({ name: '', email: '', password: '', role: 'staff', employee_id: '', is_active: true });
      setSendInvitation(false);
      setScope({ branch_ids: [], warehouse_ids: [] });
    }
    setError(null);
  }, [open, user]);

  const availableEmployees = employees.filter((e) => !linkedEmployeeIds.includes(e.id));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const scopeBody: Partial<AccessScope> = {
        ...(scopeAvailability.branches ? { branch_ids: scope.branch_ids } : {}),
        ...(scopeAvailability.warehouses ? { warehouse_ids: scope.warehouse_ids } : {}),
      };
      if (user) {
        const { email: _email, password, role, employee_id, ...rest } = form;
        void _email; // البريد مقفلٌ عند التعديل — لا يُرسَل.
        const body: Record<string, unknown> = {
          ...rest,
          ...(canListRoles ? { role } : {}),
          ...(canListEmployees ? { employee_id: employee_id || null } : {}),
          ...scopeBody,
        };
        if (password) body.password = password;
        await api(`/users/${user.id}`, { method: 'PUT', body });
        success(tc('updated'));
      } else {
        const { employee_id, ...rest } = form;
        await api('/users', { method: 'POST', body: {
          ...rest,
          password: sendInvitation ? undefined : rest.password,
          send_invitation: sendInvitation,
          employee_id: canListEmployees ? employee_id || undefined : undefined,
          ...scopeBody,
        } });
        success(tc('created'));
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={user ? t('edit_title') : t('add')}>
      <form onSubmit={submit} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="uname">{t('name')}</Label>
          <Input id="uname" value={form.name} onChange={(e) => set('name', e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="uemail">{t('email')}</Label>
          <Input id="uemail" type="email" dir="ltr" value={form.email} onChange={(e) => set('email', e.target.value)} required disabled={!!user} />
          {user && <p className="text-xs text-muted">{t('email_locked_hint')}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="upass">{t('password')}</Label>
          <Input id="upass" type="password" dir="ltr" value={form.password} onChange={(e) => set('password', e.target.value)} required={!user && !sendInvitation} />
          {user && <p className="text-xs text-muted">{t('password_hint')}</p>}
        </div>
        {!user && (
          <div className="flex items-center justify-between gap-3 rounded border border-border p-3">
            <div>
              <Label htmlFor="send_invitation">{t('send_invitation')}</Label>
              <p className="text-xs text-muted">{t('send_invitation_hint')}</p>
            </div>
            <Switch id="send_invitation" checked={sendInvitation} onCheckedChange={setSendInvitation} aria-label={t('send_invitation')} />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="urole">{t('role')}</Label>
          {canListRoles ? (
            <Select id="urole" value={form.role} onChange={(e) => set('role', e.target.value)}>
              {roles.map((r) => (
                <option key={r.id} value={r.slug}>
                  {SYSTEM_ROLE_KEYS[r.slug] ? t(SYSTEM_ROLE_KEYS[r.slug]) : r.name}
                </option>
              ))}
            </Select>
          ) : (
            <>
              <Input
                id="urole"
                readOnly
                value={user ? (SYSTEM_ROLE_KEYS[user.role] ? t(SYSTEM_ROLE_KEYS[user.role]) : t('role_custom')) : ''}
                aria-describedby="urole-note"
              />
              <p id="urole-note" className="text-xs text-muted">{user ? t('role_needs_view_edit') : t('role_needs_view_create')}</p>
            </>
          )}
        </div>
        {user && (
          <div className="space-y-1.5">
            <Label htmlFor="ustatus">{t('status_label')}</Label>
            <Select id="ustatus" value={form.is_active ? '1' : '0'} onChange={(e) => set('is_active', e.target.value === '1')}>
              <option value="1">{t('active')}</option>
              <option value="0">{t('inactive')}</option>
            </Select>
          </div>
        )}

        {canListEmployees ? (
          <div className="space-y-1.5">
            <Label htmlFor="uemployee">{t('link_employee')}</Label>
            <Select id="uemployee" value={form.employee_id} onChange={(e) => set('employee_id', e.target.value)}>
              <option value="">{t('no_employee_link')}</option>
              {availableEmployees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.employee_no ? `${emp.employee_no} — ${emp.name}` : emp.name}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted">{t('link_employee_hint')}</p>
          </div>
        ) : null}

        <AccessScopeFields value={scope} onChange={setScope} availability={scopeAvailability} />

        {error && <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="submit" disabled={saving || (!user && !canListRoles)}>
            {t('save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
