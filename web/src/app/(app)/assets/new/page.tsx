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
interface Partner { id: string; name: string }

export default function NewAssetPage() {
  const t = useTranslations('assets');
  const tc = useTranslations('common');
  const router = useRouter();
  const { success } = useToast();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [name, setName] = useState('');
  const [accountId, setAccountId] = useState('');
  const [partnerId, setPartnerId] = useState('');
  const [cost, setCost] = useState('');
  const [tax, setTax] = useState('15');
  const [salvage, setSalvage] = useState('');
  const [life, setLife] = useState('60');
  const [method, setMethod] = useState('cash');
  const [date, setDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDate(new Date().toISOString().slice(0, 10));
    api<{ data: Account[] }>('/accounts').then((r) => {
      // حسابات الأصول الثابتة 12xx (عدا مجمع الإهلاك 1230)
      const fixed = r.data.filter((a) => a.type === 'asset' && !a.is_group && a.code.startsWith('12') && a.code !== '1230');
      setAccounts(fixed);
      if (fixed[0]) setAccountId((a) => a || fixed[0].id);
    });
    api<{ data: Partner[] }>('/partners').then((r) => setPartners(r.data)).catch(() => {});
  }, []);

  const costMinor = riyalToMinor(cost);
  const taxMinor = useMemo(() => Math.round((costMinor * (Number(tax) || 0)) / 100), [costMinor, tax]);
  const monthly = useMemo(() => {
    const base = costMinor - riyalToMinor(salvage);
    const m = Number(life) || 0;
    return base > 0 && m > 0 ? Math.ceil(base / m) : 0;
  }, [costMinor, salvage, life]);

  async function submit() {
    if (costMinor <= 0) {
      setError(t('need_cost'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api('/assets', {
        method: 'POST',
        body: {
          name,
          account_id: accountId,
          partner_id: method === 'credit' && partnerId ? partnerId : null,
          cost: costMinor,
          tax_rate: Number(tax) || 0,
          salvage_value: riyalToMinor(salvage),
          useful_life_months: Number(life) || 1,
          payment_method: method,
          acquisition_date: date || null,
        },
      });
      success(tc('created'));
      router.push('/assets');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push('/assets')} aria-label={t('back')}>
          <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
        </Button>
        <h1 className="text-xl font-semibold text-text">{t('new_title')}</h1>
      </div>

      <Card className="max-w-3xl">
        <CardHeader><CardTitle>{t('details')}</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="name">{t('name')}</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="account">{t('account')}</Label>
              <Select id="account" value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
                <option value="" disabled>{t('choose_account')}</option>
                {accounts.map((a) => (<option key={a.id} value={a.id}>{a.code} — {a.name}</option>))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cost">{t('cost_label')}</Label>
              <Input id="cost" inputMode="decimal" className="num text-end" placeholder="0.00" value={cost} onChange={(e) => setCost(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tax">{t('tax')}</Label>
              <Input id="tax" type="number" min={0} max={100} dir="ltr" className="num text-end" value={tax} onChange={(e) => setTax(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="salvage">{t('salvage')}</Label>
              <Input id="salvage" inputMode="decimal" className="num text-end" placeholder="0.00" value={salvage} onChange={(e) => setSalvage(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="life">{t('life')}</Label>
              <Input id="life" type="number" min={1} max={600} dir="ltr" className="num text-end" value={life} onChange={(e) => setLife(e.target.value)} />
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
          </div>

          <div className="mt-4 flex flex-col gap-1.5 border-t border-border pt-4 text-sm sm:w-72">
            <div className="flex justify-between text-muted"><span>{t('cost')}</span><span className="num">{formatRiyal(costMinor / 100)}</span></div>
            <div className="flex justify-between text-muted"><span>{t('tax_total')}</span><span className="num">{formatRiyal(taxMinor / 100)}</span></div>
            <div className="flex justify-between border-b border-border pb-1.5"><span className="font-semibold text-text">{t('total')}</span><span className="num font-bold text-text">{formatRiyal((costMinor + taxMinor) / 100)}</span></div>
            <div className="flex justify-between text-muted"><span>{t('monthly_dep')}</span><span className="num text-primary">{formatRiyal(monthly / 100)}</span></div>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        {error && <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}
        <Button disabled={saving || !accountId || !name} onClick={submit}>{t('save')}</Button>
      </div>
    </div>
  );
}
