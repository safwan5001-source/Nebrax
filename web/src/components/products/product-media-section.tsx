'use client';

import * as React from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { ImageOff, ImagePlus, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, ApiError, fetchImageUrl } from '@/lib/api';

export const MAX_PRODUCT_IMAGES = 8;
export const MAX_PRODUCT_IMAGE_SIZE = 5 * 1024 * 1024;
export const PRODUCT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export interface PendingImage { file: File; previewUrl: string }
export interface StoredMedia { id: string; original_name: string; download_url: string; previewUrl?: string | null }

/**
 * صور المنتج — قسمٌ واحد بحالتين، لا شاشتان.
 *
 * **الإنشاء** لا يملك مُعرّفاً بعد، فالصور تُحتجَز محلياً (`File` + `blob:`) ويرفعها
 * المستدعي بعد `POST` عبر `/products/{id}/media`. **التعديل** يملك المُعرّف، فكل رفعٍ
 * أو حذفٍ يصيب الخادم فوراً — لأن الوسائط مسارٌ مستقلّ لا حقلٌ في حمولة المنتج،
 * فتأجيلها إلى «حفظ» كان سيَعِد بذرّيةٍ لا يملكها العقد.
 *
 * **التخزين الدائم (R2/S3) مؤجَّل بصراحة في `CLAUDE.md`** — هذا القسم واجهةٌ فوق
 * المسار القائم ولا يوسّع بنية التخزين.
 */
export function ProductMediaSection({
  productId,
  pending,
  onPendingChange,
  onError,
  disabled,
}: {
  /** `null` في الإنشاء: الصور محلية حتى يوجد المنتج. */
  productId: string | null;
  pending: PendingImage[];
  onPendingChange: (images: PendingImage[]) => void;
  onError: (message: string | null) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('products');
  const [stored, setStored] = React.useState<StoredMedia[]>([]);
  const [busy, setBusy] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const objectUrls = React.useRef<string[]>([]);

  const revoke = React.useCallback(() => {
    objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrls.current = [];
  }, []);

  const loadStored = React.useCallback(async () => {
    if (!productId) return;
    setBusy(true);
    try {
      const result = await api<{ data: StoredMedia[] }>(`/products/${productId}/media`);
      const hydrated = await Promise.all(
        result.data.map(async (item) => ({ ...item, previewUrl: await fetchImageUrl(item.download_url) }))
      );
      revoke();
      objectUrls.current = hydrated.flatMap((item) => (item.previewUrl ? [item.previewUrl] : []));
      setStored(hydrated);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : t('load_profile_failed'));
    } finally {
      setBusy(false);
    }
    // `onError` يتغيّر كل عرض في المستدعي؛ إدراجه هنا يعيد الجلب بلا نهاية.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, revoke, t]);

  React.useEffect(() => { void loadStored(); }, [loadStored]);
  React.useEffect(() => () => revoke(), [revoke]);

  const count = productId ? stored.length : pending.length;
  const full = count >= MAX_PRODUCT_IMAGES;

  function reject(files: File[]): string | null {
    if (files.length + count > MAX_PRODUCT_IMAGES) return t('media_limit_reached');
    if (files.some((f) => !PRODUCT_IMAGE_TYPES.includes(f.type) || f.size > MAX_PRODUCT_IMAGE_SIZE)) {
      return t('media_invalid_file');
    }
    return null;
  }

  async function pick(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;

    const problem = reject(files);
    if (problem) { onError(problem); return; }
    onError(null);

    if (!productId) {
      const selected = files.map((file) => {
        const previewUrl = URL.createObjectURL(file);
        objectUrls.current.push(previewUrl);
        return { file, previewUrl };
      });
      onPendingChange([...pending, ...selected]);
      return;
    }

    setBusy(true);
    try {
      const body = new FormData();
      files.forEach((file) => body.append('media[]', file));
      await api(`/products/${productId}/media`, { method: 'POST', body });
      await loadStored();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : t('load_profile_failed'));
    } finally {
      setBusy(false);
    }
  }

  function dropPending(previewUrl: string) {
    URL.revokeObjectURL(previewUrl);
    objectUrls.current = objectUrls.current.filter((url) => url !== previewUrl);
    onPendingChange(pending.filter((image) => image.previewUrl !== previewUrl));
  }

  async function dropStored(mediaId: string) {
    if (!productId) return;
    onError(null);
    setBusy(true);
    try {
      await api(`/products/${productId}/media/${mediaId}`, { method: 'DELETE' });
      await loadStored();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : t('load_profile_failed'));
    } finally {
      setBusy(false);
    }
  }

  const tiles = productId
    ? stored.map((item) => ({ key: item.id, name: item.original_name, url: item.previewUrl ?? null, remove: () => void dropStored(item.id) }))
    : pending.map((item) => ({ key: item.previewUrl, name: item.file.name, url: item.previewUrl, remove: () => dropPending(item.previewUrl) }));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs leading-relaxed text-muted">{t('product_media_hint')}</p>
        <span className="num shrink-0 text-xs text-muted">
          {t('selected_media_count', { count, max: MAX_PRODUCT_IMAGES })}
        </span>
      </div>

      {/* حقل الملف مخفيّ خلف زرّ حقيقي: `Input type="file"` يعرض زرّ متصفّح غير
          مترجَم ولا يقبل تنسيق النظام. و`size-px` مع `sr-only` معاً — `w-full`
          من `Input` يغلب `sr-only` وحدها فيمتدّ الحقل بعرض الشاشة ويصنع تمريراً. */}
      <Label htmlFor="product-media-input" className="sr-only">{t('upload_media')}</Label>
      <Input
        ref={inputRef}
        id="product-media-input"
        type="file"
        accept={PRODUCT_IMAGE_TYPES.join(',')}
        multiple
        className="sr-only size-px"
        disabled={disabled || busy || full}
        onChange={pick}
      />
      <Button type="button" variant="outline" disabled={disabled || busy || full} onClick={() => inputRef.current?.click()}>
        <Upload className="h-4 w-4" strokeWidth={1.7} aria-hidden />
        {t('upload_media')}
      </Button>

      {tiles.length === 0 ? (
        <div className="flex items-center gap-2 rounded-md bg-background px-3 py-2 text-sm text-muted">
          <ImagePlus className="h-4 w-4 shrink-0" strokeWidth={1.6} aria-hidden />
          {t('no_media')}
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {tiles.map((tile) => (
            <li key={tile.key} className="overflow-hidden rounded-md border border-border bg-surface">
              <div className="relative aspect-square bg-background">
                {tile.url ? (
                  <Image src={tile.url} alt={tile.name} fill unoptimized sizes="(max-width: 640px) 50vw, 160px" className="object-cover" />
                ) : (
                  <span className="grid h-full place-items-center text-muted" aria-hidden>
                    <ImageOff className="h-5 w-5" strokeWidth={1.5} />
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 p-2">
                <span className="min-w-0 flex-1 truncate text-xs text-text" title={tile.name}>{tile.name}</span>
                <Button
                  type="button" variant="ghost" size="icon" className="shrink-0"
                  aria-label={`${t('delete')}: ${tile.name}`} disabled={disabled || busy} onClick={tile.remove}
                >
                  <Trash2 className="h-4 w-4 text-negative" strokeWidth={1.7} />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
