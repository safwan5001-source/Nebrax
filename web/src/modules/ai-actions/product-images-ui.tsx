'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Image as ImageIcon, Loader2, Upload, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { api, ApiError, fetchImageUrl } from '@/lib/api';
import { apiErrorMessage } from './product-preview';
import { currentLang } from './product-execution';
import {
  type ExecutionImage,
  type PreviewImageItem,
  type PreviewImages,
  type StagedArchive,
  IMAGE_TONE,
  imageText,
  thumbnailPath,
} from './product-images';

/**
 * صورة مصغّرة تُجلب بالمصادقة (لا يرسل `<img>` وحده الترويسة) وتُحرَّر عند الفكّ. الفشل لا يكسر الصف:
 * يظهر مكان فارغ بدل صورة مكسورة.
 */
export function AuthThumb({ actionId, imageId, label }: { actionId: string; imageId: string | null; label: string }) {
  const text = imageText(currentLang());
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const current = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    if (imageId === null) {
      setUrl(null);
      return undefined;
    }
    void fetchImageUrl(thumbnailPath(actionId, imageId))
      .then((next) => {
        if (cancelled) {
          if (next) URL.revokeObjectURL(next);
          return;
        }
        if (current.current) URL.revokeObjectURL(current.current);
        current.current = next;
        setUrl(next);
        setFailed(next === null);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true;
      if (current.current) {
        URL.revokeObjectURL(current.current);
        current.current = null;
      }
    };
  }, [actionId, imageId]);

  return (
    <span className="relative inline-flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-primary-soft/40" data-testid="image-thumb">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={text.thumbAlt(label)} className="h-full w-full object-cover" loading="lazy" />
      ) : failed || imageId === null ? (
        <ImageIcon className="h-5 w-5 text-muted" aria-hidden />
      ) : (
        <Loader2 className="h-4 w-4 animate-spin text-muted" aria-hidden />
      )}
    </span>
  );
}

/** خلية الصور في جدول المعاينة: المصغّرات والمصدر والحالة والسبب، لكل صورة على حدة. */
export function PreviewImagesCell({ actionId, images }: { actionId: string; images: PreviewImages | null }) {
  const text = imageText(currentLang());
  if (!images || images.count === 0) return <span className="text-muted">—</span>;

  return (
    <div className="space-y-2 text-xs" data-testid="preview-images">
      <p className="flex flex-wrap items-center gap-1.5">
        <ImageIcon className="h-3.5 w-3.5" aria-hidden /> <span>{text.count(images.count)}</span>
        <Badge tone={images.status === 'ready' ? 'positive' : images.status === 'error' ? 'negative' : 'warning'}>{text.rowStatus[images.status]}</Badge>
      </p>
      <ul className="space-y-1.5">
        {images.items.map((item) => <PreviewImageRow key={item.key} actionId={actionId} item={item} />)}
      </ul>
      {images.mode === 'append_existing' && images.ready > 0 && <p className="text-muted">{text.appendOnly}</p>}
    </div>
  );
}

function PreviewImageRow({ actionId, item }: { actionId: string; item: PreviewImageItem }) {
  const text = imageText(currentLang());
  const tone = item.status === 'ready' ? 'positive' : item.status === 'error' ? 'negative' : item.status === 'skipped' ? 'muted' : 'warning';

  return (
    <li className="flex items-start gap-2">
      <AuthThumb actionId={actionId} imageId={item.image?.id ?? null} label={item.source.label} />
      <div className="min-w-0 space-y-0.5">
        <p className="flex flex-wrap items-center gap-1">
          <bdi dir="ltr" className="max-w-40 truncate font-medium" title={item.source.label}>{item.source.label}</bdi>
          <Badge tone={tone}>{text.previewStatus[item.status]}</Badge>
        </p>
        <p className="text-muted">{text.roles[item.role]} · {text.sources[item.source.kind]}{item.image ? <> · <span className="num" dir="ltr">{item.image.width}×{item.image.height}</span></> : null}</p>
        {item.image && <p className="num text-muted" dir="ltr" title={item.image.sha256}>{item.image.sha256.slice(0, 10)}…</p>}
        {item.message && item.status !== 'ready' && (
          <p className={`flex items-start gap-1 ${item.status === 'error' ? 'text-negative' : 'text-warning'}`}>
            {item.status === 'error' ? <XCircle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden /> : <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />}
            <span>{item.message}</span>
          </p>
        )}
      </div>
    </li>
  );
}

