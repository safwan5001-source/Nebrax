'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Trash2 } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { riyalToMinor } from '@/lib/money';

export type ContractItemCategory = 'basic' | 'allowance' | 'gosi' | 'other';

export interface ContractItem {
  id: string;
  category: ContractItemCategory;
  name: string;
  amount: string;
}

export interface Contract {
  id: string;
  employee_id: string;
  type: 'permanent' | 'fixed_term' | 'probation';
  status: 'active' | 'ended' | 'terminated';
  start_date: string;
  end_date?: string | null;
  probation_end_date?: string | null;
  items: ContractItem[];
  basic_salary: string;
  gosi: string;
  other_deductions: string;
  gross: string;
  net: string;
  notes?: string | null;
  created_at?: string | null;
}

interface ItemRow {
  key: string;
  category: ContractItemCategory;
  name: string;
  amount: string;
}

interface FormState {
  type: Contract['type'];
  status: Contract['status'];
  start_date: string;
  end_date: string;
  probation_end_date: string;
  items: ItemRow[];
  notes: string;
}

let rowKeySeq = 0;
function newRowKey(): string {
  rowKeySeq += 1;
  return `row-${rowKeySeq}`;
}

function toRows(items?: ContractItem[]): ItemRow[] {
  if (items && items.length > 0) {
    return items.map((it) => ({ key: newRowKey(), category: it.category, name: it.name, amount: it.amount }));
  }
  return [{ key: newRowKey(), category: 'basic', name: '', amount: '' }];
}

function toForm(c?: Contract | null): FormState {
  return {
    type: c?.type ?? 'permanent',
    status: c?.status ?? 'active',
    start_date: c?.start_date ?? '',
    end_date: c?.end_date ?? '',
    probation_end_date: c?.probation_end_date ?? '',
    items: toRows(c?.items),
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

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const setItem = (key: string, patch: Partial<ItemRow>) => {
    setForm((f) => ({ ...f, items: f.items.map((row) => (row.key === key ? { ...row, ...patch } : row)) }));
  };

  const addItem = () => {
    setForm((f) => ({ ...f, items: [...f.items, { key: newRowKey(), category: 'allowance', name: '', amount: '' }] }));
  };

  const removeItem = (key: string) => {
    setForm((f) => ({ ...f, items: f.items.filter((row) => row.key !== key) }));
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const basicCount = form.items.filter((row) => row.category === 'basic').length;
    if (basicCount !== 1) {
      setError(t('basic_item_required'));
      return;
    }
    setSaving(true);
    setError(null);
    const body = {
      type: form.type,
      status: form.status,
      start_date: form.start_date,
      end_date: form.end_date || null,
      probation_end_date: form.probation_end_date || null,
      items: form.items.map((row) => ({
        category: row.category,
        name: row.name,
        amount: riyalToMinor(row.amount || '0'),
      })),
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
            <Select id="contract_type" value={form.type} onChange={(e) => set('type', e.target.value as Contract['type'])}>
              <option value="permanent">{t('type_permanent')}</option>
              <option value="fixed_term">{t('type_fixed_term')}</option>
              <option value="probation">{t('type_probation')}</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contract_status">{t('status_label')}</Label>
            <Select id="contract_status" value={form.status} onChange={(e) => set('status', e.target.value as Contract['status'])}>
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

        <div className="space-y-2 rounded border border-border p-3">
          <div className="flex items-center justify-between">
            <Label>{t('salary_items')}</Label>
            <Button type="button" variant="outline" size="sm" onClick={addItem}>
              <Plus className="h-3.5 w-3.5" strokeWidth={1.7} />
              {t('add_item')}
            </Button>
          </div>
          <div className="space-y-2">
            {form.items.map((row) => (
              <div key={row.key} className="grid grid-cols-[7rem_1fr_7rem_2rem] items-end gap-2">
                <div className="space-y-1">
                  {row.key === form.items[0].key && <Label className="text-[11px]">{t('item_category')}</Label>}
                  {row.category === 'basic' ? (
                    <div className="flex h-9 items-center rounded border border-border bg-surface-2 px-2 text-xs text-muted">
                      {t('category_basic')}
                    </div>
                  ) : (
                    <Select
                      aria-label={t('item_category')}
                      value={row.category}
                      onChange={(e) => setItem(row.key, { category: e.target.value as ContractItemCategory })}
                    >
                      <option value="allowance">{t('category_allowance')}</option>
                      <option value="gosi">{t('category_gosi')}</option>
                      <option value="other">{t('category_other')}</option>
                    </Select>
                  )}
                </div>
                <div className="space-y-1">
                  {row.key === form.items[0].key && <Label className="text-[11px]">{t('item_name')}</Label>}
                  <Input
                    aria-label={t('item_name')}
                    value={row.name}
                    onChange={(e) => setItem(row.key, { name: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-1">
                  {row.key === form.items[0].key && <Label className="text-[11px]">{t('item_amount')}</Label>}
                  <Input
                    aria-label={t('item_amount')}
                    inputMode="decimal"
                    className="num text-end"
                    value={row.amount}
                    onChange={(e) => setItem(row.key, { amount: e.target.value })}
                    required
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t('remove_item')}
                  disabled={row.category === 'basic'}
                  onClick={() => removeItem(row.key)}
                >
                  <Trash2 className="h-3.5 w-3.5 text-negative" strokeWidth={1.7} />
                </Button>
              </div>
            ))}
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
