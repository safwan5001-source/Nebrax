'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { riyalToMinor } from '@/lib/money';
import type { Shift } from './shift-dialog';

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
  job_title?: string | null;
  department?: string | null;
  employment_type?: string | null;
  manager_id?: string | null;
  shift_id?: string | null;
  basic_salary: string;     // ريال (نص)
  allowances: string;       // ريال (نص)
  gosi: string;             // ريال (نص)
  other_deductions: string; // ريال (نص)
  is_active: boolean;
}

const EMPTY_EMPLOYEE: Employee = {
  id: '', name: '', first_name: '', middle_name: '', last_name: '',
  national_id: '', nationality: '', residency_expiry_date: '',
  phone: '', personal_email: '', job_title: '', department: '', employment_type: '',
  manager_id: '', shift_id: '',
  basic_salary: '', allowances: '', gosi: '', other_deductions: '', is_active: true,
};

const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract', 'temporary'] as const;

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
  const tc = useTranslations('common');
  const { success } = useToast();
  const [form, setForm] = useState<Employee>(employee ?? EMPTY_EMPLOYEE);
  const [colleagues, setColleagues] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (k: keyof Employee, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  // تُحمَّلان عند الفتح فقط — اختيار المدير المباشر والوردية الافتراضية.
  useEffect(() => {
    if (!open) return;
    api<{ data: Employee[] }>('/employees').then((r) => setColleagues(r.data)).catch(() => {});
    api<{ data: Shift[] }>('/shifts').then((r) => setShifts(r.data)).catch(() => {});
  }, [open]);

  const managerOptions = colleagues.filter((c) => c.id !== employee?.id);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const body = {
      name: form.name,
      first_name: form.first_name || null,
      middle_name: form.middle_name || null,
      last_name: form.last_name || null,
      national_id: form.national_id || null,
      nationality: form.nationality || null,
      residency_expiry_date: form.residency_expiry_date || null,
      phone: form.phone || null,
      personal_email: form.personal_email || null,
      job_title: form.job_title || null,
      department: form.department || null,
      employment_type: form.employment_type || null,
      manager_id: form.manager_id || null,
      shift_id: form.shift_id || null,
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
      } else {
        await api('/employees', { method: 'POST', body });
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
    <Dialog open={open} onClose={onClose} title={employee?.id ? t('edit_employee') : t('add_employee')}>
      <form onSubmit={submit} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="name">{t('emp_name')}</Label>
          <Input id="name" value={form.name} onChange={(e) => set('name', e.target.value)} required />
        </div>
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
            <Label htmlFor="job_title">{t('job_title')}</Label>
            <Input id="job_title" value={form.job_title ?? ''} onChange={(e) => set('job_title', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="department">{t('department')}</Label>
            <Input id="department" value={form.department ?? ''} onChange={(e) => set('department', e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="employment_type">{t('employment_type')}</Label>
            <Select id="employment_type" value={form.employment_type ?? ''} onChange={(e) => set('employment_type', e.target.value)}>
              <option value="">—</option>
              {EMPLOYMENT_TYPES.map((v) => (
                <option key={v} value={v}>{t(`employment_type_${v}`)}</option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="national_id">{t('national_id')}</Label>
            <Input id="national_id" dir="ltr" value={form.national_id ?? ''} onChange={(e) => set('national_id', e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="nationality">{t('nationality')}</Label>
            <Input id="nationality" value={form.nationality ?? ''} onChange={(e) => set('nationality', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="residency_expiry_date">{t('residency_expiry_date')}</Label>
            <Input id="residency_expiry_date" type="date" dir="ltr" value={form.residency_expiry_date ?? ''} onChange={(e) => set('residency_expiry_date', e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="phone">{t('phone')}</Label>
            <Input id="phone" dir="ltr" className="num" value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="personal_email">{t('personal_email')}</Label>
            <Input id="personal_email" type="email" dir="ltr" value={form.personal_email ?? ''} onChange={(e) => set('personal_email', e.target.value)} />
          </div>
        </div>
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
