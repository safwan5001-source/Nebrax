'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { api, ApiError, hasApiStatus } from '@/lib/api';

type Account = { id: string; code: string; name: string; type: string; is_group: boolean };
type Category = { id: string; name: string; is_active: boolean };
type CostCenter = { id: string; code: string; name: string; is_active: boolean };

type Labels = {
  title: string;
  reason: string;
  account: string;
  category: string;
  costCenter: string;
  paymentMethod: string;
  chooseAccount: string;
  noCategory: string;
  noCostCenter: string;
  cash: string;
  bank: string;
  credit: string;
  cancel: string;
  create: string;
  required: string;
  loadOptions: string;
  optionsFailed: string;
  retry: string;
  failed: string;
  stale: string;
  // IMP-DOC-DISTINCT-01: رفض التكرار القابل للتأكيد (مصروف مطابق بالمورّد واليوم والمبلغ).
  repeatTitle: string;
  repeatBody: string;
  repeatConfirm: string;
  repeatSubmit: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  endpoint: string;
  expectedVersion: number;
  onSuccess: () => void;
  labels: Labels;
};

export function ExpenseDraftDialog({ open, onClose, endpoint, expectedVersion, onSuccess, labels }: Props) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [reason, setReason] = useState('');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [costCenterId, setCostCenterId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'bank' | 'credit'>('cash');
  const [loading, setLoading] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // التأكيد لا يظهر إلا بعد رفض خادمي صريح `distinct_confirmable`، ويُمسح بأي تعديل لمدخلات الحوار.
  const [repeatRefused, setRepeatRefused] = useState(false);
  const [repeatConfirmed, setRepeatConfirmed] = useState(false);
  const errorSummary = useRef<HTMLDivElement>(null);

  const loadOptions = useCallback(async () => {
    setLoadingOptions(true);
    setError(null);
    try {
      const [accountResponse, categoryResponse, costCenterResponse] = await Promise.all([
        api<{ data: Account[] }>('/accounts'),
        api<{ data: Category[] }>('/expense-categories'),
        api<{ data: CostCenter[] }>('/cost-centers'),
      ]);
      setAccounts(accountResponse.data.filter((account) => account.type === 'expense' && !account.is_group));
      setCategories(categoryResponse.data.filter((category) => category.is_active));
      setCostCenters(costCenterResponse.data.filter((center) => center.is_active));
    } catch {
      setError(labels.optionsFailed);
    } finally {
      setLoadingOptions(false);
    }
  }, [labels.optionsFailed]);

  useEffect(() => {
    if (open) void loadOptions();
  }, [loadOptions, open]);

  useEffect(() => {
    if (error) errorSummary.current?.focus();
  }, [error]);

  function resetRepeat() {
    setRepeatRefused(false);
    setRepeatConfirmed(false);
  }

  function close() {
    if (loading) return;
    setError(null);
    resetRepeat();
    onClose();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reason.trim() || !accountId) {
      setError(labels.required);
      return;
    }
    if (repeatRefused && !repeatConfirmed) return;

    setLoading(true);
    setError(null);
    try {
      await api(endpoint, {
        method: 'POST',
        body: {
          expected_version: expectedVersion,
          reason: reason.trim(),
          account_id: accountId,
          category_id: categoryId || undefined,
          cost_center_id: costCenterId || undefined,
          payment_method: paymentMethod,
          ...(repeatRefused && repeatConfirmed ? { confirm_distinct_occurrence: true } : {}),
        },
      });
      setReason('');
      setAccountId('');
      setCategoryId('');
      setCostCenterId('');
      setPaymentMethod('cash');
      setRepeatRefused(false);
      setRepeatConfirmed(false);
      onSuccess();
      onClose();
    } catch (exception) {
      const body = exception instanceof ApiError ? (exception.body as { distinct_confirmable?: unknown } | null) : null;
      if (hasApiStatus(exception, 422) && body?.distinct_confirmable === true) {
        // الخادم هو السلطة: تكرار حقيقي قابل للتأكيد؛ يعرض الحوار الخطوة الثانية ولا يرسل التأكيد قبل ذلك.
        setRepeatRefused(true);
        setRepeatConfirmed(false);
        setError(null);
        return;
      }
      setRepeatRefused(false);
      setRepeatConfirmed(false);
      setError(hasApiStatus(exception, 409) ? labels.stale : exception instanceof ApiError ? exception.message : labels.failed);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onClose={close} title={labels.title} className="max-w-xl">
      <form className="space-y-4" onSubmit={submit}>
        <p className="rounded border border-primary/20 bg-primary-soft/40 px-3 py-2 text-sm text-muted">{labels.loadOptions}</p>
        {error && <div id="expense-draft-error" ref={errorSummary} role="alert" tabIndex={-1} className="rounded border border-negative/30 bg-negative/10 px-3 py-2 text-sm text-negative">{error}</div>}
        {loadingOptions ? (
          <p className="py-6 text-sm text-muted">{labels.loadOptions}</p>
        ) : accounts.length === 0 ? (
          <div className="space-y-3 rounded border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
            <p>{labels.optionsFailed}</p>
            <Button type="button" size="sm" variant="outline" onClick={() => void loadOptions()}>{labels.retry}</Button>
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="expense-draft-reason">{labels.reason}</Label>
              <Textarea id="expense-draft-reason" value={reason} onChange={(event) => { setReason(event.target.value); resetRepeat(); }} onBlur={() => { if (!reason.trim()) setError(labels.required); }} required />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="expense-draft-account">{labels.account}</Label>
                <Select id="expense-draft-account" value={accountId} onChange={(event) => { setAccountId(event.target.value); resetRepeat(); }} required aria-describedby={error ? 'expense-draft-error' : undefined}>
                  <option value="" disabled>{labels.chooseAccount}</option>
                  {accounts.map((account) => <option key={account.id} value={account.id}>{account.code} — {account.name}</option>)}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="expense-draft-category">{labels.category}</Label>
                <Select id="expense-draft-category" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
                  <option value="">{labels.noCategory}</option>
                  {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="expense-draft-cost-center">{labels.costCenter}</Label>
                <Select id="expense-draft-cost-center" value={costCenterId} onChange={(event) => setCostCenterId(event.target.value)}>
                  <option value="">{labels.noCostCenter}</option>
                  {costCenters.map((center) => <option key={center.id} value={center.id}>{center.code} — {center.name}</option>)}
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="expense-draft-payment-method">{labels.paymentMethod}</Label>
                <Select id="expense-draft-payment-method" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as 'cash' | 'bank' | 'credit')}>
                  <option value="cash">{labels.cash}</option>
                  <option value="bank">{labels.bank}</option>
                  <option value="credit">{labels.credit}</option>
                </Select>
              </div>
            </div>
          </>
        )}
        {repeatRefused && (
          <div role="group" aria-labelledby="expense-draft-repeat-title" className="space-y-2 rounded border border-warning/30 bg-warning/10 p-3 text-sm">
            <p id="expense-draft-repeat-title" className="font-medium text-warning">{labels.repeatTitle}</p>
            <p className="text-muted">{labels.repeatBody}</p>
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={repeatConfirmed} onChange={(event) => setRepeatConfirmed(event.target.checked)} className="mt-1" />
              <span>{labels.repeatConfirm}</span>
            </label>
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="outline" onClick={close} disabled={loading}>{labels.cancel}</Button>
          <Button type="submit" disabled={loading || loadingOptions || accounts.length === 0 || (repeatRefused && !repeatConfirmed)}>{repeatRefused ? labels.repeatSubmit : labels.create}</Button>
        </div>
      </form>
    </Dialog>
  );
}
