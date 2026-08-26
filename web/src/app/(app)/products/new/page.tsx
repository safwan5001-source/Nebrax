'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { FormActions, FormAlert, FormPage } from '@/components/nebrax';
import {
  canSaveProduct, EMPTY_PRODUCT_FORM, ProductForm, productFormToPayload, type ProductFormValues,
} from '@/components/products/product-form';
import type { PendingImage } from '@/components/products/product-media-section';
import { api, ApiError } from '@/lib/api';

/**
 * إنشاء منتج جديد — نموذج البيانات الأساسية الكامل.
 *
 * الصور تُرفع **بعد** إنشاء المنتج لأن `/products/{id}/media` يحتاج مُعرّفاً؛
 * فشلُها لا يُلغي المنتج، بل يوجّه المستخدم إلى ملفّه ليعيد المحاولة هناك.
 */
export default function NewProductPage() {
  const t = useTranslations('products');
  const tc = useTranslations('common');
  const router = useRouter();
  const { success, error: toastError } = useToast();

  const [form, setForm] = useState<ProductFormValues>(EMPTY_PRODUCT_FORM);
  const [images, setImages] = useState<PendingImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof ProductFormValues>(key: K, value: ProductFormValues[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  async function submit() {
    if (!canSaveProduct(form)) { setError(tc('saveFailed')); return; }
    setSaving(true);
    setError(null);
    try {
      const created = await api<{ data: { id: string } }>('/products', {
        method: 'POST',
        body: productFormToPayload(form, 'create'),
      });

      if (images.length > 0) {
        const body = new FormData();
        images.forEach(({ file }) => body.append('media[]', file));
        try {
          await api(`/products/${created.data.id}/media`, { method: 'POST', body });
        } catch {
          toastError(t('media_upload_failed_after_create'));
          router.push(`/products/${created.data.id}`);
          return;
        }
      }

      success(tc('created'));
      router.push('/products');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormPage
      backHref="/products"
      backLabel={t('back')}
      title={t('new_title')}
      actions={
        <FormActions
          primary={
            <Button type="button" disabled={saving || !canSaveProduct(form)} onClick={() => void submit()}>
              {t('save')}
            </Button>
          }
          secondary={
            <Button type="button" variant="outline" disabled={saving} onClick={() => router.push('/products')}>
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
        mode="create"
        pendingImages={images}
        onPendingImagesChange={setImages}
        onMediaError={setError}
        disabled={saving}
      />
    </FormPage>
  );
}
