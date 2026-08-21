'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { notifyCompanyUpdated, type Company } from '@/lib/company';

export function CompanyDialog({
  open,
  onClose,
  onSaved,
  company,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  company: Company | null;
}) {
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  const { success } = useToast();
  const [form, setForm] = useState({
    name: company?.name ?? '',
    vat_number: company?.vat_number ?? '',
    cr_number: company?.cr_number ?? '',
    currency: company?.currency ?? 'SAR',
    country: company?.country ?? 'SA',
    phone: company?.phone ?? '',
    mobile: company?.mobile ?? '',
    building_no: company?.building_no ?? '',
    street: company?.street ?? '',
    additional_no: company?.additional_no ?? '',
    district: company?.district ?? '',
    city: company?.city ?? '',
    postal_code: company?.postal_code ?? '',
    short_address: company?.short_address ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api('/company', {
        method: 'PUT',
        body: {
          ...form,
          vat_number: form.vat_number || null,
          cr_number: form.cr_number || null,
          currency: form.currency || null,
          country: form.country || null,
        },
      });
      success(tc('updated'));
      notifyCompanyUpdated();
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t('edit_company')} className="max-w-2xl">
      <form onSubmit={submit} className="space-y-5">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cname">{t('company_name')}</Label>
            <Input id="cname" value={form.name} onChange={(e) => set('name', e.target.value)} required />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="vat">{t('vat_number')}</Label>
              <Input id="vat" dir="ltr" value={form.vat_number} onChange={(e) => set('vat_number', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cr">{t('cr_number')}</Label>
              <Input id="cr" dir="ltr" value={form.cr_number} onChange={(e) => set('cr_number', e.target.value)} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="currency">{t('currency')}</Label>
              <Input id="currency" dir="ltr" maxLength={3} value={form.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="country">{t('country')}</Label>
              <Input id="country" dir="ltr" maxLength={2} value={form.country} onChange={(e) => set('country', e.target.value.toUpperCase())} />
            </div>
          </div>
        </div>

        <section className="space-y-3 border-t border-border pt-4" aria-labelledby="company-contact-heading">
          <h3 id="company-contact-heading" className="text-sm font-semibold text-text">{t('contact_details')}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="company-phone">{t('phone')}</Label>
              <Input id="company-phone" dir="ltr" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="company-mobile">{t('mobile')}</Label>
              <Input id="company-mobile" dir="ltr" value={form.mobile} onChange={(e) => set('mobile', e.target.value)} />
            </div>
          </div>
        </section>

        <section className="space-y-3 border-t border-border pt-4" aria-labelledby="company-address-heading">
          <h3 id="company-address-heading" className="text-sm font-semibold text-text">{t('national_address')}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="company-building">{t('building_no')}</Label>
              <Input id="company-building" value={form.building_no} onChange={(e) => set('building_no', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="company-additional">{t('additional_no')}</Label>
              <Input id="company-additional" value={form.additional_no} onChange={(e) => set('additional_no', e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="company-street">{t('street')}</Label>
            <Input id="company-street" value={form.street} onChange={(e) => set('street', e.target.value)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="company-district">{t('district')}</Label>
              <Input id="company-district" value={form.district} onChange={(e) => set('district', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="company-city">{t('city')}</Label>
              <Input id="company-city" value={form.city} onChange={(e) => set('city', e.target.value)} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="company-postal">{t('postal_code')}</Label>
              <Input id="company-postal" dir="ltr" value={form.postal_code} onChange={(e) => set('postal_code', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="company-short-address">{t('short_address')}</Label>
              <Input id="company-short-address" dir="ltr" value={form.short_address} onChange={(e) => set('short_address', e.target.value)} />
            </div>
          </div>
        </section>

        {error && <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
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
