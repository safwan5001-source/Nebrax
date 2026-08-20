'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ImagePlus, Trash2 } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { api, ApiError, fetchImageUrl } from '@/lib/api';
import { riyalToMinor } from '@/lib/money';
import { AccessScopeFields, type AccessScope } from '@/components/users/access-scope-fields';
import { SYSTEM_ROLE_KEYS } from '@/components/users/user-dialog';
import type { Shift } from './shift-dialog';

interface RoleOption {
  id: string;
  slug: string;
  name: string;
  is_owner: boolean;
}

export interface LinkedUser {
  id: string;
  name: string;
  email: string;
  role: string;
  is_active: boolean;
  branch_ids?: string[];
  warehouse_ids?: string[];
}

export interface Employee {
  id: string;
  employee_no?: string;
  name: string;
  first_name?: string | null;
  middle_name?: string | null;
  last_name?: string | null;
  national_id?: string | null;
  nationality?: string | null;
  residency_expiry_date?: string | null;
  phone?: string | null;
  personal_email?: string | null;
  job_title_id?: string | null;
  job_title?: { id: string; name: string } | null;
  department_id?: string | null;
  department?: { id: string; name: string } | null;
  job_level_id?: string | null;
  job_level?: { id: string; name: string } | null;
  employment_type_id?: string | null;
  employment_type?: { id: string; name: string } | null;
  manager_id?: string | null;
  shift_id?: string | null;
  has_photo?: boolean;
  current_address?: string | null;
  current_city?: string | null;
  current_building_no?: string | null;
  current_street?: string | null;
  current_district?: string | null;
  current_postal_code?: string | null;
  current_country?: string | null;
  permanent_address?: string | null;
  permanent_city?: string | null;
  permanent_building_no?: string | null;
  permanent_street?: string | null;
  permanent_district?: string | null;
  permanent_postal_code?: string | null;
  permanent_country?: string | null;
  basic_salary: string;     // ريال (نص)
  allowances: string;       // ريال (نص)
  gosi: string;             // ريال (نص)
  other_deductions: string; // ريال (نص)
  is_active: boolean;
  notes?: string | null;
}

const EMPTY_EMPLOYEE: Employee = {
  id: '', name: '', first_name: '', middle_name: '', last_name: '',
  national_id: '', nationality: '', residency_expiry_date: '',
  phone: '', personal_email: '',
  job_title_id: '', department_id: '', job_level_id: '', employment_type_id: '',
  manager_id: '', shift_id: '', has_photo: false,
  current_address: '', current_city: '', current_building_no: '', current_street: '',
  current_district: '', current_postal_code: '', current_country: '',
  permanent_address: '', permanent_city: '', permanent_building_no: '', permanent_street: '',
  permanent_district: '', permanent_postal_code: '', permanent_country: '',
  basic_salary: '', allowances: '', gosi: '', other_deductions: '', is_active: true, notes: '',
};

const ADDRESS_FIELDS = ['address', 'city', 'building_no', 'street', 'district', 'postal_code', 'country'] as const;

interface OrgOption {
  id: string;
  name: string;
  is_active: boolean;
}

