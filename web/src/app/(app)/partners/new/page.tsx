'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { FormActions, FormAlert, FormPage } from '@/components/nebrax';
import {
  EMPTY_PARTNER_FORM, PartnerForm, partnerFormToPayload, type PartnerFormValues,
} from '@/components/partners/partner-form';
import { api, ApiError } from '@/lib/api';

/**
 * إنشاء طرف جديد (عميل/مورّد/كليهما).
 *
 * الرصيد الافتتاحي متاح هنا وحده: فعلٌ محاسبي يولّد قيداً مرحّلاً مرةً واحدة،
 * و`UpdatePartnerRequest` يرفضه بـ`prohibited` عند التعديل.
 *
 * `?type=supplier` يفتح النموذج على المورّدين مباشرةً — تأتي من قائمة الموردين
 * فلا يُنشأ مورّدٌ بنوع «عميل» لمجرّد أن النموذج يفتح عليه افتراضاً.
 */
export default function NewPartnerPage() {
  const t = useTranslations('partners');
  const tc = useTranslations('common');
  const router = useRouter();
  const searchParams = useSearchParams();
  const { success } = useToast();

  const requestedType = searchParams.get('type');
  const [form, setForm] = useState<PartnerFormValues>(() => ({
    ...EMPTY_PARTNER_FORM,
    type: requestedType === 'supplier' || requestedType === 'both' ? requestedType : 'customer',
  }));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const backHref = requestedType === 'supplier' ? '/suppliers' : '/partners';

  const set = <K extends keyof PartnerFormValues>(key: K, value: PartnerFormValues[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  async function submit() {
    if (!form.name.trim()) { setError(tc('saveFailed')); return; }
    setSaving(true);
    setError(null);
    try {
      await api('/partners', { method: 'POST', body: partnerFormToPayload(form, true) });
      success(tc('created'));
      router.push(backHref);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
      setSaving(false);
    }
  }

  return (
    <FormPage
      backHref={backHref}
      backLabel={t('back')}
      title={t('new_title')}
      actions={
        <FormActions
          primary={
            <Button type="button" disabled={saving || !form.name.trim()} onClick={() => void submit()}>
              {t('save')}
            </Button>
          }
          secondary={
            <Button type="button" variant="outline" disabled={saving} onClick={() => router.push(backHref)}>
              {t('cancel')}
            </Button>
          }
        />
      }
    >
      {error ? <FormAlert>{error}</FormAlert> : null}

      <PartnerForm form={form} onChange={set} mode="create" />
    </FormPage>
  );
}