/** نتيجة كل صورة بعد التنفيذ، مستقلة عن نتيجة المنتج. */
export function ExecutionImagesList({ actionId, images }: { actionId: string; images: ExecutionImage[] }) {
  const text = imageText(currentLang());
  if (images.length === 0) return null;

  return (
    <ul className="mt-1 space-y-1.5" data-testid="execution-images" aria-label={text.imageResults}>
      {images.map((image) => (
        <li key={image.key} className="flex items-start gap-2">
          <AuthThumb actionId={actionId} imageId={image.image_id} label={image.source.label} />
          <div className="min-w-0 space-y-0.5">
            <p className="flex flex-wrap items-center gap-1">
              <bdi dir="ltr" className="max-w-40 truncate" title={image.source.label}>{image.source.label}</bdi>
              <Badge tone={IMAGE_TONE[image.status]}>{text.resultStatus[image.status]}</Badge>
            </p>
            {image.error_message && image.status !== 'success' && (
              <p className={image.status === 'failed' || image.status === 'error' ? 'text-negative' : 'text-muted'}>
                {image.error_message}{image.status === 'failed' && image.retryable ? ` (${text.retryableImage})` : ''}
              </p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function newKey(): string {
  return `ai-images-${crypto.randomUUID()}`;
}

interface CardProps {
  actionId: string;
  version: number;
  /** تعديلات غير محفوظة: لا رفع حتى تُحفظ، لأن الرفع يبطل المعاينة ويُعيد تحميل المراجعة. */
  dirty: boolean;
  /** بعد بدء التنفيذ لا تُقبل صور. */
  locked: boolean;
  /** يُستدعى بعد رفع ناجح ليُحمِّل الأب المراجعة (قد تتغير حالة الإجراء إلى «editing»). */
  onStaged: () => void | Promise<void>;
}

export function ImageArchiveCard({ actionId, version, dirty, locked, onStaged }: CardProps) {
  const text = imageText(currentLang());
  const { success, error } = useToast();
  const [busy, setBusy] = useState(false);
  const [staged, setStaged] = useState<StagedArchive | null>(null);
  // يمنع الرفع المزدوج قبل إعادة الرسم.
  const uploading = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void api<{ data: StagedArchive }>(`/ai-actions/${actionId}/images`)
      .then((result) => { if (!cancelled) setStaged(result.data); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [actionId]);

  async function upload(file: File | null) {
    if (!file || uploading.current || dirty || locked) return;
    uploading.current = true;
    setBusy(true);
    try {
      const body = new FormData();
      body.set('expected_version', String(version));
      body.set('archive', file);
      const result = await api<{ data: StagedArchive }>(`/ai-actions/${actionId}/image-archives`, { method: 'POST', headers: { 'Idempotency-Key': newKey() }, body });
      setStaged(result.data);
      success(text.staged(result.data.archive.length));
      await onStaged();
    } catch (exception) {
      error(apiErrorMessage(exception instanceof ApiError ? exception.body : null, text.uploadFailed));
    } finally {
      uploading.current = false;
      setBusy(false);
    }
  }

  const disabled = busy || dirty || locked;
  return (
    <Card data-testid="image-archive-card">
      <CardHeader><CardTitle as="h2" className="flex items-center gap-2 text-base text-text"><ImageIcon className="h-4 w-4" aria-hidden /> {text.cardTitle}</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted">{text.cardHint}</p>
        <label className={`flex min-h-16 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed p-3 ${disabled ? 'opacity-60' : ''}`}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}
          <span>{busy ? text.uploading : text.choose}</span>
          <Input
            className="sr-only"
            type="file"
            accept=".zip,application/zip"
            aria-label={text.choose}
            disabled={disabled}
            onChange={(event) => { const file = event.target.files?.[0] ?? null; event.target.value = ''; void upload(file); }}
          />
        </label>
        {dirty && <p role="status" className="text-warning">{text.saveFirst}</p>}
        {locked && <p role="status" className="text-muted">{text.locked}</p>}
        {staged && staged.archive.length > 0 && (
          <div className="space-y-2" data-testid="staged-archive">
            <p role="status">{text.staged(staged.archive.length)}</p>
            <ul className="flex flex-wrap gap-2">
              {staged.archive.slice(0, 24).map((image) => (
                <li key={image.id} className="flex items-center gap-1.5 text-xs">
                  <AuthThumb actionId={actionId} imageId={image.id} label={image.label} />
                  <bdi dir="ltr" className="max-w-28 truncate" title={image.label}>{image.label}</bdi>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted">{text.resetNote}</p>
          </div>
        )}
        {staged && staged.archive.length === 0 && <p className="text-muted">{text.stagedNone}</p>}
        {staged && staged.remote > 0 && <p className="text-xs text-muted">{text.remoteStaged(staged.remote)}</p>}
      </CardContent>
    </Card>
  );
}