/** نمط عنوانٍ وطنيٍّ واحد — يتكرّر بادئتين (حالي/دائم) بلا نسخ الحقول يدوياً. */
function AddressGroup({
  prefix, title, form, set, t,
}: {
  prefix: 'current' | 'permanent';
  title: string;
  form: Employee;
  set: (k: keyof Employee, v: string) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <fieldset className="space-y-3 rounded border border-border p-3">
      <legend className="px-1 text-xs font-medium text-muted">{title}</legend>
      <div className="space-y-1.5">
        <Label htmlFor={`${prefix}_address`}>{t('address')}</Label>
        <Input
          id={`${prefix}_address`}
          value={(form[`${prefix}_address` as keyof Employee] as string) ?? ''}
          onChange={(e) => set(`${prefix}_address` as keyof Employee, e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        {ADDRESS_FIELDS.slice(1).map((field) => {
          const key = `${prefix}_${field}` as keyof Employee;
          return (
            <div key={key} className="space-y-1.5">
              <Label htmlFor={key}>{t(field)}</Label>
              <Input id={key} value={(form[key] as string) ?? ''} onChange={(e) => set(key, e.target.value)} />
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

export function EmployeeDialog({
  open,
  onClose,
  onSaved,
  employee,
  linkedUser,
  initialAllowAccess = false,
  canManageUsers = false,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  employee?: Employee | null;
  /** المستخدم المرتبط بهذا الموظف إن وُجد — لعرض/تعديل معلومات دخوله ضمن النموذج نفسه. */
  linkedUser?: LinkedUser | null;
  /** فتحٌ عبر مسار "إضافة مستخدم" — يُفعِّل مفتاح "السماح بالدخول" ابتداءً. */
  initialAllowAccess?: boolean;
  /** إظهار قسم الدخول أصلاً — يقتصر على مالك/مدير يديران المستخدمين والأدوار. */
  canManageUsers?: boolean;
}) {
  const t = useTranslations('hr');
  const tu = useTranslations('users');
  const tc = useTranslations('common');
  const { success, error: toastError } = useToast();
  const [form, setForm] = useState<Employee>(employee ?? EMPTY_EMPLOYEE);
  const [colleagues, setColleagues] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [jobTitles, setJobTitles] = useState<OrgOption[]>([]);
  const [departments, setDepartments] = useState<OrgOption[]>([]);
  const [jobLevels, setJobLevels] = useState<OrgOption[]>([]);
  const [employmentTypes, setEmploymentTypes] = useState<OrgOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const [allowAccess, setAllowAccess] = useState(initialAllowAccess);
  const [loginForm, setLoginForm] = useState({ email: '', password: '', role: 'staff' });
  const [scope, setScope] = useState<AccessScope>({ branch_ids: [], warehouse_ids: [] });
  const [roles, setRoles] = useState<RoleOption[]>([]);

  const set = (k: keyof Employee, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));
  const setLogin = (k: keyof typeof loginForm, v: string) => setLoginForm((f) => ({ ...f, [k]: v }));

  // تُحمَّلان عند الفتح فقط — اختيار المدير المباشر والوردية الافتراضية.
  useEffect(() => {
    if (!open) return;
    api<{ data: Employee[] }>('/employees').then((r) => setColleagues(r.data)).catch(() => {});
    api<{ data: Shift[] }>('/shifts').then((r) => setShifts(r.data)).catch(() => {});
  }, [open]);

  // الهيكل التنظيمي — قوائم اختيار المسمى/القسم/المستوى الوظيفي ونوع التوظيف.
  useEffect(() => {
    if (!open) return;
    api<{ data: OrgOption[] }>('/job-titles').then((r) => setJobTitles(r.data)).catch(() => {});
    api<{ data: OrgOption[] }>('/departments').then((r) => setDepartments(r.data)).catch(() => {});
    api<{ data: OrgOption[] }>('/job-levels').then((r) => setJobLevels(r.data)).catch(() => {});
    api<{ data: OrgOption[] }>('/employment-types').then((r) => setEmploymentTypes(r.data)).catch(() => {});
  }, [open]);

  // الأدوار — تُحمَّل فقط حين يظهر قسم الدخول (مالك/مدير).
  useEffect(() => {
    if (!open || !canManageUsers) return;
    api<{ data: RoleOption[] }>('/roles')
      .then((r) => setRoles(r.data.filter((role) => !role.is_owner)))
      .catch(() => {});
  }, [open, canManageUsers]);

  // إعادة تعبئة النموذج عند فتح الحوار لموظفٍ مختلف (أو للإضافة) — بما فيه قسم الدخول.
  useEffect(() => {
    if (!open) return;
    setForm(employee ?? EMPTY_EMPLOYEE);
    setAllowAccess(!!linkedUser || initialAllowAccess);
    setLoginForm({ email: linkedUser?.email ?? '', password: '', role: linkedUser?.role ?? 'staff' });
    setScope({ branch_ids: linkedUser?.branch_ids ?? [], warehouse_ids: linkedUser?.warehouse_ids ?? [] });
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, employee?.id, linkedUser?.id]);

  // معاينة الصورة الحالية — رابط كائنٍ محلّي يُفكّ عند تبديل الموظف أو إغلاق الحوار.
  useEffect(() => {
    if (!open || !employee?.id || !employee.has_photo) {
      setPhotoUrl(null);
      return;
    }
    let cancelled = false;
    fetchImageUrl(`/employees/${employee.id}/photo`).then((url) => {
      if (!cancelled) setPhotoUrl(url);
    });
    return () => {
      cancelled = true;
      setPhotoUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, [open, employee?.id, employee?.has_photo]);

  async function uploadPhoto(file: File) {
    if (!employee?.id) return;
    setPhotoBusy(true);
    try {
      const res = await api<{ data: Employee }>(`/employees/${employee.id}/photo`, {
        method: 'POST',
        body: (() => { const f = new FormData(); f.append('photo', file); return f; })(),
      });
      setPhotoUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
      fetchImageUrl(`/employees/${employee.id}/photo`).then(setPhotoUrl);
      setForm((f) => ({ ...f, has_photo: res.data.has_photo }));
      success(tc('updated'));
      onSaved();
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setPhotoBusy(false);
    }
  }

  async function removePhoto() {
    if (!employee?.id) return;
    setPhotoBusy(true);
    try {
      await api(`/employees/${employee.id}/photo`, { method: 'DELETE' });
      setPhotoUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
      setForm((f) => ({ ...f, has_photo: false }));
      success(tc('deleted'));
      onSaved();
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setPhotoBusy(false);
    }
  }

  const managerOptions = colleagues.filter((c) => c.id !== employee?.id);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const addressBody = Object.fromEntries(
      (['current', 'permanent'] as const).flatMap((prefix) =>
        ADDRESS_FIELDS.map((field) => {
          const key = `${prefix}_${field}` as keyof Employee;
          return [key, (form[key] as string) || null];
        })
      )
    );
    const body = {
      ...addressBody,
      name: form.name,
      first_name: form.first_name || null,
      middle_name: form.middle_name || null,
      last_name: form.last_name || null,
      national_id: form.national_id || null,
      nationality: form.nationality || null,
      residency_expiry_date: form.residency_expiry_date || null,
      phone: form.phone || null,
      personal_email: form.personal_email || null,
      job_title_id: form.job_title_id || null,
      department_id: form.department_id || null,
      job_level_id: form.job_level_id || null,
      employment_type_id: form.employment_type_id || null,
      manager_id: form.manager_id || null,
      shift_id: form.shift_id || null,
      basic_salary: riyalToMinor(form.basic_salary), // ريال → هللات
      allowances: riyalToMinor(form.allowances || '0'),
      gosi: riyalToMinor(form.gosi || '0'),
      other_deductions: riyalToMinor(form.other_deductions || '0'),
      is_active: form.is_active,
      notes: form.notes || null,
    };
    try {
      let savedEmployeeId = employee?.id ?? null;
      if (employee?.id) {
        await api(`/employees/${employee.id}`, { method: 'PUT', body });
      } else {
        const res = await api<{ data: Employee }>('/employees', { method: 'POST', body });
        savedEmployeeId = res.data.id;
      }
      success(employee?.id ? tc('updated') : tc('created'));

      // خطوة الدخول تالية ومستقلة: فشلها لا يُلغي حفظ الموظف الذي تمّ فعلاً.
      if (canManageUsers) {
        try {
          if (allowAccess) {
            if (linkedUser) {
              const userBody: Record<string, unknown> = { name: form.name, role: loginForm.role, ...scope };
              if (loginForm.password) userBody.password = loginForm.password;
              await api(`/users/${linkedUser.id}`, { method: 'PUT', body: userBody });
            } else {
              await api('/users', {
                method: 'POST',
                body: {
                  name: form.name,
                  email: loginForm.email,
                  password: loginForm.password,
                  role: loginForm.role,
                  employee_id: savedEmployeeId,
                  ...scope,
                },
              });
            }
          } else if (linkedUser) {
            await api(`/users/${linkedUser.id}`, { method: 'DELETE' });
          }
        } catch (accessErr) {
          toastError(accessErr instanceof ApiError ? accessErr.message : tu('access_update_failed'));
        }
      }

      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  const dialogTitle = employee?.id
    ? t('edit_employee')
    : initialAllowAccess
      ? tu('add')
      : t('add_employee');

  return (
    <Dialog open={open} onClose={onClose} title={dialogTitle}>
      <form onSubmit={submit} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="name">{t('emp_name')}</Label>
          <Input id="name" value={form.name} onChange={(e) => set('name', e.target.value)} required />
        </div>

        <div className="space-y-1.5">
          <Label>{t('photo')}</Label>
          {employee?.id ? (
            <div className="flex items-center gap-3">
              <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border border-border bg-background">
                {photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- صورة مرفوعة (blob:) لا تخضع لتحسين next/image
                  <img src={photoUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <ImagePlus className="h-6 w-6 text-muted" strokeWidth={1.5} />
                )}
              </div>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => { const file = e.target.files?.[0]; if (file) uploadPhoto(file); e.target.value = ''; }}
              />
              <Button type="button" variant="outline" size="sm" disabled={photoBusy} onClick={() => photoInputRef.current?.click()}>
                {t('choose_photo')}
              </Button>
              {form.has_photo && (
                <Button type="button" variant="ghost" size="icon" aria-label={t('remove_photo')} disabled={photoBusy} onClick={removePhoto}>
                  <Trash2 className="h-4 w-4 text-negative" strokeWidth={1.7} />
                </Button>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted">{t('save_first_for_photo')}</p>
          )}
        </div>

        {canManageUsers && (
          <fieldset className="space-y-3 rounded border border-border p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label htmlFor="allow_access">{t('allow_access')}</Label>
                <p className="text-xs text-muted">{t('allow_access_hint')}</p>
              </div>
              <Switch id="allow_access" checked={allowAccess} onCheckedChange={setAllowAccess} aria-label={t('allow_access')} />
            </div>

            {allowAccess && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="login_email">{tu('email')}</Label>
                  <Input
                    id="login_email"
                    type="email"
                    dir="ltr"
                    value={linkedUser ? linkedUser.email : loginForm.email}
                    onChange={(e) => setLogin('email', e.target.value)}
                    required
                    disabled={!!linkedUser}
                  />
                  {linkedUser && <p className="text-xs text-muted">{tu('email_locked_hint')}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="login_password">{tu('password')}</Label>
                  <Input
                    id="login_password"
                    type="password"
                    dir="ltr"
                    value={loginForm.password}
                    onChange={(e) => setLogin('password', e.target.value)}
                    required={!linkedUser}
                  />
                  {linkedUser && <p className="text-xs text-muted">{tu('password_hint')}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="login_role">{tu('role')}</Label>
                  <Select id="login_role" value={loginForm.role} onChange={(e) => setLogin('role', e.target.value)}>
                    {roles.map((r) => (
                      <option key={r.id} value={r.slug}>
                        {SYSTEM_ROLE_KEYS[r.slug] ? tu(SYSTEM_ROLE_KEYS[r.slug]) : r.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <AccessScopeFields value={scope} onChange={setScope} />
              </div>
            )}
          </fieldset>
        )}

        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="first_name">{t('first_name')}</Label>
            <Input id="first_name" value={form.first_name ?? ''} onChange={(e) => set('first_name', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="middle_name">{t('middle_name')}</Label>
            <Input id="middle_name" value={form.middle_name ?? ''} onChange={(e) => set('middle_name', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="last_name">{t('last_name')}</Label>
            <Input id="last_name" value={form.last_name ?? ''} onChange={(e) => set('last_name', e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="job_title_id">{t('job_title')}</Label>
            <Select id="job_title_id" value={form.job_title_id ?? ''} onChange={(e) => set('job_title_id', e.target.value)}>
              <option value="">—</option>
              {jobTitles.map((jt) => (<option key={jt.id} value={jt.id}>{jt.name}</option>))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="department_id">{t('department')}</Label>
            <Select id="department_id" value={form.department_id ?? ''} onChange={(e) => set('department_id', e.target.value)}>
              <option value="">—</option>
              {departments.map((d) => (<option key={d.id} value={d.id}>{d.name}</option>))}
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="job_level_id">{t('job_level')}</Label>
            <Select id="job_level_id" value={form.job_level_id ?? ''} onChange={(e) => set('job_level_id', e.target.value)}>
              <option value="">—</option>
              {jobLevels.map((jl) => (<option key={jl.id} value={jl.id}>{jl.name}</option>))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="employment_type_id">{t('employment_type')}</Label>
            <Select id="employment_type_id" value={form.employment_type_id ?? ''} onChange={(e) => set('employment_type_id', e.target.value)}>
              <option value="">—</option>
              {employmentTypes.map((et) => (<option key={et.id} value={et.id}>{et.name}</option>))}
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="national_id">{t('national_id')}</Label>
            <Input id="national_id" dir="ltr" value={form.national_id ?? ''} onChange={(e) => set('national_id', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nationality">{t('nationality')}</Label>
            <Input id="nationality" value={form.nationality ?? ''} onChange={(e) => set('nationality', e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="residency_expiry_date">{t('residency_expiry_date')}</Label>
            <Input id="residency_expiry_date" type="date" dir="ltr" value={form.residency_expiry_date ?? ''} onChange={(e) => set('residency_expiry_date', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone">{t('phone')}</Label>
            <Input id="phone" dir="ltr" className="num" value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="personal_email">{t('personal_email')}</Label>
          <Input id="personal_email" type="email" dir="ltr" value={form.personal_email ?? ''} onChange={(e) => set('personal_email', e.target.value)} />
        </div>

        <AddressGroup prefix="current" title={t('current_address_title')} form={form} set={set} t={t} />
        <AddressGroup prefix="permanent" title={t('permanent_address_title')} form={form} set={set} t={t} />

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="manager_id">{t('manager')}</Label>
            <Select id="manager_id" value={form.manager_id ?? ''} onChange={(e) => set('manager_id', e.target.value)}>
              <option value="">{t('no_manager')}</option>
              {managerOptions.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="shift_id">{t('default_shift')}</Label>
            <Select id="shift_id" value={form.shift_id ?? ''} onChange={(e) => set('shift_id', e.target.value)}>
              <option value="">{t('no_default_shift')}</option>
              {shifts.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="basic_salary">{t('basic_salary')}</Label>
            <Input id="basic_salary" inputMode="decimal" className="num text-end" value={form.basic_salary} onChange={(e) => set('basic_salary', e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="allowances">{t('allowances')}</Label>
            <Input id="allowances" inputMode="decimal" className="num text-end" value={form.allowances} onChange={(e) => set('allowances', e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="gosi">{t('gosi')}</Label>
            <Input id="gosi" inputMode="decimal" className="num text-end" value={form.gosi} onChange={(e) => set('gosi', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="other_deductions">{t('other_deductions')}</Label>
            <Input id="other_deductions" inputMode="decimal" className="num text-end" value={form.other_deductions} onChange={(e) => set('other_deductions', e.target.value)} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="is_active">{t('status_label')}</Label>
          <Select id="is_active" value={form.is_active ? '1' : '0'} onChange={(e) => set('is_active', e.target.value === '1')}>
            <option value="1">{t('active')}</option>
            <option value="0">{t('inactive')}</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="notes">{t('notes')}</Label>
          <textarea
            id="notes"
            rows={3}
            className="min-h-20 w-full resize-y rounded border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            value={form.notes ?? ''}
            onChange={(e) => set('notes', e.target.value)}
          />
        </div>

        {error && <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="submit" disabled={saving}>
            {t('save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
