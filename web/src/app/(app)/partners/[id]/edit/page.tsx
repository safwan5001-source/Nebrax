'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { ErrorState, FormActions, FormAlert, FormPage, LoadingState } from '@/components/nebrax';
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
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      // المورد مغلَّف بـ `{data}` — تفريغه هنا وإلا فُتح النموذج فارغاً بلا خطأ.
      const result = await api<{ data: PartnerApi }>(`/partners/${id}`);
      setForm(partnerFormFromApi(result.data));
      setName(result.data.name);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : t('not_found'));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => { void load(); }, [load]);

  const set = <K extends keyof PartnerFormValues>(key: K, value: PartnerFormValues[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  async function submit() {
    if (!form.name.trim()) { setError(tc('saveFailed')); return; }
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

  if (loading) return <LoadingState variant="cards" rows={4} label={t('edit_title')} />;
  if (loadError) return <ErrorState message={loadError} onRetry={() => void load()} />;

  return (
    <FormPage
      backHref={`/partners/${id}`}
      backLabel={t('back')}
      title={t('edit_title')}
      description={name}
      actions={
        <FormActions
          primary={
            <Button type="button" disabled={saving || !form.name.trim()} onClick={() => void submit()}>
              {t('save')}
            </Button>
          }
          secondary={
            <Button type="button" variant="outline" disabled={saving} onClick={() => router.push(`/partners/${id}`)}>
              {t('cancel')}
            </Button>
          }
        />
      }
    >
      {error ? <FormAlert>{error}</FormAlert> : null}

      <PartnerForm form={form} onChange={set} mode="edit" />
    </FormPage>
  );
}
