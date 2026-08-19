'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { currentUser } from '@/lib/auth';
import { riyalToMinor } from '@/lib/money';

export interface Employee {
  id: string;
  employee_no?: string;
  name: string;
  national_id?: string | null;
  job_title?: string | null;
  basic_salary: string;     // ريال (نص)
  allowances: string;       // ريال (نص)
  gosi: string;             // ريال (نص)
  other_deductions: string; // ريال (نص)
  is_active: boolean;
}

export function EmployeeDialog({
  open,
  onClose,
  onSaved,
  employee,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  employee?: Employee | null;
}) {
  const t = useTranslations('hr');
  const tu = useTranslations('users');
  const tc = useTranslations('common');
  const { success, error: toastError } = useToast();
  const [form, setForm] = useState<Employee>(
    employee ?? { id: '', name: '', national_id: '', job_title: '', basic_salary: '', allowances: '', gosi: '', other_deductions: '', is_active: true }
  );
  // ═══ منح الدخول (المستخدم موظفٌ يدخل النظام: User ⊃ Employee) ═══
  // قسمٌ اختياري يظهر عند **الإنشاء** فقط، ولمن يملك إدارة المستخدمين
  // (المالك/المدير). تفعيله ينشئ — بعد الموظف — حساب دخولٍ مرتبطاً به عبر
  // `users.employee_id`. تحرير دخول موظفٍ قائم مسارُه إدارة المستخدمين.
  const canGrantLogin = !employee?.id && (() => {
    const role = currentUser()?.role;
    return role === 'owner' || role === 'admin';
  })();
  const [grantLogin, setGrantLogin] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginRole, setLoginRole] = useState('staff');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (k: keyof Employee, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const body = {
      name: form.name,
      national_id: form.national_id || null,
      job_title: form.job_title || null,
      basic_salary: riyalToMinor(form.basic_salary), // ريال → هللات
      allowances: riyalToMinor(form.allowances || '0'),
      gosi: riyalToMinor(form.gosi || '0'),
      other_deductions: riyalToMinor(form.other_deductions || '0'),
      is_active: form.is_active,
    };
    try {
      if (employee?.id) {
        await api(`/employees/${employee.id}`, { method: 'PUT', body });
        success(tc('updated'));
        onSaved();
        onClose();
        return;
      }

      // إنشاء: الموظف أولاً (مصدر الحقيقة)، ثم — اختيارياً — حساب دخوله.
      const created = await api<{ data: { id: string } }>('/employees', { method: 'POST', body });

      if (canGrantLogin && grantLogin) {
        try {
          await api('/users', {
            method: 'POST',
            body: {
              name: form.name,
              email: loginEmail,
              password: loginPassword,
              role: loginRole,
              employee_id: created.data.id, // الربط: هذا المستخدم = هذا الموظف
              is_active: true,
            },
          });
        } catch (userErr) {
          // الموظف أُنشئ (حالةٌ صحيحة قائمة بذاتها — الموظف بلا دخول هو الغالب).
          // نُبلغ بفشل الدخول ونُبقي الموظف؛ يُمنح الدخول لاحقاً من إدارة المستخدمين.
          onSaved();
          onClose();
          toastError(t('login_failed_saved'), userErr instanceof ApiError ? userErr.message : undefined);
          return;
        }
      }

      success(tc('created'));
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={employee?.id ? t('edit_employee') : t('add_employee')}>
      <form onSubmit={submit} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="name">{t('emp_name')}</Label>
          <Input id="name" value={form.name} onChange={(e) => set('name', e.target.value)} required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="job_title">{t('job_title')}</Label>
            <Input id="job_title" value={form.job_title ?? ''} onChange={(e) => set('job_title', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="national_id">{t('national_id')}</Label>
            <Input id="national_id" dir="ltr" value={form.national_id ?? ''} onChange={(e) => set('national_id', e.target.value)} />
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

        {/* ═══ منح الدخول للنظام (اختياري، عند الإنشاء ولمن يديرون المستخدمين) ═══ */}
        {canGrantLogin && (
          <div className="rounded border border-border bg-background p-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-text">
              <input
                type="checkbox"
                className="h-4 w-4 shrink-0 accent-primary"
                checked={grantLogin}
                onChange={(e) => setGrantLogin(e.target.checked)}
              />
              {t('grant_login')}
            </label>
            <p className="mt-1 text-[11px] leading-5 text-muted">{t('grant_login_hint')}</p>

            {grantLogin && (
              <div className="mt-3 space-y-3 border-t border-border pt-3">
                <div className="space-y-1.5">
                  <Label htmlFor="login_email">{tu('email')}</Label>
                  <Input id="login_email" type="email" dir="ltr" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} required={grantLogin} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="login_password">{tu('password')}</Label>
                    <Input id="login_password" type="password" dir="ltr" minLength={8} value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} required={grantLogin} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="login_role">{tu('role')}</Label>
                    <Select id="login_role" value={loginRole} onChange={(e) => setLoginRole(e.target.value)}>
                      <option value="admin">{tu('roles.admin')}</option>
                      <option value="accountant">{tu('roles.accountant')}</option>
                      <option value="staff">{tu('roles.staff')}</option>
                    </Select>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

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
