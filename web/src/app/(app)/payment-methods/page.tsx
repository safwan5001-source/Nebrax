'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CreditCard, Pencil, Plus, Star, Trash2, WalletCards } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { formatRiyal, isValidRiyal, riyalToMinor } from '@/lib/money';

type SettlementType = 'cash' | 'bank';
type FeeApplication = 'received' | 'paid' | 'both' | 'none';

interface CashBankAccount {
  id: string;
  account_id: string;
  name: string;
  type: SettlementType;
  is_active: boolean;
}

interface Account {
  id: string;
  code: string;
  name: string;
  type: string;
  is_group: boolean;
  is_active: boolean;
}

interface PaymentMethod {
  id: string;
  name: string;
  name_en: string | null;
  settlement_type: SettlementType;
  cash_bank_account_id: string;
  cash_bank_account_name: string | null;
  instructions: string | null;
  available_online: boolean;
  is_active: boolean;
  is_default: boolean;
  fees_enabled: boolean;
  fee_rate_bps: number;
  fee_fixed_amount: string;
  fee_min_amount: string;
  fee_tax_rate: number;
  fee_expense_account_id: string | null;
  fee_expense_account_name: string | null;
  payments_count: number;
}

interface FinanceSettings {
  payment_fee_application: FeeApplication;
}

interface FormState {
  name: string;
  name_en: string;
  settlement_type: SettlementType;
  cash_bank_account_id: string;
  instructions: string;
  available_online: boolean;
  is_active: boolean;
  is_default: boolean;
  fees_enabled: boolean;
  fee_rate_bps: string;
  fee_fixed_amount: string;
  fee_min_amount: string;
  fee_tax_rate: string;
  fee_expense_account_id: string;
}

const EMPTY_FORM: FormState = {
  name: '', name_en: '', settlement_type: 'cash', cash_bank_account_id: '', instructions: '',
  available_online: false, is_active: true, is_default: false, fees_enabled: false,
  fee_rate_bps: '0', fee_fixed_amount: '0.00', fee_min_amount: '0.00', fee_tax_rate: '0', fee_expense_account_id: '',
};

