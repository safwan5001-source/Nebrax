'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, User, Wallet, MapPin } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { riyalToMinor } from '@/lib/money';

export default function NewPartnerPage() {
  const t = useTranslations('partners');
  const tc = useTranslations('common');
  const router = useRouter();
  const { success } = useToast();

  const [form, setForm] = useState({
    name: '', name_en: '', type: 'customer', phone: '', mobile: '', address: '', city: '',
    vat_number: '', cr_number: '', code: '', email: '', is_active: true,
    classification: '',
    building_no: '', street: '', district: '', postal_code: '', country: '',
    opening_balance: '', opening_balance_date: '',
    credit_limit: '', credit_period: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    if (!form.name.trim()) { setError(tc('saveFailed')); return; }
    setSaving(true);
    setError(null);
    try {
      await api('/partners', {
        method: 'POST',
        body: {
          name: form.name,
          name_en: form.name_en || null,
          type: form.type,
          phone: form.phone || null,
          mobile: form.mobile || null,
          address: form.address || null,
          city: form.city || null,
          building_no: form.building_no || null,
          street: form.street || null,
          district: form.district || null,
          postal_code: form.postal_code || null,
          country: form.country || null,
          vat_number: form.vat_number || null,
          cr_number: form.cr_number || null,
          code: form.code || null,
          email: form.email || null,
          classification: form.classification || null,
          opening_balance: form.opening_balance !== '' ? riyalToMinor(form.opening_balance) : null,
          opening_balance_date: form.opening_balance_date || null,
          credit_limit: form.credit_limit !== '' ? riyalToMinor(form.credit_limit) : null,
          credit_period: form.credit_period !== '' ? Number(form.credit_period) : null,
          is_active: form.is_active,
        },
      });
      success(tc('created'));
      router.push('/partners');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* شريط الإجراءات */}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push('/partners')} aria-label={t('back')}>
          <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
        </Button>
        <h1 className="text-xl font-semibold text-text">{t('new_title')}</h1>
        <div className="ms-auto flex items-center gap-2">
          <Button variant="ghost" onClick={() => router.push('/partners')}>{t('cancel')}</Button>
          <Button disabled={saving || !form.name.trim()} onClick={submit}>{t('save')}</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* بيانات العميل */}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><User className="h-4 w-4 text-primary" strokeWidth={1.8} />{t('customer_details')}</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="name">{t('name')} <span className="text-negative">*</span></Label>
                <Input id="name" value={form.name} onChange={(e) => set('name', e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="name_en">{t('name_en')}</Label>
                <Input id="name_en" dir="ltr" value={form.name_en} onChange={(e) => set('name_en', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="type">{t('type')}</Label>
                <Select id="type" value={form.type} onChange={(e) => set('type', e.target.value)}>
                  <option value="customer">{t('customer')}</option>
                  <option value="supplier">{t('supplier')}</option>
                  <option value="both">{t('both')}</option>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone">{t('phone')}</Label>
                <Input id="phone" dir="ltr" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mobile">{t('mobile')}</Label>
                <Input id="mobile" dir="ltr" value={form.mobile} onChange={(e) => set('mobile', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="city">{t('city')}</Label>
                <Input id="city" value={form.city} onChange={(e) => set('city', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="vat">{t('vat_number')}</Label>
                <Input id="vat" dir="ltr" className="num" maxLength={15} placeholder={t('vat_hint')} value={form.vat_number} onChange={(e) => set('vat_number', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cr">{t('cr_number')}</Label>
                <Input id="cr" dir="ltr" className="num" value={form.cr_number} onChange={(e) => set('cr_number', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="classification">{t('classification')}</Label>
                <Input id="classification" list="partner-classifications" placeholder={t('classification_hint')} value={form.classification} onChange={(e) => set('classification', e.target.value)} />
                <datalist id="partner-classifications">
                  <option value="VIP" />
                  <option value={t('cls_wholesale')} />
                  <option value={t('cls_retail')} />
                  <option value={t('cls_government')} />
                </datalist>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* بيانات الحساب */}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Wallet className="h-4 w-4 text-primary" strokeWidth={1.8} />{t('account_details')}</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="code">{t('code')}</Label>
                <Input id="code" dir="ltr" className="num" value={form.code} onChange={(e) => set('code', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">{t('email')}</Label>
                <Input id="email" type="email" dir="ltr" value={form.email} onChange={(e) => set('email', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ob">{t('opening_balance')}</Label>
                <Input id="ob" inputMode="decimal" className="num text-end" placeholder="0.00" value={form.opening_balance} onChange={(e) => set('opening_balance', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="obd">{t('opening_balance_date')}</Label>
                <Input id="obd" type="date" dir="ltr" value={form.opening_balance_date} onChange={(e) => set('opening_balance_date', e.target.value)} />
              </div>
              <p className="text-[11px] text-muted sm:col-span-2">{t('opening_balance_hint')}</p>
              <div className="space-y-1.5">
                <Label htmlFor="climit">{t('credit_limit')}</Label>
                <Input id="climit" inputMode="decimal" className="num text-end" placeholder="0.00" value={form.credit_limit} onChange={(e) => set('credit_limit', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cperiod">{t('credit_period')}</Label>
                <Input id="cperiod" inputMode="numeric" className="num text-end" placeholder="0" value={form.credit_period} onChange={(e) => set('credit_period', e.target.value)} />
              </div>
              <p className="text-[11px] text-muted sm:col-span-2">{t('credit_limit_hint')}</p>
              <div className="space-y-1.5 sm:col-span-2">
                <label className="flex items-center gap-2 pt-1 text-sm text-text">
                  <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} />
                  {t('active')}
                </label>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* العنوان الوطني */}
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="flex items-center gap-2"><MapPin className="h-4 w-4 text-primary" strokeWidth={1.8} />{t('national_address')}</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
                <Label htmlFor="address">{t('address')}</Label>
                <Input id="address" value={form.address} onChange={(e) => set('address', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="building_no">{t('building_no')}</Label>
                <Input id="building_no" dir="ltr" className="num" value={form.building_no} onChange={(e) => set('building_no', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="street">{t('street')}</Label>
                <Input id="street" value={form.street} onChange={(e) => set('street', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="district">{t('district')}</Label>
                <Input id="district" value={form.district} onChange={(e) => set('district', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="postal_code">{t('postal_code')}</Label>
                <Input id="postal_code" dir="ltr" className="num" value={form.postal_code} onChange={(e) => set('postal_code', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="country">{t('country')}</Label>
                <Input id="country" dir="ltr" placeholder="SA" value={form.country} onChange={(e) => set('country', e.target.value)} />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {error && <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}
    </div>
  );
}
