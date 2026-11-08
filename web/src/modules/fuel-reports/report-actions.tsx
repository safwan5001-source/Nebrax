'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Download, FileSpreadsheet, FileText, Printer, Share2 } from 'lucide-react';
import { useCompany } from '@/lib/company';
import { currentUser } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { blobFromObjectUrl, downloadBlob, openForPrint, shareBlob } from '@/modules/station-ops/receiving/documents/share';
import { auditAction, downloadExport, exportBlobUrl, XLSX_MIME, type ReportFilters } from './client';
import type { Lang } from './format';
import { createReportPdf, defaultPaper, isThermal, REPORT_PAPERS, type Paper } from './report-pdf';
import type { ReportPayload } from './schemas';

/**
 * أزرار المعاينة والطباعة والتصدير والمشاركة لتقرير وقود. PDF يُرسم هنا من الحمولة المعروضة نفسها (فلا اختلاف بين الشاشة وPDF)، وExcel/CSV من الخادم من
 * الحمولة ذاتها (مع التدقيق). لا ملف يُنشأ إلا بضغطة صريحة؛ قفل ضغط مكرر؛ حالة نجاح/فشل ظاهرة بنص.
 * الطباعة الحرارية 58/80مم: مقاس ورق في ملف PDF يُطبع عبر نافذة الطباعة/AirPrint — لا ادّعاء بطابعة Bluetooth مباشرة.
 */
type Action = 'print' | 'pdf' | 'pdf-share' | 'xlsx' | 'xlsx-share' | 'csv';
type Notice = { tone: 'ok' | 'error'; key: string } | null;

export function ReportActions({ payload, filters, lang }: { payload: ReportPayload; filters: ReportFilters; lang: Lang }) {
  const t = useTranslations('fuelReports');
  const company = useCompany();
  const [paper, setPaper] = useState<Paper>(() => defaultPaper(payload.report.orientation));
  const [busy, setBusy] = useState<Action | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const lock = useRef(false);
  const key = payload.report.key;
  const stamp = new Date().toISOString().slice(0, 10);
  const base = `fuel-${key.replace('.', '-')}-${payload.period ? `${payload.period.from}_${payload.period.to}` : stamp}-${lang}`;
  const empty = payload.tables.every((table) => table.rows.length === 0) && payload.summary.length === 0;

  const makePdf = () => createReportPdf(payload, {
    lang, paper, generatedBy: currentUser()?.name ?? null,
    company: { name: company?.name ?? payload.tenant.name, vat: company?.vat_number ?? null, cr: company?.cr_number ?? null, logo: company?.logo ?? null },
  });

  const run = async (action: Action) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(action);
    setNotice(null);
    try {
      if (action === 'print' || action === 'pdf' || action === 'pdf-share') {
        const blob = await makePdf();
        const name = `${base}-${paper}.pdf`;
        let delivered = true;
        if (action === 'pdf') { downloadBlob(blob, name); setNotice({ tone: 'ok', key: 'downloaded' }); }
        else if (action === 'print') {
          delivered = openForPrint(blob);
          setNotice(delivered ? { tone: 'ok', key: 'opened' } : { tone: 'error', key: 'popupBlocked' });
        } else {
          const outcome = await shareBlob(blob, name, 'application/pdf', payload.report.title[lang]);
          delivered = outcome !== 'cancelled';
          setNotice(delivered ? { tone: 'ok', key: outcome === 'shared' ? 'shared' : 'downloaded' } : null);
        }
        // تدقيق طباعة/PDF/مشاركة حساسة: يُسجَّل فقط ما سُلِّم فعلاً (فشل التدقيق لا يمنع المستخدم).
        if (delivered) void auditAction(key, action === 'print' ? 'print' : action === 'pdf' ? 'pdf' : 'share', filters);
      } else if (action === 'xlsx' || action === 'csv') {
        const outcome = await downloadExport(key, filters, action, lang, `${base}.${action}`);
        setNotice(outcome === 'downloaded' ? { tone: 'ok', key: 'downloaded' } : { tone: 'error', key: 'demo' });
      } else {
        const url = await exportBlobUrl(key, filters, 'xlsx', lang);
        const outcome = await shareBlob(await blobFromObjectUrl(url), `${base}.xlsx`, XLSX_MIME, payload.report.title[lang]);
        setNotice(outcome === 'cancelled' ? null : { tone: 'ok', key: outcome === 'shared' ? 'shared' : 'downloaded' });
      }
    } catch (error) {
      const status = (error as { status?: number })?.status;
      setNotice({ tone: 'error', key: status === 403 ? 'forbidden' : status === 404 ? 'notFound' : status === 422 ? 'tooLarge' : 'failed' });
    } finally {
      lock.current = false;
      setBusy(null);
    }
  };

  const button = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-[12px] border border-[color:var(--fo-control,var(--border))] bg-surface px-3 text-sm font-semibold text-text hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50';
  const item = (action: Action, Icon: typeof Printer, label: string) => (
    <button key={action} type="button" data-report-action={action} disabled={busy !== null || empty} aria-busy={busy === action} onClick={() => void run(action)} className={button}>
      <Icon aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={1.8} />{busy === action ? t('working') : label}
    </button>
  );

  // المقاسات من منصة المستندات؛ الحراري للتقارير الصغيرة (إقفال/تسليم/قراءات) فقط.
  const papers: Paper[] = REPORT_PAPERS.filter((p) => !isThermal(p) || payload.report.thermal);

  return (
    <div className="space-y-3" data-report-actions="">
      {papers.length > 1 ? (
        <div role="radiogroup" aria-label={t('paper')} className="grid grid-cols-2 gap-2">
          {papers.map((value) => (
            <button key={value} type="button" role="radio" aria-checked={paper === value} data-paper={value} onClick={() => setPaper(value)}
              className={cn('min-h-12 rounded-lg border px-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary', paper === value ? 'border-primary bg-primary-soft text-primary' : 'border-[color:var(--fo-control,var(--border))] text-text')}>
              {t(`paper_${value}`)}
            </button>
          ))}
        </div>
      ) : null}
      {isThermal(paper) ? <p className="text-xs leading-5 text-muted">{t('thermalNote')}</p> : null}

      <div>
        <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted"><FileText aria-hidden="true" className="h-4 w-4" />PDF</p>
        <div className="grid grid-cols-3 gap-2">
          {item('print', Printer, t('previewPrint'))}
          {item('pdf', Download, t('download'))}
          {item('pdf-share', Share2, t('share'))}
        </div>
      </div>
      <div>
        <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted"><FileSpreadsheet aria-hidden="true" className="h-4 w-4" />Excel / CSV</p>
        <div className="grid grid-cols-3 gap-2">
          {item('xlsx', Download, 'Excel')}
          {item('xlsx-share', Share2, t('shareExcel'))}
          {item('csv', Download, 'CSV')}
        </div>
      </div>

      {empty ? <p className="text-xs text-muted">{t('nothingToExport')}</p> : null}
      {notice ? (
        <p role={notice.tone === 'error' ? 'alert' : 'status'} data-report-notice={notice.tone}
          className={cn('rounded-[12px] p-3 text-sm leading-6', notice.tone === 'error' ? 'bg-[color:var(--fo-negative-tint,rgba(220,38,38,.08))] text-negative' : 'bg-[color:var(--fo-positive-tint,rgba(22,163,74,.08))] text-positive')}>{t(`notice.${notice.key}`)}</p>
      ) : null}
    </div>
  );
}
