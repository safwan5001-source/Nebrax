'use client';

import { ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { ImageOff, ImagePlus, RefreshCw, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, ApiError, fetchImageUrl } from '@/lib/api';

export const MAX_PRODUCT_IMAGES = 8;
export const MAX_PRODUCT_IMAGE_SIZE = 5 * 1024 * 1024;
export const PRODUCT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** صفٌّ محليٌّ معلَّق — قبل وجود `productId`؛ لا يُرفَع، فقط يُعاين محلياً. */
export interface PendingMediaFile {
  file: File;
  previewUrl: string;
}

type LiveMedia = { id: string; original_name: string; download_url: string; sort_order: number; previewUrl?: string | null };

/**
 * `ProductMediaSection` — قسم الوسائط الموحَّد داخل `ProductWorkspace` (PR-PROD-UX-4).
 *
 * **وضعان بمكوّنٍ واحد، لا تطبيقين** — نفس نمط `ProductMultiBarcodeTable`
 * (PR-PROD-UX-2): بلا `productId` بعد (منتجٌ لم يُحفَظ أول مرّة)، القسم محليٌّ
 * بحت — لا نداء شبكة إطلاقاً، والملفات المختارة تُدار عبر `pendingFiles`/
 * `onPendingFilesChange` التي يملكها المستدعي (`ProductWorkspace`) ليرفعها
 * فور نجاح أول `POST /products`. بوجود `productId`، القسم يعمل بسلطته
 * الحقيقية القائمة (`GET/POST/DELETE /products/{id}/media`) فوراً عند كل
 * تغيير — بلا انتظار زرّ «حفظ» الرئيسي، تماماً كسلوك الملف الشخصي للمنتج
 * السابق الذي استُخرج منه هذا المكوّن حرفياً.
 *
 * الغلاف (أوّل عنصرٍ في القائمة) هو المعاينة الكبرى افتراضياً — سلوكٌ حتميٌّ
 * لا يعتمد على حالة عرضٍ عابرة. مسارات التخزين الداخلية لا تُكشَف للعميل
 * إطلاقاً؛ كل معاينة تمرّ عبر `fetchImageUrl` (رابط `blob:` محليّ بترويسة
 * مصادقة، لا `<img src>` مباشر على مسارٍ خاص).
 *
 * **حدود هذا القسم عمداً:** لا مستوى «وسائط قيمة خيارٍ مرئي» (كـ اللون=أسود)
 * ولا تجاوز وسائط متغيّرٍ محدَّد — الهرم المعتمد يذكرهما كمستويين لاحقين غير
 * مبنيَّين اليوم؛ هذا القسم يبقى مستوى «معرض المنتج المشترك» فقط. كذلك لا صلة
 * له بوسائط مستندات ZATCA/الفواتير التاريخية — تلك لا تعتمد على حالة المعرض
 * الحيّة إطلاقاً ولم تُمسّ هنا.
 */
export function ProductMediaSection({
  productId,
  pendingFiles,
  onPendingFilesChange,
}: {
  productId?: string;
  /** وضع الإنشاء فقط — الملفات المُعلَّقة يملكها المستدعي (`ProductWorkspace`). */
  pendingFiles: PendingMediaFile[];
  onPendingFilesChange: (files: PendingMediaFile[]) => void;
}) {
  const t = useTranslations('products');
  const isCreateMode = !productId;

  const [liveMedia, setLiveMedia] = useState<LiveMedia[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaObjectUrls = useRef<string[]>([]);

  const revokeLiveUrls = useCallback(() => {
    mediaObjectUrls.current.forEach((url) => URL.revokeObjectURL(url));
    mediaObjectUrls.current = [];
  }, []);

  const load = useCallback(async () => {
    if (!productId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api<{ data: LiveMedia[] }>(`/products/${productId}/media`);
      const hydrated = await Promise.all(result.data.map(async (item) => ({
        ...item,
        previewUrl: await fetchImageUrl(item.download_url),
      })));
      revokeLiveUrls();
      mediaObjectUrls.current = hydrated.flatMap((item) => (item.previewUrl ? [item.previewUrl] : []));
      setLiveMedia(hydrated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('load_profile_failed'));
    } finally {
      setLoading(false);
    }
  }, [productId, revokeLiveUrls, t]);

  useEffect(() => { if (productId) void load(); }, [productId, load]);
  useEffect(() => () => revokeLiveUrls(), [revokeLiveUrls]);
  useEffect(() => {
    if (!isCreateMode) {
      setSelectedId((current) => (liveMedia.some((item) => item.id === current) ? current : (liveMedia[0]?.id ?? null)));
    }
  }, [isCreateMode, liveMedia]);
  // إلغاء عناوين الكائنات المحلية للملفات المُعلَّقة عند تفريغها (بعد الرفع
  // الأول أو إزالة صفٍّ يدوياً) — لا تسريب `blob:` معلَّق.
  useEffect(() => () => { pendingFiles.forEach((p) => URL.revokeObjectURL(p.previewUrl)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function validateFiles(files: File[], currentCount: number): string | null {
    if (files.length + currentCount > MAX_PRODUCT_IMAGES) return t('media_limit_reached');
    if (files.some((file) => !PRODUCT_IMAGE_TYPES.includes(file.type) || file.size > MAX_PRODUCT_IMAGE_SIZE)) return t('media_invalid_file');

    return null;
  }

  function selectPendingFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;
    const validationError = validateFiles(files, pendingFiles.length);
    if (validationError) { setError(validationError); return; }

    setError(null);
    onPendingFilesChange([
      ...pendingFiles,
      ...files.map((file) => ({ file, previewUrl: URL.createObjectURL(file) })),
    ]);
  }

  function removePendingFile(previewUrl: string) {
    URL.revokeObjectURL(previewUrl);
    onPendingFilesChange(pendingFiles.filter((item) => item.previewUrl !== previewUrl));
  }

  async function uploadLiveFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0 || !productId) return;
    const validationError = validateFiles(files, liveMedia.length);
    if (validationError) { setError(validationError); return; }

    setUploading(true);
    setError(null);
    try {
      const body = new FormData();
      files.forEach((file) => body.append('media[]', file));
      await api(`/products/${productId}/media`, { method: 'POST', body });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('load_profile_failed'));
    } finally {
      setUploading(false);
    }
  }

  async function removeLiveMedia(mediaId: string) {
    if (!productId) return;
    setError(null);
    try {
      await api(`/products/${productId}/media/${mediaId}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('load_profile_failed'));
    }
  }

  const count = isCreateMode ? pendingFiles.length : liveMedia.length;
  const atLimit = count >= MAX_PRODUCT_IMAGES;
  const selectedLive = liveMedia.find((item) => item.id === selectedId) ?? liveMedia[0] ?? null;
  const selectedIndex = selectedLive ? liveMedia.findIndex((item) => item.id === selectedLive.id) + 1 : 0;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>{t('product_media')}</CardTitle>
          <p className="mt-1 text-xs leading-relaxed text-muted">{t('product_media_hint')}</p>
        </div>
        {!isCreateMode && (
          <Button type="button" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading || loading || atLimit}>
            <Upload className="h-4 w-4" strokeWidth={1.7} />{t('upload_media')}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {isCreateMode ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor="ws-media-pending">{t('upload_media')}</Label>
              <span className="num text-xs text-muted">{t('selected_media_count', { count, max: MAX_PRODUCT_IMAGES })}</span>
            </div>
            <Input id="ws-media-pending" type="file" accept={PRODUCT_IMAGE_TYPES.join(',')} multiple disabled={atLimit} onChange={selectPendingFiles} aria-describedby="ws-media-pending-hint" />
            <p id="ws-media-pending-hint" className="text-xs leading-relaxed text-muted">{t('media_pending_hint')}</p>
            {pendingFiles.length > 0 && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {pendingFiles.map((item, index) => (
                  <div key={item.previewUrl} className="overflow-hidden rounded border border-border bg-surface">
                    <div className="aspect-square bg-muted/30">
                      <img src={item.previewUrl} alt={t('image_preview', { number: index + 1 })} className="h-full w-full object-cover" />
                    </div>
                    <div className="flex items-center gap-1 p-2">
                      <span className="min-w-0 flex-1 truncate text-xs text-text" title={item.file.name}>{item.file.name}</span>
                      <Button type="button" variant="ghost" size="icon" aria-label={`${t('delete')}: ${item.file.name}`} onClick={() => removePendingFile(item.previewUrl)}>
                        <Trash2 className="h-4 w-4" strokeWidth={1.7} />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <Input ref={fileInputRef} id="ws-media-live" type="file" accept={PRODUCT_IMAGE_TYPES.join(',')} multiple disabled={uploading || loading || atLimit} onChange={uploadLiveFiles} className="sr-only" />
            <div className="grid gap-6 lg:grid-cols-[minmax(15rem,0.5fr)_minmax(0,0.5fr)]">
              <div className="space-y-3">
                <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded border border-border bg-muted/20">
                  {selectedLive?.previewUrl ? (
                    <Image src={selectedLive.previewUrl} alt={selectedLive.original_name} fill priority unoptimized sizes="(max-width: 1024px) 100vw, 34vw" className="object-cover" />
                  ) : selectedLive ? (
                    <div className="flex flex-col items-center gap-2 px-5 text-center text-muted" role="status">
                      <ImageOff className="h-8 w-8" strokeWidth={1.5} aria-hidden />
                      <span className="text-sm">{t('image_preview', { number: selectedIndex })}</span>
                      <Button type="button" variant="outline" size="sm" onClick={() => void load()}><RefreshCw className="h-4 w-4" strokeWidth={1.7} />{t('retry')}</Button>
                    </div>
                  ) : (
                    <button type="button" className="flex h-full w-full flex-col items-center justify-center gap-3 text-muted hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" onClick={() => fileInputRef.current?.click()}>
                      <ImagePlus className="h-10 w-10" strokeWidth={1.35} aria-hidden />
                      <span className="text-sm">{t('upload_media')}</span>
                    </button>
                  )}
                </div>
                {liveMedia.length > 0 && (
                  <div className="grid grid-cols-5 gap-2">
                    {liveMedia.map((item, index) => (
                      <button key={item.id} type="button" className={`relative aspect-square overflow-hidden rounded border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${selectedLive?.id === item.id ? 'border-primary ring-2 ring-primary/25' : 'border-border'}`} aria-label={t('image_preview', { number: index + 1 })} aria-pressed={selectedLive?.id === item.id} onClick={() => setSelectedId(item.id)}>
                        {item.previewUrl ? <Image src={item.previewUrl} alt={item.original_name} fill unoptimized sizes="100px" className="object-cover" /> : <span className="grid h-full place-items-center text-muted" aria-hidden><ImageOff className="h-4 w-4" /></span>}
                      </button>
                    ))}
                  </div>
                )}
                {!loading && liveMedia.length === 0 && (
                  <p className="rounded-md bg-background px-3 py-2 text-sm text-muted">{t('no_media')}</p>
                )}
                {selectedLive && (
                  <div className="flex items-center gap-2 rounded bg-muted/30 px-2.5 py-2">
                    <span className="min-w-0 flex-1 truncate text-xs text-muted" title={selectedLive.original_name}>{selectedLive.original_name}</span>
                    <Button type="button" variant="ghost" size="icon" aria-label={`${t('delete')}: ${selectedLive.original_name}`} onClick={() => void removeLiveMedia(selectedLive.id)} disabled={uploading}>
                      <Trash2 className="h-4 w-4" strokeWidth={1.7} />
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
        {error && <p role="alert" className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}
      </CardContent>
    </Card>
  );
}
