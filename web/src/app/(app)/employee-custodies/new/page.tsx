'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NumberPreviewField } from '@/components/ui/number-preview-field';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { useNumberPreview } from '@/lib/use-number-preview';
import { type CustodyCashBankAccount, type CustodyEmployee, type EmployeeCustody, type EmployeeCustodyMethod } from '@/lib/employee-custody';
import { riyalToMinor } from '@/lib/money';

export default function EmployeeCustodyFormPage() {
  const t = useTranslations('employeeCustodies');
  const tc = useTranslations('common');
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get('edit');
  const { success } = useToast();
  const [employees, setEmployees] = useState<CustodyEmployee[]>([]);
  const [cashAccounts, setCashAccounts] = useState<CustodyCashBankAccount[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [cashAccountId, setCashAccountId] = useState('');
  const [method, setMethod] = useState<EmployeeCustodyMethod>('cash');
  const [amount, setAmount] = useState('');
  const [custodyDate, setCustodyDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [number, setNumber] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { number: suggestedNumber, loading: loadingNumber } = useNumberPreview('employee_custody', { date: custodyDate, enabled: !editId });

  const activeEmployees = useMemo(() => employees.filter((employee) => employee.is_active), [employees]);
  const availableAccounts = useMemo(
    () => cashAccounts.filter((account) => account.is_active && account.type === method),
    [cashAccounts, method],
  );

  const loadOptions = useCallback(async () => {
    const [employeesResult, accountsResult] = await Promise.allSettled([
      api<{ data: CustodyEmployee[] }>('/employees'),
      api<{ data: CustodyCashBankAccount[] }>('/cash-bank-accounts'),
    ]);
    setEmployees(employeesResult.status === 'fulfilled' ? employeesResult.value.data : []);
    setCashAccounts(accountsResult.status === 'fulfilled' ? accountsResult.value.data : []);
  }, []);

  useEffect(() => {
    setCustodyDate(new Date().toISOString().slice(0, 10));
    loadOptions().catch(() => undefined);
  }, [loadOptions]);

  useEffect(() => {
    if (!editId) return;
    api<{ data: EmployeeCustody }>(`/employee-custodies/${editId}`)
      .then((response) => {
        const custody = response.data;
        if (custody.status !== 'draft') {
          setError(t('editDraftOnly'));
          return;
        }
        setNumber(custody.number);
        setEmployeeId(custody.employee_id);
        setCashAccountId(custody.cash_account_id);
        setMethod(custody.method);
        setAmount(String(custody.amount));
        setCustodyDate(custody.custody_date);
        setDueDate(custody.due_date ?? '');
        setNotes(custody.notes ?? '');
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : t('loadFailed')));
  }, [editId, t]);

  useEffect(() => {
    if (cashAccountId && availableAccounts.some((account) => account.account_id === cashAccountId)) return;
    const preferred = availableAccounts.find((account) => account.is_main) ?? availableAccounts[0];
    setCashAccountId(preferred?.account_id ?? '');
  }, [availableAccounts, cashAccountId]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const minor = riyalToMinor(amount);
    if (!employeeId || !cashAccountId || minor <= 0) {
      setError(tc('saveFailed'));
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await api<{ data: { id: string } }>(editId ? `/employee-custodies/${editId}` : '/employee-custodies', {
        method: editId ? 'PUT' : 'POST',
        body: {
          employee_id: employeeId,
          cash_account_id: cashAccountId,
          method,
          custody_date: custodyDate,
          due_date: dueDate || undefined,
          amount: minor,
          notes: notes.trim() || undefined,
        },
      });
      success(editId ? t('draftUpdated') : t('draftSaved'));
      router.push(`/employee-custodies/${response.data.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.push('/employee-custodies')} aria-label={t('back')}>
            <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
          </Button>
          <div>
            <h1 className="text-xl font-semibold text-text">{editId ? t('editTitle', { number: number ?? '' }) : t('newTitle')}</h1>
            <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
          </div>
        </div>
        <span className="rounded-md bg-muted px-3 py-1.5 text-sm text-muted">{t('draft')}</span>
      </div>

      <form onSubmit={submit} className="space-y-5">
        <Card>
          <CardHeader><CardTitle>{t('detailTitle')}</CardTitle></CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2">
            {!editId && <NumberPreviewField id="employee-custody-number" label={t('number')} number={suggestedNumber} loading={loadingNumber} />}
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="employee">{t('employee')}</Label>
              <Select id="employee" value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} required>
                <option value="" disabled>{t('chooseEmployee')}</option>
                {activeEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name} — {employee.employee_no}</option>)}
              </Select>
              {activeEmployees.length === 0 && <p className="text-xs text-muted">{t('noEmployees')}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="custody-date">{t('date')}</Label>
              <Input id="custody-date" type="date" value={custodyDate} onChange={(event) => setCustodyDate(event.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="due-date">{t('dueDate')}</Label>
              <Input id="due-date" type="date" value={dueDate} min={custodyDate || undefined} onChange={(event) => setDueDate(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="amount">{t('amount')}</Label>
              <Input id="amount" inputMode="decimal" className="num text-end" value={amount} onChange={(event) => setAmount(event.target.value)} required />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t('financialDetails')}</CardTitle></CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="custody-account">{t('custodyAccount')}</Label>
              <Input id="custody-account" value={t('defaultCustodyAccount')} readOnly aria-readonly="true" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="method">{t('method')}</Label>
              <Select id="method" value={method} onChange={(event) => setMethod(event.target.value as EmployeeCustodyMethod)}>
                <option value="cash">{t('cash')}</option>
                <option value="bank">{t('bank')}</option>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="cash-account">{t('cashAccount')}</Label>
              <Select id="cash-account" value={cashAccountId} onChange={(event) => setCashAccountId(event.target.value)} disabled={availableAccounts.length === 0} required>
                <option value="" disabled>{t('chooseCashAccount')}</option>
                {availableAccounts.map((account) => <option key={account.id} value={account.account_id}>{[account.account_code, account.name].filter(Boolean).join(' — ')}</option>)}
              </Select>
              {availableAccounts.length === 0 && <p className="text-xs text-muted">{t('noCashAccounts')}</p>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t('notes')}</CardTitle></CardHeader>
          <CardContent>
            <Textarea id="notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={t('notesPlaceholder')} rows={4} />
          </CardContent>
        </Card>

        {error && <p className="rounded-md bg-negative/10 px-4 py-3 text-sm text-negative">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => router.push('/employee-custodies')}>{t('back')}</Button>
          <Button type="submit" disabled={saving || !employeeId || !cashAccountId || activeEmployees.length === 0 || availableAccounts.length === 0}>{t('saveDraft')}</Button>
        </div>
      </form>
    </div>
  );
}
