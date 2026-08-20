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

export interface Contract {
  id: string;
  employee_id: string;
  type: 'permanent' | 'fixed_term' | 'probation';
  status: 'active' | 'ended' | 'terminated';
  start_date: string;
  end_date?: string | null;
  probation_end_date?: string | null;
  basic_salary: string;
  allowances: string;
  gosi: string;
  other_deductions: string;
  gross: string;
  net: string;
  notes?: string | null;
  created_at?: string | null;
}

interface FormState {
  type: Contract['type'];
  status: Contract['status'];
  start_date: string;
  end_date: string;
  probation_end_date: string;
  basic_salary: string;
  allowances: string;
  gosi: string;
  other_deductions: string;
  notes: string;
}

function toForm(c?: Contract | null): FormState {
  return {
    type: c?.type ?? 'permanent',
    status: c?.status ?? 'active',
    start_date: c?.start_date ?? '',
    end_date: c?.end_date ?? '',
    probation_end_date: c?.probation_end_date ?? '',
    basic_salary: c?.basic_salary ?? '',
    allowances: c?.allowances ?? '',
    gosi: c?.gosi ?? '',
    other_deductions: c?.other_deductions ?? '',
    notes: c?.notes ?? '',
  };
}

export function ContractDialog({
  open, onClose, onSaved, employeeId, contract,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  employeeId: string;
  contract?: Contract | null;
}) {
  const t = useTranslations('hr');
  const tc = useTranslations('common');
  const { success, error: toastError } = useToast();
  const [form, setForm] = useState<FormState>(toForm(contract));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(toForm(contract));
    setError(null);
  }, [open, contract]);

  const set = (k: keyof FormState, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const body = {
      type: form.type,
      status: form.status,
      start_date: form.start_date,
      end_date: form.end_date || null,
      probation_end_date: form.probation_end_date || null,
      basic_salary: riyalToMinor(form.basic_salary || '0'),
      allowances: riyalToMinor(form.allowances || '0'),
      gosi: riyalToMinor(form.gosi || '0'),
      other_deductions: riyalToMinor(form.other_deductions || '0'),
      notes: form.notes || null,
    };
    try {
      if (contract?.id) {
        await api(`/employees/${employeeId}/contracts/${contract.id}`, { method: 'PUT', body });
      } else {
        await api(`/employees/${employeeId}/contracts`, { method: 'POST', body });
      }
      success(contract?.id ? tc('updated') : tc('created'));
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={contract?.id ? t('edit_contract') : t('add_contract')}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="contract_type">{t('contract_type')}</Label>
            <Select id="contract_type" value={form.type} onChange={(e) => set('type', e.target.value)}>
              <option value="permanent">{t('type_permanent')}</option>
              <option value="fixed_term">{t('type_fixed_term')}</option>
              <option value="probation">{t('type_probation')}</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contract_status">{t('status_label')}</Label>
            <Select id="contract_status" value={form.status} onChange={(e) => set('status', e.target.value)}>
              <option value="active">{t('status_active')}</option>
              <option value="ended">{t('status_ended')}</option>
              <option value="terminated">{t('status_terminated')}</option>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="start_date">{t('start_date')}</Label>
            <Input id="start_date" type="date" dir="ltr" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="end_date">{t('end_date')}</Label>
            <Input id="end_date" type="date" dir="ltr" value={form.end_date} onChange={(e) => set('end_date', e.target.value)} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="probation_end_date">{t('probation_end_date')}</Label>
          <Input id="probation_end_date" type="date" dir="ltr" value={form.probation_end_date} onChange={(e) => set('probation_end_date', e.target.value)} />
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
          <Label htmlFor="contract_notes">{t('notes')}</Label>
          <textarea
            id="contract_notes"
            rows={3}
            className="min-h-20 w-full resize-y rounded border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            value={form.notes}
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
