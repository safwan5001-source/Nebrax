'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, User, Wallet } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';

export default function NewPartnerPage() {
  const t = useTranslations('partners');
  const tc = useTranslations('common');
  const router = useRouter();
  const { success } = useToast();

  const [form, setForm] = useState({
    name: '', name_en: '', type: 'customer', phone: '', address: '', city: '',
    vat_number: '', cr_number: '', code: '', email: '', is_active: true,
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
          address: form.address || null,
          city: form.city || null,
          vat_number: form.vat_number || null,
          cr_number: form.cr_number || null,
          code: form.code || null,
          email: form.email || null,
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
                <Label htmlFor="city">{t('city')}</Label>
                <Input id="city" value={form.city} onChange={(e) => set('city', e.target.value)} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="address">{t('address')}</Label>
                <Input id="address" value={form.address} onChange={(e) => set('address', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="vat">{t('vat_number')}</Label>
                <Input id="vat" dir="ltr" className="num" maxLength={15} placeholder={t('vat_hint')} value={form.vat_number} onChange={(e) => set('vat_number', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cr">{t('cr_number')}</Label>
                <Input id="cr" dir="ltr" className="num" value={form.cr_number} onChange={(e) => set('cr_number', e.target.value)} />
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
              <div className="space-y-1.5 sm:col-span-2">
                <label className="flex items-center gap-2 pt-1 text-sm text-text">
                  <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} />
                  {t('active')}
                </label>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {error && <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}
    </div>
  );
}