export default function PaymentMethodsPage() {
  const t = useTranslations('paymentMethods');
  const tc = useTranslations('common');
  const { success, error: toastError } = useToast();
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [cashBankAccounts, setCashBankAccounts] = useState<CashBankAccount[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [feeApplication, setFeeApplication] = useState<FeeApplication>('both');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PaymentMethod | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const expenseAccounts = useMemo(
    () => accounts.filter((account) => account.type === 'expense' && !account.is_group && account.is_active),
    [accounts]
  );
  const availableCashBanks = useMemo(
    () => cashBankAccounts.filter((account) => account.is_active && account.type === form.settlement_type),
    [cashBankAccounts, form.settlement_type]
  );

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    Promise.all([
      api<{ data: PaymentMethod[] }>('/payment-methods'),
      api<{ data: CashBankAccount[] }>('/cash-bank-accounts'),
      api<{ data: Account[] }>('/accounts'),
      api<{ data: FinanceSettings }>('/settings/finance'),
    ])
      .then(([paymentMethods, cashBanks, chart, settings]) => {
        setMethods(paymentMethods.data);
        setCashBankAccounts(cashBanks.data);
        setAccounts(chart.data);
        setFeeApplication(settings.data.payment_fee_application);
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : t('loadFailed')))
      .finally(() => setLoading(false));
  }, [t]);

  useEffect(() => load(), [load]);

  function openCreate() {
    const defaultCash = cashBankAccounts.find((account) => account.is_active && account.type === 'cash');
    setEditing(null);
    setForm({ ...EMPTY_FORM, cash_bank_account_id: defaultCash?.id ?? '' });
    setFormError(null);
    setDialogOpen(true);
  }

  function openEdit(method: PaymentMethod) {
    setEditing(method);
    setForm({
      name: method.name,
      name_en: method.name_en ?? '',
      settlement_type: method.settlement_type,
      cash_bank_account_id: method.cash_bank_account_id,
      instructions: method.instructions ?? '',
      available_online: method.available_online,
      is_active: method.is_active,
      is_default: method.is_default,
      fees_enabled: method.fees_enabled,
      fee_rate_bps: String(method.fee_rate_bps),
      fee_fixed_amount: method.fee_fixed_amount,
      fee_min_amount: method.fee_min_amount,
      fee_tax_rate: String(method.fee_tax_rate),
      fee_expense_account_id: method.fee_expense_account_id ?? '',
    });
    setFormError(null);
    setDialogOpen(true);
  }

  function patch<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function changeSettlementType(value: SettlementType) {
    const firstAccount = cashBankAccounts.find((account) => account.is_active && account.type === value);
    setForm((current) => ({ ...current, settlement_type: value, cash_bank_account_id: firstAccount?.id ?? '' }));
  }

  function toPayload(state: FormState) {
    return {
      name: state.name.trim(),
      name_en: state.name_en.trim() || null,
      settlement_type: state.settlement_type,
      cash_bank_account_id: state.cash_bank_account_id,
      instructions: state.instructions.trim() || null,
      available_online: state.available_online,
      is_active: state.is_active,
      is_default: state.is_default,
      fees_enabled: state.fees_enabled,
      fee_rate_bps: state.fees_enabled ? Number.parseInt(state.fee_rate_bps || '0', 10) : 0,
      fee_fixed_amount: state.fees_enabled ? riyalToMinor(state.fee_fixed_amount) : 0,
      fee_min_amount: state.fees_enabled ? riyalToMinor(state.fee_min_amount) : 0,
      fee_tax_rate: state.fees_enabled ? Number.parseInt(state.fee_tax_rate || '0', 10) : 0,
      fee_expense_account_id: state.fees_enabled ? state.fee_expense_account_id || null : null,
    };
  }

  async function save() {
    if (!form.name.trim() || !form.cash_bank_account_id) {
      setFormError(t('requiredFields'));
      return;
    }
    if (form.fees_enabled && (!form.fee_expense_account_id || !isValidRiyal(form.fee_fixed_amount) || !isValidRiyal(form.fee_min_amount))) {
      setFormError(t('invalidFeeSetup'));
      return;
    }
    const payload = toPayload(form);
    if (!Number.isInteger(payload.fee_rate_bps) || payload.fee_rate_bps < 0 || !Number.isInteger(payload.fee_tax_rate) || payload.fee_tax_rate < 0) {
      setFormError(t('invalidFeeSetup'));
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      if (editing) {
        await api(`/payment-methods/${editing.id}`, { method: 'PUT', body: payload });
      } else {
        await api('/payment-methods', { method: 'POST', body: payload });
      }
      success(editing ? t('updated') : t('created'));
      setDialogOpen(false);
      load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(method: PaymentMethod) {
    const state: FormState = {
      name: method.name, name_en: method.name_en ?? '', settlement_type: method.settlement_type,
      cash_bank_account_id: method.cash_bank_account_id, instructions: method.instructions ?? '',
      available_online: method.available_online, is_active: !method.is_active, is_default: method.is_default,
      fees_enabled: method.fees_enabled, fee_rate_bps: String(method.fee_rate_bps),
      fee_fixed_amount: method.fee_fixed_amount, fee_min_amount: method.fee_min_amount,
      fee_tax_rate: String(method.fee_tax_rate), fee_expense_account_id: method.fee_expense_account_id ?? '',
    };
    try {
      await api(`/payment-methods/${method.id}`, { method: 'PUT', body: toPayload(state) });
      success(state.is_active ? t('activated') : t('deactivated'));
      load();
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : t('saveFailed'));
    }
  }

  async function makeDefault(method: PaymentMethod) {
    try {
      await api(`/payment-methods/${method.id}/make-default`, { method: 'POST' });
      success(t('defaultUpdated'));
      load();
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : t('saveFailed'));
    }
  }

  async function remove(method: PaymentMethod) {
    if (!window.confirm(t('confirmDelete', { name: method.name }))) return;
    setDeleting(method.id);
    try {
      await api(`/payment-methods/${method.id}`, { method: 'DELETE' });
      success(t('deleted'));
      load();
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : t('deleteFailed'));
    } finally {
      setDeleting(null);
    }
  }

  async function saveFeeApplication() {
    setSavingPolicy(true);
    try {
      await api('/settings/finance', { method: 'PUT', body: { payment_fee_application: feeApplication } });
      success(t('applicationUpdated'));
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : t('saveFailed'));
    } finally {
      setSavingPolicy(false);
    }
  }

  function feeSummary(method: PaymentMethod) {
    if (!method.fees_enabled) return t('feesDisabled');
    const rate = `${(method.fee_rate_bps / 100).toFixed(2)}%`;
    return t('feeSummary', {
      rate,
      fixed: formatRiyal(method.fee_fixed_amount),
      minimum: formatRiyal(method.fee_min_amount),
      tax: method.fee_tax_rate,
    });
  }

  function actions(method: PaymentMethod) {
    return (
      <div className="flex items-center justify-end gap-1">
        <Button size="icon" variant="ghost" onClick={() => toggleActive(method)} aria-label={method.is_active ? t('deactivate') : t('activate')}>
          <WalletCards className="h-4 w-4" strokeWidth={1.7} />
        </Button>
        <Button size="icon" variant="ghost" disabled={method.is_default || !method.is_active} onClick={() => makeDefault(method)} aria-label={t('makeDefault')}>
          <Star className={method.is_default ? 'h-4 w-4 fill-primary text-primary' : 'h-4 w-4'} strokeWidth={1.7} />
        </Button>
        <Button size="icon" variant="ghost" onClick={() => openEdit(method)} aria-label={t('edit')}>
          <Pencil className="h-4 w-4" strokeWidth={1.7} />
        </Button>
        <Button size="icon" variant="ghost" disabled={deleting === method.id || method.is_default} onClick={() => remove(method)} aria-label={t('delete')}>
          <Trash2 className="h-4 w-4 text-negative" strokeWidth={1.7} />
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">{t('subtitle')}</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" strokeWidth={1.8} />
          {t('new')}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('feeApplicationTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1 space-y-1.5">
              <Label htmlFor="payment-fee-application">{t('feeApplicationLabel')}</Label>
              <Select id="payment-fee-application" value={feeApplication} onChange={(event) => setFeeApplication(event.target.value as FeeApplication)}>
                <option value="both">{t('feeApplicationOptions.both')}</option>
                <option value="received">{t('feeApplicationOptions.received')}</option>
                <option value="paid">{t('feeApplicationOptions.paid')}</option>
                <option value="none">{t('feeApplicationOptions.none')}</option>
              </Select>
            </div>
            <Button onClick={saveFeeApplication} disabled={savingPolicy}>{savingPolicy ? tc('loading') : tc('save')}</Button>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted">{t('feeApplicationHint')}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('listTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2" aria-label={t('loading')}>
              {[0, 1, 2].map((item) => <div key={item} className="h-12 animate-pulse rounded-md bg-muted" />)}
            </div>
          ) : loadError ? (
            <p className="rounded-md bg-negative/10 px-3 py-2 text-sm text-negative">{loadError}</p>
          ) : methods.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-4 py-12 text-center">
              <CreditCard className="mx-auto h-7 w-7 text-muted" strokeWidth={1.6} />
              <p className="mt-3 font-medium text-text">{t('emptyTitle')}</p>
              <p className="mt-1 text-sm text-muted">{t('emptyHint')}</p>
              <Button className="mt-4" variant="outline" onClick={openCreate}><Plus className="h-4 w-4" />{t('new')}</Button>
            </div>
          ) : (
            <>
              <div className="hidden overflow-x-auto lg:block">
                <table className="w-full min-w-[66rem] text-sm">
                  <thead className="border-b border-border text-start text-muted">
                    <tr>
                      <th className="px-3 py-3 font-medium">{t('columns.name')}</th>
                      <th className="px-3 py-3 font-medium">{t('columns.type')}</th>
                      <th className="px-3 py-3 font-medium">{t('columns.destination')}</th>
                      <th className="px-3 py-3 font-medium">{t('columns.fees')}</th>
                      <th className="px-3 py-3 font-medium">{t('columns.status')}</th>
                      <th className="px-3 py-3 text-end font-medium">{t('columns.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {methods.map((method) => (
                      <tr key={method.id} className="border-b border-border/70 last:border-0">
                        <td className="px-3 py-3 font-medium text-text">
                          <div className="flex items-center gap-2"><CreditCard className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.7} />{method.name}{method.is_default && <Star className="h-3.5 w-3.5 shrink-0 fill-primary text-primary" />}</div>
                        </td>
                        <td className="px-3 py-3 text-muted">{t(`settlementTypes.${method.settlement_type}`)}</td>
                        <td className="px-3 py-3 text-muted">{method.cash_bank_account_name ?? '—'}</td>
                        <td className="max-w-xs truncate px-3 py-3 text-muted">{feeSummary(method)}</td>
                        <td className="px-3 py-3"><Badge tone={method.is_active ? 'positive' : 'muted'}>{method.is_active ? t('active') : t('inactive')}</Badge></td>
                        <td className="px-3 py-3">{actions(method)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="space-y-3 lg:hidden">
                {methods.map((method) => (
                  <article key={method.id} className="rounded-md border border-border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0"><h2 className="flex items-center gap-2 font-medium text-text"><CreditCard className="h-4 w-4 shrink-0 text-muted" />{method.name}{method.is_default && <Star className="h-3.5 w-3.5 shrink-0 fill-primary text-primary" />}</h2><p className="mt-1 text-sm text-muted">{method.cash_bank_account_name ?? '—'}</p></div>
                      <Badge tone={method.is_active ? 'positive' : 'muted'}>{method.is_active ? t('active') : t('inactive')}</Badge>
                    </div>
                    <p className="mt-3 border-t border-border pt-3 text-sm text-muted">{feeSummary(method)}</p>
                    <div className="mt-3 border-t border-border pt-3">{actions(method)}</div>
                  </article>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={editing ? t('edit') : t('new')}>
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="payment-method-name">{t('form.name')}</Label><Input id="payment-method-name" value={form.name} onChange={(event) => patch('name', event.target.value)} autoFocus /></div>
            <div className="space-y-1.5"><Label htmlFor="payment-method-name-en">{t('form.nameEn')}</Label><Input id="payment-method-name-en" value={form.name_en} onChange={(event) => patch('name_en', event.target.value)} /></div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="payment-method-type">{t('form.settlementType')}</Label><Select id="payment-method-type" value={form.settlement_type} onChange={(event) => changeSettlementType(event.target.value as SettlementType)}><option value="cash">{t('settlementTypes.cash')}</option><option value="bank">{t('settlementTypes.bank')}</option></Select></div>
            <div className="space-y-1.5"><Label htmlFor="payment-method-cash-bank">{t('form.cashBank')}</Label><Select id="payment-method-cash-bank" value={form.cash_bank_account_id} onChange={(event) => patch('cash_bank_account_id', event.target.value)}><option value="" disabled>{t('form.chooseCashBank')}</option>{availableCashBanks.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</Select></div>
          </div>
          <div className="space-y-1.5"><Label htmlFor="payment-method-instructions">{t('form.instructions')}</Label><Textarea id="payment-method-instructions" value={form.instructions} onChange={(event) => patch('instructions', event.target.value)} /></div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Toggle checked={form.is_active} label={t('form.active')} onChange={(checked) => patch('is_active', checked)} />
            <Toggle checked={form.is_default} label={t('form.default')} disabled={!form.is_active} onChange={(checked) => patch('is_default', checked)} />
            <Toggle checked={form.available_online} label={t('form.availableOnline')} onChange={(checked) => patch('available_online', checked)} />
          </div>
          <div className="rounded-md border border-border p-3">
            <Toggle checked={form.fees_enabled} label={t('form.feesEnabled')} onChange={(checked) => patch('fees_enabled', checked)} />
            {form.fees_enabled && (
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label htmlFor="payment-method-rate">{t('form.rateBps')}</Label><Input id="payment-method-rate" className="num text-end" inputMode="numeric" value={form.fee_rate_bps} onChange={(event) => patch('fee_rate_bps', event.target.value)} /></div><div className="space-y-1.5"><Label htmlFor="payment-method-tax">{t('form.taxRate')}</Label><Input id="payment-method-tax" className="num text-end" inputMode="numeric" value={form.fee_tax_rate} onChange={(event) => patch('fee_tax_rate', event.target.value)} /></div></div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label htmlFor="payment-method-fixed">{t('form.fixed')}</Label><Input id="payment-method-fixed" className="num text-end" inputMode="decimal" value={form.fee_fixed_amount} onChange={(event) => patch('fee_fixed_amount', event.target.value)} /></div><div className="space-y-1.5"><Label htmlFor="payment-method-minimum">{t('form.minimum')}</Label><Input id="payment-method-minimum" className="num text-end" inputMode="decimal" value={form.fee_min_amount} onChange={(event) => patch('fee_min_amount', event.target.value)} /></div></div>
                <div className="space-y-1.5"><Label htmlFor="payment-method-expense">{t('form.expenseAccount')}</Label><Select id="payment-method-expense" value={form.fee_expense_account_id} onChange={(event) => patch('fee_expense_account_id', event.target.value)}><option value="" disabled>{t('form.chooseExpenseAccount')}</option>{expenseAccounts.map((account) => <option key={account.id} value={account.id}>{account.code} — {account.name}</option>)}</Select></div>
                <p className="text-xs leading-relaxed text-muted">{t('form.feeHint')}</p>
              </div>
            )}
          </div>
          {formError && <p className="rounded-md bg-negative/10 px-3 py-2 text-xs text-negative">{formError}</p>}
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setDialogOpen(false)}>{tc('cancel')}</Button><Button disabled={saving} onClick={save}>{saving ? tc('loading') : tc('save')}</Button></div>
        </div>
      </Dialog>
    </div>
  );
}

function Toggle({ checked, disabled = false, label, onChange }: { checked: boolean; disabled?: boolean; label: string; onChange: (checked: boolean) => void }) {
  return <label className="flex items-center gap-2 text-sm text-text"><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50" />{label}</label>;
}
