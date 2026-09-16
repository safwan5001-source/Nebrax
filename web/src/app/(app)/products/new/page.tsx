'use client';

import Link from 'next/link';
import { ChangeEvent, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { ApiError, api } from '@/lib/api';
import { ProductPublicationFields } from '@/components/products/product-publication-fields';
import { ProductWorkspace } from '@/components/products/product-workspace';
import { replaceProductPublication } from '@/modules/products/publication';
import { useProductPublication } from '@/modules/products/use-product-publication';

interface SelectedProductImage { file: File; previewUrl: string }

const MAX_PRODUCT_IMAGES = 8;
const MAX_PRODUCT_IMAGE_SIZE = 5 * 1024 * 1024;
const PRODUCT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * غلافٌ رقيقٌ حول `ProductWorkspace` (PR-PROD-UX-1). الوحدات/الباركود
 * المتعدّد/السعر لكل وحدة انتقلت إلى داخل `ProductWorkspace` نفسه
 * (PR-PROD-UX-2) — هذه الصفحة لم تعد تملك أي نسخةٍ ثانية من ذلك المنطق.
 * الوسائط والنشر التجاري تبقى مملوكةً لهذه الصفحة تماماً كما كانت.
 */
export default function NewProductPage() {
  const t = useTranslations('products');
  const tc = useTranslations('common');
  const router = useRouter();
  const { success, error: toastError } = useToast();

  const [productId, setProductId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [productImages, setProductImages] = useState<SelectedProductImage[]>([]);
  const productImageUrls = useRef<string[]>([]);
  const publication = useProductPublication();

  function selectProductImages(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;

    if (files.length + productImages.length > MAX_PRODUCT_IMAGES) {
      setError(t('media_limit_reached'));
      return;
    }

    if (files.some((file) => !PRODUCT_IMAGE_TYPES.includes(file.type) || file.size > MAX_PRODUCT_IMAGE_SIZE)) {
      setError(t('media_invalid_file'));
      return;
    }

    const selected = files.map((file) => {
      const previewUrl = URL.createObjectURL(file);
      productImageUrls.current.push(previewUrl);
      return { file, previewUrl };
    });
    setProductImages((current) => [...current, ...selected]);
    setError(null);
  }

  function removeProductImage(previewUrl: string) {
    URL.revokeObjectURL(previewUrl);
    productImageUrls.current = productImageUrls.current.filter((url) => url !== previewUrl);
    setProductImages((current) => current.filter((image) => image.previewUrl !== previewUrl));
  }

  /** يُستدعى مرّةً واحدة فور نجاح `POST /products` — لا يُعاد استدعاؤه لاحقاً. */
  async function afterCreated(id: string) {
    setProductId(id);
    await finishUp(id);
  }

  async function finishUp(id: string) {
    setFinishing(true);
    setError(null);
    try {
      if (publication.status === 'ready') {
        try {
          await replaceProductPublication(id, publication.selectedIds);
        } catch {
          setError(t('publication_failed_after_create'));
          toastError(t('product_created_publication_pending'));
          return;
        }
      }

      if (productImages.length > 0) {
        const mediaBody = new FormData();
        productImages.forEach(({ file }) => mediaBody.append('media[]', file));
        try {
          await api(`/products/${id}/media`, { method: 'POST', body: mediaBody });
        } catch {
          toastError(t('media_upload_failed_after_create'));
          router.push(`/products/${id}`);
          return;
        }
      }

      success(tc('created'));
      router.push('/products');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setFinishing(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="icon" aria-label={t('back')}><Link href='/products'>
          <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
        </Link></Button>
        <h1 className="text-xl font-semibold text-text">{t('new_title')}</h1>
      </div>

      <ProductWorkspace
        mode="create"
        onCreated={afterCreated}
        onUpdated={(id) => void finishUp(id)}
        saveLabel={productId ? t('retry_publication') : undefined}
        cancelHref="/products"
      />

      <Card>
        <CardHeader><CardTitle>{t('product_media')}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label htmlFor="product-images">{t('product_media')}</Label>
            <span className="text-xs text-muted">{t('selected_media_count', { count: productImages.length, max: MAX_PRODUCT_IMAGES })}</span>
          </div>
          <Input id="product-images" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={finishing || productImages.length === MAX_PRODUCT_IMAGES} onChange={selectProductImages} aria-describedby="product-images-hint" />
          <p id="product-images-hint" className="text-xs leading-relaxed text-muted">{t('product_media_hint')}</p>
          {productImages.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {productImages.map((image, index) => (
                <div key={image.previewUrl} className="overflow-hidden rounded border border-border bg-surface">
                  <div className="aspect-square bg-muted/30">
                    <img src={image.previewUrl} alt={t('image_preview', { number: index + 1 })} className="h-full w-full object-cover" />
                  </div>
                  <div className="flex items-center gap-1 p-2">
                    <span className="min-w-0 flex-1 truncate text-xs text-text" title={image.file.name}>{image.file.name}</span>
                    <Button type="button" variant="ghost" size="icon" aria-label={`${t('delete')}: ${image.file.name}`} disabled={finishing} onClick={() => removeProductImage(image.previewUrl)}>
                      <Trash2 className="h-4 w-4" strokeWidth={1.7} />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ProductPublicationFields
        status={publication.status}
        stores={publication.stores}
        selectedIds={publication.selectedIds}
        disabled={finishing}
        onChange={publication.setSelectedIds}
        onRetry={() => void publication.reload()}
        labels={{
          title: t('online_store'),
          availableOnline: t('available_online'),
          hint: t('publication_hint'),
          loading: t('publication_loading'),
          empty: t('publication_empty'),
          loadFailed: t('publication_load_failed'),
          retry: t('retry'),
        }}
      />

      {error && <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}
    </div>
  );
}
