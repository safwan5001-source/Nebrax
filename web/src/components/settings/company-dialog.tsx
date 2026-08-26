'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Trash2, Upload } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { fileToResizedDataUrl } from '@/lib/image';
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
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    name: company?.name ?? '',
    name_en: company?.name_en ?? '',
    vat_number: company?.vat_number ?? '',
    cr_number: company?.cr_number ?? '',
    unified_number: company?.unified_number ?? '',
    currency: company?.currency ?? 'SAR',
    country: company?.country ?? 'SA',
    logo: company?.logo ?? '',
    clear_logo: false,
    phone: company?.phone ?? '',
    mobile: company?.mobile ?? '',
    email: company?.email ?? '',
    website: company?.website ?? '',
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

  const set = (k: Exclude<keyof typeof form, 'clear_logo'>, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function pickLogo(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError(t('logo_invalid'));
      return;
    }

    try {
      const logo = await fileToResizedDataUrl(file, 320);
      setForm((current) => ({ ...current, logo, clear_logo: false }));
      setError(null);
    } catch {
      setError(t('logo_invalid'));
    }
  }

  function removeLogo() {
    setForm((current) => ({ ...current, logo: '', clear_logo: true }));
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api('/company', {
        method: 'PUT',
        body: {
          ...form,
          name_en: form.name_en || null,
          vat_number: form.vat_number || null,
          cr_number: form.cr_number || null,
          unified_number: form.unified_number || null,
          email: form.email || null,
          website: form.website || null,
          currency: form.currency || null,
          country: form.country || null,
          logo: form.logo || null,
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
        <section className="space-y-3" aria-labelledby="company-logo-heading">
          <h3 id="company-logo-heading" className="text-sm font-semibold text-text">{t('company_logo')}</h3>
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-muted/40">
              {form.logo ? (
                <img src={form.logo} alt={t('company_logo')} className="max-h-full max-w-full object-contain" />
              ) : (
                <span className="text-center text-[10px] text-muted">{t('company_logo')}</span>
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap gap-2">
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => { void pickLogo(event.target.files?.[0]); event.target.value = ''; }} />
                <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" strokeWidth={1.7} />{t('logo_upload')}</Button>
                {form.logo && <Button type="button" variant="ghost" size="sm" onClick={removeLogo}><Trash2 className="h-4 w-4 text-negative" strokeWidth={1.7} />{t('remove_logo')}</Button>}
              </div>
              <p className="text-xs text-muted">{t('logo_hint')}</p>
            </div>
          </div>
        </section>

        <section className="space-y-3 border-t border-border pt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="cname">{t('company_name')}</Label><Input id="cname" value={form.name} onChange={(e) => set('name', e.target.value)} required /></div>
            <div className="space-y-1.5"><Label htmlFor="cname-en">{t('company_name')} (English)</Label><Input id="cname-en" dir="ltr" value={form.name_en} onChange={(e) => set('name_en', e.target.value)} /></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5"><Label htmlFor="vat">{t('vat_number')}</Label><Input id="vat" dir="ltr" value={form.vat_number} onChange={(e) => set('vat_number', e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="cr">{t('cr_number')}</Label><Input id="cr" dir="ltr" value={form.cr_number} onChange={(e) => set('cr_number', e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="unified-number">الرقم الموحد / Unified No.</Label><Input id="unified-number" dir="ltr" value={form.unified_number} onChange={(e) => set('unified_number', e.target.value)} /></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="currency">{t('currency')}</Label><Input id="currency" dir="ltr" maxLength={3} value={form.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} /></div>
            <div className="space-y-1.5"><Label htmlFor="country">{t('country')}</Label><Input id="country" dir="ltr" maxLength={2} value={form.country} onChange={(e) => set('country', e.target.value.toUpperCase())} /></div>
          </div>
        </section>

        <section className="space-y-3 border-t border-border pt-4" aria-labelledby="company-contact-heading">
          <h3 id="company-contact-heading" className="text-sm font-semibold text-text">{t('contact_details')}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="company-phone">{t('phone')}</Label><Input id="company-phone" dir="ltr" value={form.phone} onChange={(e) => set('phone', e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="company-mobile">{t('mobile')}</Label><Input id="company-mobile" dir="ltr" value={form.mobile} onChange={(e) => set('mobile', e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="company-email">البريد الإلكتروني / Email</Label><Input id="company-email" dir="ltr" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="company-website">الموقع الإلكتروني / Website</Label><Input id="company-website" dir="ltr" value={form.website} onChange={(e) => set('website', e.target.value)} placeholder="https://" /></div>
          </div>
        </section>

        <section className="space-y-3 border-t border-border pt-4" aria-labelledby="company-address-heading">
          <h3 id="company-address-heading" className="text-sm font-semibold text-text">{t('national_address')}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="company-building">{t('building_no')}</Label><Input id="company-building" value={form.building_no} onChange={(e) => set('building_no', e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="company-additional">{t('additional_no')}</Label><Input id="company-additional" value={form.additional_no} onChange={(e) => set('additional_no', e.target.value)} /></div>
          </div>
          <div className="space-y-1.5"><Label htmlFor="company-street">{t('street')}</Label><Input id="company-street" value={form.street} onChange={(e) => set('street', e.target.value)} /></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="company-district">{t('district')}</Label><Input id="company-district" value={form.district} onChange={(e) => set('district', e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="company-city">{t('city')}</Label><Input id="company-city" value={form.city} onChange={(e) => set('city', e.target.value)} /></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="company-postal">{t('postal_code')}</Label><Input id="company-postal" dir="ltr" value={form.postal_code} onChange={(e) => set('postal_code', e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="company-short-address">{t('short_address')}</Label><Input id="company-short-address" dir="ltr" value={form.short_address} onChange={(e) => set('short_address', e.target.value)} /></div>
          </div>
        </section>

        {error && <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-border pt-4"><Button type="button" variant="outline" onClick={onClose}>{t('cancel')}</Button><Button type="submit" disabled={saving}>{t('save')}</Button></div>
      </form>
    </Dialog>
  );
}
