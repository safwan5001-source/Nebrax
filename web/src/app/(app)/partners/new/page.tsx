'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import {
  EMPTY_PARTNER_FORM, PartnerForm, partnerFormToPayload, type PartnerFormValues,
} from '@/components/partners/partner-form';
import { api, ApiError } from '@/lib/api';

/** إنشاء طرف جديد. الرصيد الافتتاحي متاح هنا وحده — يولّد قيده عند الإنشاء. */
export default function NewPartnerPage() {
  const t = useTranslations('partners');
  const tc = useTranslations('common');
  const router = useRouter();
  const { success } = useToast();

  const [form, setForm] = useState<PartnerFormValues>(EMPTY_PARTNER_FORM);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof PartnerFormValues>(key: K, value: PartnerFormValues[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function submit() {
    if (!form.name.trim()) { setError(tc('saveFailed')); return; }
    setSaving(true);
    setError(null);
    try {
      await api('/partners', { method: 'POST', body: partnerFormToPayload(form, true) });
      success(tc('created'));
      router.push('/partners');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="icon" aria-label={t('back')}><Link href='/partners'>
          <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
        </Link></Button>
        <h1 className="text-xl font-semibold text-text">{t('new_title')}</h1>
        <div className="ms-auto flex items-center gap-2">
          <Button asChild variant="ghost"><Link href='/partners'>{t('cancel')}</Link></Button>
          <Button disabled={saving || !form.name.trim()} onClick={submit}>{t('save')}</Button>
        </div>
      </div>

      <PartnerForm form={form} onChange={set} mode="create" />

      {error && <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}
    </div>
  );
}
