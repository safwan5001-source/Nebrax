'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import {
  EMPTY_PARTNER_FORM, PartnerForm, partnerFormFromApi, partnerFormToPayload,
  type PartnerApi, type PartnerFormValues,
} from '@/components/partners/partner-form';
import { api, ApiError } from '@/lib/api';

/**
 * تعديل بيانات طرف (عميل/مورد). شاشة بيانات بحتة:
 * تُرسل `PUT /partners/{id}` ولا تولّد قيداً ولا تمسّ رصيداً.
 * الرصيد الافتتاحي غائب عمداً — قيد مرحّل لا يُعدَّل من شاشة بيانات.
 */
export default function EditPartnerPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations('partners');
  const tc = useTranslations('common');
  const { success } = useToast();

  const [form, setForm] = useState<PartnerFormValues>(EMPTY_PARTNER_FORM);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // المورد مغلَّف بـ `{data}` — تفريغه هنا وإلا فُتح النموذج فارغاً بلا خطأ.
    api<{ data: PartnerApi }>(`/partners/${id}`)
      .then((r) => setForm(partnerFormFromApi(r.data)))
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id]);

  const set = <K extends keyof PartnerFormValues>(key: K, value: PartnerFormValues[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function submit() {
    if (!form.name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api(`/partners/${id}`, { method: 'PUT', body: partnerFormToPayload(form, false) });
      success(tc('updated'));
      router.push(`/partners/${id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="rounded border border-border bg-surface p-10 text-center text-sm text-muted">
        {t('not_found')}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="icon" aria-label={t('back')}><Link href={`/partners/${id}`}>
          <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
        </Link></Button>
        <h1 className="truncate text-xl font-semibold text-text">{t('edit_title')}</h1>
        <div className="ms-auto flex items-center gap-2">
          <Button asChild variant="ghost"><Link href={`/partners/${id}`}>{t('cancel')}</Link></Button>
          <Button disabled={saving || !form.name.trim()} onClick={submit}>{t('save')}</Button>
        </div>
      </div>

      <PartnerForm form={form} onChange={set} mode="edit" />

      {error && <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}
    </div>
  );
}
