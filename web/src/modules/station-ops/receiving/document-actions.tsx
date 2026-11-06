'use client';

import { useRef, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Download, FileSpreadsheet, FileText, Printer, Share2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StationOpsError } from '../read-client';
import { useReceivingAccess } from './data';
import { reportLabels, receiptLabels } from './documents/labels';
import { createReceiptPdf } from './documents/receipt-pdf';
import { createReportPdf } from './documents/report-pdf';
import { blobFromObjectUrl, downloadBlob, openForPrint, shareBlob } from './documents/share';
import {
  XLSX_MIME, downloadReceiptExcel, downloadReportExcel, getReceiptDocument, getReceiptReport, receiptExcelUrl, reportExcelUrl,
  type ReceivingExportVariant, type ReceivingQuery,
} from './receiving-client';

/**
 * FUEL-B5.1 — طباعة وتنزيل ومشاركة سند الاستلام/الكشف بصيغتي PDF وExcel.
 *
 * - **النسخة يحكمها الخادم**: التشغيلية افتراضية بلا أي مبلغ؛ المالية تظهر خيارًا لمن `products.view_cost` فقط، والخادم يردّها 403 لغيره
 *   (فلا يكفي تلاعب الواجهة). الـPDF يُرسم هنا من حمولة الخادم نفسها (لا حساب ولا مبلغ من الواجهة)، وExcel يُولَّد في الخادم.
 * - لا ملف يُنشأ إلا بضغطة صريحة؛ لا إنشاء تلقائي. قفل ضغط مكرر أثناء العمل. فشل صريح بنص لا صامت.
 */
export type DocTarget = { kind: 'receipt'; deliveryId: string; reference: string } | { kind: 'report'; query: ReceivingQuery };

type Action = 'pdf-print' | 'pdf-download' | 'pdf-share' | 'xlsx-download' | 'xlsx-share';

export function DocumentActions({ target, branchId }: { target: DocTarget; branchId?: string | null }) {
  const t = useTranslations('stationOps');
  const locale = useLocale();
  const access = useReceivingAccess();
  const [variant, setVariant] = useState<ReceivingExportVariant>('operational');
  const [busy, setBusy] = useState<Action | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; key: string } | null>(null);
  const lock = useRef(false);

  const stamp = new Date().toISOString().slice(0, 10);
  const base = target.kind === 'receipt' ? `fuel-receipt-${target.reference}-${variant}-${stamp}` : `fuel-receipts-${variant}-${stamp}`;

  const makePdf = async (): Promise<Blob> => {
    const tt = t as unknown as (key: string) => string;
    if (target.kind === 'receipt') return createReceiptPdf(await getReceiptDocument(target.deliveryId, variant, { branchId }), receiptLabels(tt), locale);
    return createReportPdf(await getReceiptReport(target.query, variant, { branchId }), reportLabels(tt), locale);
  };

  const run = async (action: Action) => {
    if (lock.current) return; // قفل ضغط مكرر
    lock.current = true;
    setBusy(action);
    setMessage(null);
    try {
      if (action.startsWith('pdf')) {
        const blob = await makePdf();
        const name = `${base}.pdf`;
        if (action === 'pdf-download') { downloadBlob(blob, name); setMessage({ tone: 'ok', key: 'receiving.docs.downloaded' }); }
        else if (action === 'pdf-print') setMessage(openForPrint(blob) ? { tone: 'ok', key: 'receiving.docs.opened' } : { tone: 'error', key: 'receiving.docs.popupBlocked' });
        else {
          const outcome = await shareBlob(blob, name, 'application/pdf', t('receiving.doc.title'));
          setMessage(outcome === 'cancelled' ? null : { tone: 'ok', key: outcome === 'shared' ? 'receiving.docs.shared' : 'receiving.docs.downloaded' });
        }
      } else if (action === 'xlsx-download') {
        const outcome = target.kind === 'receipt' ? await downloadReceiptExcel(target.deliveryId, variant, `${base}.xlsx`) : await downloadReportExcel(target.query, variant, `${base}.xlsx`);
        setMessage(outcome === 'downloaded' ? { tone: 'ok', key: 'receiving.docs.downloaded' } : { tone: 'error', key: 'receiving.docs.demo' });
      } else {
        const url = target.kind === 'receipt' ? await receiptExcelUrl(target.deliveryId, variant) : await reportExcelUrl(target.query, variant);
        const outcome = await shareBlob(await blobFromObjectUrl(url), `${base}.xlsx`, XLSX_MIME, t('receiving.doc.title'));
        setMessage(outcome === 'cancelled' ? null : { tone: 'ok', key: outcome === 'shared' ? 'receiving.docs.shared' : 'receiving.docs.downloaded' });
      }
    } catch (error) {
      const status = (error as { status?: number })?.status ?? (error instanceof StationOpsError ? error.status : undefined);
      setMessage({ tone: 'error', key: status === 403 ? 'receiving.docs.forbidden' : status === 404 ? 'receiving.docs.notFound' : 'receiving.docs.failed' });
    } finally {
      lock.current = false;
      setBusy(null);
    }
  };

  const button = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-[12px] border border-[color:var(--fo-control)] bg-surface px-3 text-sm font-semibold text-text hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50';
  const item = (action: Action, Icon: typeof Printer, label: string) => (
    <button key={action} type="button" data-doc-action={action} disabled={busy !== null} aria-busy={busy === action} onClick={() => void run(action)} className={button}>
      <Icon aria-hidden="true" className="h-4.5 w-4.5" strokeWidth={1.8} />{busy === action ? t('receiving.docs.working') : label}
    </button>
  );

  return (
    <div className="space-y-3" data-doc-actions="">
      {access.seeCost ? (
        <div role="radiogroup" aria-label={t('receiving.docs.variant')} className="grid grid-cols-2 gap-2">
          {(['operational', 'financial'] as const).map((value) => (
            <button key={value} type="button" role="radio" aria-checked={variant === value} data-variant={value} onClick={() => { setVariant(value); setMessage(null); }}
              className={cn('min-h-12 rounded-lg border px-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary', variant === value ? 'border-primary bg-primary-soft text-primary' : 'border-[color:var(--fo-control)] text-text')}>
              {t(`receiving.docs.variant_${value}`)}
            </button>
          ))}
        </div>
      ) : null}
      <p className="text-xs leading-5 text-muted">{variant === 'financial' ? t('receiving.docs.financialNote') : t('receiving.docs.operationalNote')}</p>

      <div>
        <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted"><FileText aria-hidden="true" className="h-4 w-4" />PDF</p>
        <div className="grid grid-cols-3 gap-2">
          {item('pdf-print', Printer, t('receiving.docs.print'))}
          {item('pdf-download', Download, t('receiving.docs.download'))}
          {item('pdf-share', Share2, t('receiving.docs.share'))}
        </div>
      </div>
      <div>
        <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted"><FileSpreadsheet aria-hidden="true" className="h-4 w-4" />Excel</p>
        <div className="grid grid-cols-2 gap-2">
          {item('xlsx-download', Download, t('receiving.docs.download'))}
          {item('xlsx-share', Share2, t('receiving.docs.share'))}
        </div>
      </div>

      {message ? (
        <p role={message.tone === 'error' ? 'alert' : 'status'} data-doc-message={message.tone} className={cn('rounded-[12px] p-3 text-sm leading-6', message.tone === 'error' ? 'bg-[color:var(--fo-negative-tint)] text-negative' : 'bg-[color:var(--fo-positive-tint)] text-positive')}>{t(message.key)}</p>
      ) : null}
    </div>
  );
}
