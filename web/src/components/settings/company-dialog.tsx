'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import type { Company } from '@/lib/company';

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
          name: form.name,
          vat_number: form.vat_number || null,
          cr_number: form.cr_number || null,
          currency: form.currency || null,
          country: form.country || null,
        },
      });
      success(tc('updated'));
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t('company')}>
      <form onSubmit={submit} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="cname">{t('company_name')}</Label>
          <Input id="cname" value={form.name} onChange={(e) => set('name', e.target.value)} required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="vat">{t('vat_number')}</Label>
            <Input id="vat" dir="ltr" value={form.vat_number} onChange={(e) => set('vat_number', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cr">{t('cr_number')}</Label>
            <Input id="cr" dir="ltr" value={form.cr_number} onChange={(e) => set('cr_number', e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="currency">{t('currency')}</Label>
            <Input id="currency" dir="ltr" maxLength={3} value={form.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="country">{t('country')}</Label>
            <Input id="country" dir="ltr" maxLength={2} value={form.country} onChange={(e) => set('country', e.target.value.toUpperCase())} />
          </div>
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
