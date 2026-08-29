'use client';

import { ChangeEvent, DragEvent, useCallback, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, CircleAlert, Loader2, Trash2, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import { runIntake } from '@/lib/document-intake';
import {
  DOCUMENT_TYPES,
  MAX_FILES_PER_BATCH,
  MAX_FILE_BYTES,
  type DocumentType,
  formatFileSize,
  isAcceptedFile,
} from '@/modules/document-center/intake-contract';
import { cn } from '@/lib/utils';

type UploadPhase = 'idle' | 'uploading' | 'success' | 'error';

type Props = {
  open: boolean;
  onClose: () => void;
  onSuccess: (batchId: string, status: string) => void;
};

const DOCUMENT_TYPE_KEYS: Record<DocumentType, string> = {
  purchase_invoice: 'typePurchaseInvoice',
  sales_invoice: 'typeSalesInvoice',
  expense: 'typeExpense',
  delivery_note: 'typeDeliveryNote',
  receipt: 'typeReceipt',
  credit_note: 'typeCreditNote',
  debit_note: 'typeDebitNote',
};

export function DocumentUploadDialog({ open, onClose, onSuccess }: Props) {
  const t = useTranslations('documentCenterIntake');
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [documentType, setDocumentType] = useState<DocumentType>('purchase_invoice');
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<UploadPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [result, setResult] = useState<{ batchId: string; status: string } | null>(null);

  const maxSizeLabel = useMemo(() => formatFileSize(MAX_FILE_BYTES), []);

  const reset = useCallback(() => {
    setFiles([]);
    setDragging(false);
    setPhase('idle');
    setError(null);
    setProgressLabel(null);
    setResult(null);
    setDocumentType('purchase_invoice');
    if (fileInput.current) fileInput.current.value = '';
  }, []);

  const handleClose = useCallback(() => {
    if (phase === 'uploading') return;
    reset();
    onClose();
  }, [onClose, phase, reset]);

  function validateSelection(next: File[]): string | null {
    if (next.length === 0) return t('noFiles');
    if (next.length > MAX_FILES_PER_BATCH) return t('tooManyFiles', { max: MAX_FILES_PER_BATCH });
    const invalid = next.find((file) => !isAcceptedFile(file));
    if (invalid) return t('invalidFile', { name: invalid.name });
    return null;
  }

  function acceptFiles(incoming: FileList | File[] | null) {
    if (!incoming || phase === 'uploading') return;
    const list = Array.from(incoming);
    const merged = [...files, ...list].slice(0, MAX_FILES_PER_BATCH);
    const validation = validateSelection(merged);
    setError(validation);
    setFiles(merged);
    setPhase('idle');
    setResult(null);
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    acceptFiles(event.target.files);
    event.target.value = '';
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    acceptFiles(event.dataTransfer.files);
  }

  function removeFile(index: number) {
    if (phase === 'uploading') return;
    const next = files.filter((_, i) => i !== index);
    setFiles(next);
    setError(validateSelection(next));
    setResult(null);
  }

  async function submit() {
    const validation = validateSelection(files);
    if (validation) {
      setError(validation);
      return;
    }

    setPhase('uploading');
    setError(null);
    setProgressLabel(t('creating'));

    try {
      const batch = await runIntake({
        documentType,
        files,
        onProgress: (progress) => {
          if (progress.phase === 'creating') setProgressLabel(t('creating'));
          else if (progress.phase === 'completing') setProgressLabel(t('completing'));
          else if (progress.phase === 'uploading') {
            setProgressLabel(t('uploadingFile', {
              current: progress.currentFile ?? 0,
              total: progress.totalFiles ?? files.length,
              name: progress.fileName ?? '',
            }));
          }
        },
      });
      setResult({ batchId: batch.id, status: batch.status });
      setPhase('success');
      onSuccess(batch.id, batch.status);
    } catch (exception) {
      setPhase('error');
      setError(exception instanceof ApiError ? exception.message : t('uploadFailed'));
    }
  }

  const busy = phase === 'uploading';

  return (
    <Dialog open={open} onClose={handleClose} title={t('uploadTitle')} className="max-w-xl">
      {phase === 'success' && result ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded border border-border bg-surface p-4">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-positive" aria-hidden="true" />
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium text-text">{t('uploadSuccess')}</p>
              <p className="text-sm text-muted">{t('uploadSuccessHint')}</p>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button asChild className="w-full sm:w-auto">
              <Link href={`/documents/${result.batchId}`}>{t('viewBatch')}</Link>
            </Button>
            {result.status === 'received' && (
              <Button asChild variant="outline" className="w-full sm:w-auto">
                <Link href={`/documents/${result.batchId}/diagnostics`}>{t('viewDiagnostics')}</Link>
              </Button>
            )}
            <Button variant="ghost" className="w-full sm:w-auto" onClick={handleClose}>{t('close')}</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted">{t('uploadDescription')}</p>

          <div className="space-y-2">
            <Label htmlFor="document-intake-type">{t('documentType')}</Label>
            <Select
              id="document-intake-type"
              value={documentType}
              disabled={busy}
              onChange={(event) => setDocumentType(event.target.value as DocumentType)}
            >
              {DOCUMENT_TYPES.map((type) => (
                <option key={type} value={type}>{t(DOCUMENT_TYPE_KEYS[type])}</option>
              ))}
            </Select>
          </div>

          <div
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') fileInput.current?.click();
            }}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => fileInput.current?.click()}
            className={cn(
              'flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded border border-dashed border-border bg-surface px-4 py-6 text-center transition-colors',
              dragging && 'border-primary bg-primary/5',
              busy && 'pointer-events-none opacity-60',
            )}
          >
            <Upload className="h-8 w-8 text-muted" aria-hidden="true" />
            <p className="text-sm font-medium text-text">{t('dropzone')}</p>
            <p className="text-xs text-muted">
              {t('dropzoneHint', { maxFiles: MAX_FILES_PER_BATCH, maxSize: maxSizeLabel })}
            </p>
            <Button type="button" variant="outline" size="sm" className="mt-1" disabled={busy}>
              {t('chooseFiles')}
            </Button>
            <input
              ref={fileInput}
              type="file"
              multiple
              className="sr-only"
              accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
              onChange={onFileChange}
              disabled={busy}
            />
          </div>

          {files.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-text">{t('selectedFiles')}</p>
              <ul className="space-y-2">
                {files.map((file, index) => (
                  <li key={`${file.name}-${index}`} className="flex items-center justify-between gap-3 rounded border border-border px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-text">{file.name}</p>
                      <p className="text-xs text-muted">{formatFileSize(file.size)}</p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={busy}
                      aria-label={t('removeFile', { name: file.name })}
                      onClick={(event) => { event.stopPropagation(); removeFile(index); }}
                    >
                      <Trash2 className="h-4 w-4 text-negative" aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded border border-border bg-surface px-3 py-2 text-sm text-negative">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          {busy && progressLabel && (
            <div className="flex items-center gap-2 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              {progressLabel}
            </div>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" disabled={busy} onClick={handleClose}>{t('cancel')}</Button>
            <Button type="button" disabled={busy || files.length === 0} onClick={() => void submit()}>
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  {t('uploading')}
                </>
              ) : t('submit')}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
