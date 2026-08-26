'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { ErrorState, FormActions, FormAlert, FormPage, LoadingState } from '@/components/nebrax';
import {
  canSaveProduct, EMPTY_PRODUCT_FORM, ProductForm, productFormFromApi, productFormToPayload,
  type ProductApi, type ProductFormValues,
} from '@/components/products/product-form';
import type { PendingImage } from '@/components/products/product-media-section';
import { api, ApiError } from '@/lib/api';

/**
 * تعديل بيانات منتج.
 *
 * لا رصيد ابتدائي هنا: `UpdateProductRequest` يرفضه بـ`prohibited` لأنه فعلٌ
 * يولّد قيداً مرحّلاً وحركة مخزون، وتصحيحه يكون بحركة مخزون لا بتحرير حقل.
 *
 * الصور تُدار فوراً عبر مسارها المستقلّ — لا تنتظر «حفظ» ولا تُلغى بـ«إلغاء».
 */
export default function EditProductPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations('products');
  const tc = useTranslations('common');
  const router = useRouter();
  const { success } = useToast();

  const [form, setForm] = useState<ProductFormValues>(EMPTY_PRODUCT_FORM);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await api<{ data: ProductApi }>(`/products/${id}`);
      setForm(productFormFromApi(result.data));
      setName(result.data.name);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : t('load_profile_failed'));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => { void load(); }, [load]);

  const set = <K extends keyof ProductFormValues>(key: K, value: ProductFormValues[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  async function submit() {
    if (!canSaveProduct(form)) { setError(tc('saveFailed')); return; }
    setSaving(true);
    setError(null);
    try {
      await api(`/products/${id}`, { method: 'PUT', body: productFormToPayload(form, 'edit') });
      success(tc('updated'));
      router.push(`/products/${id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingState label={t('loading_profile')} />;
  if (loadError) return <ErrorState message={loadError} onRetry={() => void load()} />;

  return (
    <FormPage
      backHref={`/products/${id}`}
      backLabel={t('back')}
      title={t('edit_title')}
      description={name}
      actions={
        <FormActions
          primary={
            <Button type="button" disabled={saving || !canSaveProduct(form)} onClick={() => void submit()}>
              {t('save')}
            </Button>
          }
          secondary={
            <Button type="button" variant="outline" disabled={saving} onClick={() => router.push(`/products/${id}`)}>
              {t('cancel')}
            </Button>
          }
        />
      }
    >
      {error ? <FormAlert>{error}</FormAlert> : null}

      <ProductForm
        form={form}
        onChange={set}
        mode="edit"
        productId={id}
        pendingImages={[] as PendingImage[]}
        onPendingImagesChange={() => {}}
        onMediaError={setError}
        disabled={saving}
      />
    </FormPage>
  );
}
