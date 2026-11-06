'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Download, Eye, FileText, Image as ImageIcon, Trash2, X } from 'lucide-react';
import { ConfirmDialog, PrimaryButton, SecondaryButton } from '../write-ui';
import { formatBytes, isImageMime, type FileCheck, type FileRejection } from './attachments';
import { FilePicker } from './file-picker';
import { FailureNotice, when, type AnyFailure } from './parts';
import { attachmentPreviewUrl, deleteAttachment, downloadAttachment, uploadAttachments } from './receiving-client';
import type { Attachment } from './schemas';

/**
 * FUEL-B5.1 — مرفقات سند المورد في تفاصيل الاستلام: قائمة + معاينة + تنزيل + (للمسودة) رفع بكاميرا الآيفون أو ملف + حذف.
 * القراءة بنطاق الاستلام، والرفع/الحذف بمفتاح الإنشاء (الخادم يفرضه)، والحذف للمسودة فقط. الرفع بفعل صريح، بقفل إرسال مكرر، ونتيجته صادقة:
 * فشل غير مؤكد ⇒ «تحقق من الحالة» بإعادة قراءة القائمة (الخادم يعيد المرفق الموجود بالمحتوى نفسه، فلا تكرار).
 */
export function AttachmentsPanel({ deliveryId, branchId, attachments, canUpload, canDelete, onChanged }: {
  deliveryId: string;
  branchId?: string | null;
  attachments: Attachment[];
  canUpload: boolean;
  canDelete: boolean;
  /** يطلب من الأب إعادة قراءة الاستلام (القائمة الحقيقية من الخادم). */
  onChanged: () => Promise<void> | void;
}) {
  const t = useTranslations('stationOps');
  const locale = useLocale();
  const [staged, setStaged] = useState<File[]>([]);
  const [rejected, setRejected] = useState<FileCheck['rejected']>([]);
  const [uploading, setUploading] = useState(false);
  const [failure, setFailure] = useState<AnyFailure | null>(null);
  const [checking, setChecking] = useState(false);
  const [preview, setPreview] = useState<{ attachment: Attachment; url: string | null; error: boolean } | null>(null);
  const [removing, setRemoving] = useState<Attachment | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const inFlight = useRef(false);
  const previewUrl = useRef<string | null>(null);

  useEffect(() => () => { if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); }, []);

  const closePreview = () => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = null;
    setPreview(null);
  };

  const open = async (attachment: Attachment) => {
    setPreview({ attachment, url: null, error: false });
    try {
      const url = await attachmentPreviewUrl(deliveryId, attachment.id, attachment.mime_type ?? undefined);
      previewUrl.current = url;
      setPreview({ attachment, url, error: false });
    } catch {
      setPreview({ attachment, url: null, error: true });
    }
  };

  const picked = (result: FileCheck) => {
    setFailure(null);
    setRejected(result.rejected);
    setStaged((current) => [...current, ...result.accepted].slice(0, 5));
  };

  const upload = async () => {
    if (inFlight.current || staged.length === 0) return; // قفل إرسال مكرر
    inFlight.current = true;
    setUploading(true);
    setFailure(null);
    try {
      const result = await uploadAttachments(deliveryId, staged, { branchId });
      if (result.kind === 'ok') {
        setStaged([]);
        await onChanged();
      } else {
        setFailure(result);
      }
    } finally {
      inFlight.current = false;
      setUploading(false);
    }
  };

  const check = async () => {
    setChecking(true);
    await onChanged();
    setChecking(false);
  };

  const remove = async () => {
    if (!removing || inFlight.current) return;
    inFlight.current = true;
    setBusyId(removing.id);
    try {
      const result = await deleteAttachment(deliveryId, removing.id, { branchId });
      if (result.kind === 'ok') await onChanged();
      else setFailure(result);
      setRemoving(null);
    } finally {
      inFlight.current = false;
      setBusyId(null);
    }
  };

  const reason = (why: FileRejection) => t(`receiving.attach.reject.${why}`);

  return (
    <div className="space-y-3" data-attachments="">
      {attachments.length === 0 ? <p className="text-sm text-muted" data-no-attachments="">{t('receiving.attach.none')}</p> : (
        <ul className="divide-y divide-border rounded-[12px] border border-border">
          {attachments.map((attachment) => {
            const Icon = isImageMime(attachment.mime_type) ? ImageIcon : FileText;
            return (
              <li key={attachment.id} className="flex items-center gap-3 p-3" data-attachment-id={attachment.id}>
                <Icon aria-hidden="true" className="h-5 w-5 shrink-0 text-muted" strokeWidth={1.7} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-text" dir="auto">{attachment.name}</p>
                  <p className="num text-xs text-muted">{formatBytes(attachment.size)} · {when(attachment.created_at, locale)}</p>
                </div>
                <button type="button" aria-label={`${t('receiving.attach.preview')}: ${attachment.name}`} onClick={() => void open(attachment)} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-text hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><Eye aria-hidden="true" className="h-5 w-5" strokeWidth={1.8} /></button>
                <button type="button" aria-label={`${t('receiving.attach.download')}: ${attachment.name}`} onClick={() => void downloadAttachment(deliveryId, attachment.id, attachment.name).catch(() => setFailure({ kind: 'unknown', reason: 'network' }))} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-text hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><Download aria-hidden="true" className="h-5 w-5" strokeWidth={1.8} /></button>
                {canDelete ? <button type="button" aria-label={`${t('receiving.attach.remove')}: ${attachment.name}`} disabled={busyId === attachment.id} onClick={() => setRemoving(attachment)} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-negative hover:bg-[color:var(--fo-negative-tint)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"><Trash2 aria-hidden="true" className="h-5 w-5" strokeWidth={1.8} /></button> : null}
              </li>
            );
          })}
        </ul>
      )}

      {canUpload ? (
        <div className="space-y-3">
          <FilePicker existing={attachments.length + staged.length} disabled={uploading} onPicked={picked} />
          <p className="text-xs leading-5 text-muted">{t('receiving.attach.hint')}</p>
          {rejected.length > 0 ? (
            <ul role="alert" data-rejected-files="" className="space-y-1 rounded-[12px] bg-[color:var(--fo-negative-tint)] p-3 text-sm leading-6 text-negative">
              {rejected.map((item, index) => <li key={`${item.name}-${index}`} dir="auto">{item.name} — {reason(item.reason)}</li>)}
            </ul>
          ) : null}
          {staged.length > 0 ? (
            <div className="space-y-2" data-staged="">
              <ul className="space-y-1.5">
                {staged.map((file, index) => (
                  <li key={`${file.name}-${index}`} className="flex items-center gap-2 rounded-[10px] border border-border bg-surface px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate" dir="auto">{file.name}</span>
                    <span className="num text-xs text-muted">{formatBytes(file.size)}</span>
                    <button type="button" aria-label={`${t('receiving.attach.unstage')}: ${file.name}`} disabled={uploading} onClick={() => setStaged((current) => current.filter((_, i) => i !== index))} className="grid h-9 w-9 place-items-center rounded-md hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><X aria-hidden="true" className="h-4 w-4" /></button>
                  </li>
                ))}
              </ul>
              <PrimaryButton data-upload="" disabled={uploading} aria-busy={uploading} onClick={() => void upload()}>{uploading ? t('receiving.attach.uploading') : t('receiving.attach.upload', { count: staged.length })}</PrimaryButton>
            </div>
          ) : null}
          {failure ? <FailureNotice failure={failure} onCheck={() => void check()} checking={checking} /> : null}
        </div>
      ) : null}

      <ConfirmDialog open={preview !== null} title={preview?.attachment.name ?? ''} onClose={closePreview}>
        <div className="space-y-3">
          {preview?.error ? <p role="alert" className="rounded-[12px] bg-[color:var(--fo-negative-tint)] p-3 text-sm text-negative">{t('receiving.attach.previewFailed')}</p> : null}
          {preview && !preview.url && !preview.error ? <p className="text-sm text-muted">{t('receiving.attach.loading')}</p> : null}
          {preview?.url && isImageMime(preview.attachment.mime_type) ? (
            // eslint-disable-next-line @next/next/no-img-element -- blob محلي بمصادقة API؛ لا تحسين صور خارجي
            <img src={preview.url} alt={preview.attachment.name} className="max-h-[60vh] w-full rounded-[10px] object-contain" />
          ) : null}
          {preview?.url && !isImageMime(preview.attachment.mime_type) ? (
            <a href={preview.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-12 w-full items-center justify-center rounded-[13px] border border-[color:var(--fo-control)] px-4 text-[15px] font-semibold text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{t('receiving.attach.openPdf')}</a>
          ) : null}
          <SecondaryButton onClick={closePreview}>{t('receiving.attach.close')}</SecondaryButton>
        </div>
      </ConfirmDialog>

      <ConfirmDialog open={removing !== null} title={t('receiving.attach.removeTitle')} onClose={() => setRemoving(null)} busy={busyId !== null}>
        <div className="space-y-4">
          <p className="text-sm leading-6 text-muted" dir="auto">{removing?.name}</p>
          <div className="grid grid-cols-2 gap-2.5">
            <SecondaryButton onClick={() => setRemoving(null)} disabled={busyId !== null}>{t('receiving.attach.keep')}</SecondaryButton>
            <PrimaryButton data-confirm-remove="" onClick={() => void remove()} disabled={busyId !== null}>{t('receiving.attach.removeConfirm')}</PrimaryButton>
          </div>
        </div>
      </ConfirmDialog>
    </div>
  );
}
