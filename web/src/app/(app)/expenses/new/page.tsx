'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { formatRiyal, riyalToMinor } from '@/lib/money';

interface Account {
  id: string;
  code: string;
  name: string;
  type: string;
  is_group: boolean;
}
interface Partner { id: string; name: string; type?: string }

export default function NewExpensePage() {
  const t = useTranslations('expenses');
  const tc = useTranslations('common');
  const router = useRouter();
  const { success } = useToast();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [accountId, setAccountId] = useState('');
  const [partnerId, setPartnerId] = useState('');
  const [amount, setAmount] = useState('');
  const [tax, setTax] = useState('15');
  const [method, setMethod] = useState('cash');
  const [date, setDate] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDate(new Date().toISOString().slice(0, 10));
    api<{ data: Account[] }>('/accounts').then((r) => {
      const expenseAccounts = r.data.filter((a) => a.type === 'expense' && !a.is_group);
      setAccounts(expenseAccounts);
      if (expenseAccounts[0]) setAccountId((a) => a || expenseAccounts[0].id);
    });
    api<{ data: Partner[] }>('/partners').then((r) => setPartners(r.data)).catch(() => {});
  }, []);

  const amountMinor = riyalToMinor(amount);
  const taxMinor = useMemo(
    () => Math.round((amountMinor * (Number(tax) || 0)) / 100),
    [amountMinor, tax],
  );

  async function submit() {
    if (amountMinor <= 0) {
      setError(t('need_amount'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api('/expenses', {
        method: 'POST',
        body: {
          account_id: accountId,
          partner_id: method === 'credit' && partnerId ? partnerId : null,
          amount: amountMinor,
          tax_rate: Number(tax) || 0,
          payment_method: method,
          expense_date: date || null,
          description: description || null,
        },
      });
      success(tc('created'));
      router.push('/expenses');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push('/expenses')} aria-label={t('back')}>
          <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
        </Button>
        <h1 className="text-xl font-semibold text-text">{t('new_title')}</h1>
      </div>

      <Card className="max-w-3xl">
        <CardHeader><CardTitle>{t('details')}</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="account">{t('account')}</Label>
              <Select id="account" value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
                <option value="" disabled>{t('choose_account')}</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="amount">{t('amount')}</Label>
              <Input id="amount" inputMode="decimal" className="num text-end" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tax">{t('tax')}</Label>
              <Input id="tax" type="number" min={0} max={100} className="num text-end" dir="ltr" value={tax} onChange={(e) => setTax(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="method">{t('payment_method')}</Label>
              <Select id="method" value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="cash">{t('method.cash')}</option>
                <option value="bank">{t('method.bank')}</option>
                <option value="credit">{t('method.credit')}</option>
              </Select>
            </div>
            {method === 'credit' && (
              <div className="space-y-1.5">
                <Label htmlFor="vendor">{t('vendor')}</Label>
                <Select id="vendor" value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
                  <option value="">{t('none')}</option>
                  {partners.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="date">{t('date')}</Label>
              <Input id="date" type="date" dir="ltr" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="desc">{t('description')}</Label>
              <Input id="desc" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-1.5 border-t border-border pt-4 text-sm sm:w-64">
            <div className="flex justify-between text-muted"><span>{t('subtotal')}</span><span className="num">{formatRiyal(amountMinor / 100)}</span></div>
            <div className="flex justify-between text-muted"><span>{t('tax_total')}</span><span className="num">{formatRiyal(taxMinor / 100)}</span></div>
            <div className="flex justify-between border-t border-border pt-1.5"><span className="font-semibold text-text">{t('total')}</span><span className="num text-lg font-bold text-text">{formatRiyal((amountMinor + taxMinor) / 100)}</span></div>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        {error && <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}
        <Button disabled={saving || !accountId} onClick={submit}>{t('save')}</Button>
      </div>
    </div>
  );
}
