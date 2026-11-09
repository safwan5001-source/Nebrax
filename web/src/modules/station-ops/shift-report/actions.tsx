'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CircleCheck, Download, Eye, FileText, Printer, Share2 } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { useCompany } from '@/lib/company';
import { cn } from '@/lib/utils';
import type { StationAssetsResult } from '../data';
import { useShiftCollection } from '../data';
import { useStationOps } from '../context';
import { StationOpsError } from '../read-client';
import { downloadBlob, openForPrint, shareBlob } from '../receiving/documents/share';
import type { ShiftDetail, Station } from '../schemas';
import { SectionCard } from '../write-ui';
import { buildShiftReport, isReportableShift, type ReportPaper, type ShiftReportModel } from './model';
import { createShiftReportPdf } from './pdf';
import { ShiftReportPreview } from './preview';

/**
 * AWJ-DOC-V2-PR7 — إجراءات تقرير إغلاق الوردية (معاينة · طباعة · تنزيل PDF · مشاركة) **من صفحة الوردية نفسها**.
 *
 * - **للقراءة فقط:** لا كتابة ولا تغيير حالة ولا إعادة إغلاق؛ البيانات من قراءات الوردية القائمة (تفاصيل الوردية + لقطة التحصيل + أصول المحطة)
 *   بصلاحيات المستخدم نفسها، فمن لا يرى المبالغ لا يجدها في الحمولة ولا في التقرير (الخادم يحذفها).
 * - **لا يظهر تقرير «مغلق» قبل تأكيد الخادم:** المكوّن لا يُعرض إلا لوردية حالتها `closed|approved` من ردّ الخادم نفسه (`isReportableShift`).
 * - لا ملف يُنشأ إلا بضغطة صريحة، وقفل ضغط مكرر أثناء العمل، وفشل صريح بنص لا صامت. الطباعة عبر نافذة الطباعة للنظام (لا طباعة صامتة).
 * - بيانات التحصيل المتأخرة/الفاشلة لا تُخفى: تحميل ⇒ الأزرار معطّلة؛ انقطاع/خطأ خادم ⇒ رسالة وإعادة محاولة؛ غير متاح/بلا صلاحية ⇒ التقرير
 *   يُعلن المبالغ «غير متاحة» ولا يختلق شيئاً.
 */

export const SHIFT_REPORT_PAPER_KEY = 'awj.shift-report.paper';

/** تفضيل الجهاز المحلي فقط (لا خادم): غيابه أو تعذّر التخزين = A4. */
function readPaper(): ReportPaper {
  try { return window.localStorage.getItem(SHIFT_REPORT_PAPER_KEY) === 'a5' ? 'a5' : 'a4'; } catch { return 'a4'; }
}
function rememberPaper(paper: ReportPaper): void {
  try { window.localStorage.setItem(SHIFT_REPORT_PAPER_KEY, paper); } catch { /* تخزين محجوب: يبقى الاختيار لهذه الجلسة */ }
}

type Action = 'preview' | 'print' | 'download' | 'share';

export function ShiftReportActions({ station, detail, assets, justClosed = false }: { station: Station; detail: ShiftDetail; assets: StationAssetsResult; justClosed?: boolean }) {
  // لا تقرير لوردية غير مغلقة (لا يُنشأ ولا يُعرض قبل تأكيد الخادم للإغلاق).
  if (!isReportableShift(detail.status)) return null;
  return <Inner station={station} detail={detail} assets={assets} justClosed={justClosed} />;
}

function Inner({ station, detail, assets, justClosed }: { station: Station; detail: ShiftDetail; assets: StationAssetsResult; justClosed: boolean }) {
  const tt = useTranslations('stationOps');
  const locale = useLocale();
  const { viewer } = useStationOps();
  const company = useCompany();
  const collectionQuery = useShiftCollection(station, detail.id);
  const [paper, setPaper] = useState<ReportPaper>('a4');
  const [busy, setBusy] = useState<Action | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; key: string } | null>(null);
  const [preview, setPreview] = useState<ShiftReportModel | null>(null);
  const lock = useRef(false);
  useEffect(() => { setPaper(readPaper()); }, []); // بعد التركيب فقط: لا اختلاف ترطيب

  const t = (key: string) => tt(`shiftReport.${key}`);

  // جاهزية البيانات: ننتظر الأصول (أسماء الفوهات) ولقطة التحصيل. غير المتاح/بلا صلاحية = «غير متاح» لا صفراً؛ انقطاع/خطأ خادم = إعادة محاولة.
  const collectionState = collectionQuery.state;
  const collectionFailed = collectionState.status === 'error' && !(collectionState.error instanceof StationOpsError && (collectionState.error.kind === 'not_found' || collectionState.error.kind === 'forbidden'));
  const loading = assets.state.status === 'loading' || collectionState.status === 'loading';
  const loadFailed = assets.state.status === 'error' || collectionFailed;
  const collection = collectionState.status === 'success' ? collectionState.data : null;
  const ready = !loading && !loadFailed && assets.catalog !== null;

  const build = (): ShiftReportModel => buildShiftReport({
    t, company, station, detail, catalog: assets.catalog, collection, paper,
    viewer: { id: viewer.id, name: viewer.name }, generatedAt: new Date(),
  });

  const run = async (action: Action) => {
    if (lock.current || !ready) return; // قفل ضغط مكرر
    lock.current = true;
    setBusy(action);
    setMessage(null);
    try {
      const model = build();
      if (action === 'preview') { setPreview(model); return; }
      const blob = await createShiftReportPdf(model, locale);
      if (action === 'download') { downloadBlob(blob, model.fileName); setMessage({ tone: 'ok', key: 'downloaded' }); }
      else if (action === 'print') setMessage(openForPrint(blob) ? { tone: 'ok', key: 'opened' } : { tone: 'error', key: 'popupBlocked' });
      else {
        const outcome = await shareBlob(blob, model.fileName, 'application/pdf', model.title);
        setMessage(outcome === 'cancelled' ? null : { tone: 'ok', key: outcome === 'shared' ? 'shared' : 'downloaded' });
      }
    } catch {
      setMessage({ tone: 'error', key: 'failed' });
    } finally {
      lock.current = false;
      setBusy(null);
    }
  };

  const button = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-[12px] border border-[color:var(--fo-control)] bg-surface px-3 text-sm font-semibold text-text hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50';
  const item = (action: Action, Icon: typeof Printer, label: string) => (
    <button key={action} type="button" data-report-action={action} disabled={!ready || busy !== null} aria-busy={busy === action} onClick={() => void run(action)} className={button}>
      <Icon aria-hidden="true" className="h-4.5 w-4.5" strokeWidth={1.8} />{busy === action && action !== 'preview' ? t('actions.working') : label}
    </button>
  );

  return (
    <SectionCard>
      <div data-shift-report-actions="" data-just-closed={justClosed ? 'true' : 'false'} className="space-y-3">
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[color:var(--fo-positive-tint)] text-positive">{justClosed ? <CircleCheck className="h-6 w-6" strokeWidth={1.9} /> : <FileText className="h-5 w-5" strokeWidth={1.8} />}</span>
          <div className="min-w-0">
            <h2 className="text-base font-bold text-text">{justClosed ? t('actions.justClosedTitle') : t('actions.title')}</h2>
            <p className="mt-1 text-sm leading-6 text-muted">{justClosed ? t('actions.justClosedBody') : t('actions.lead')}</p>
          </div>
        </div>

        <div role="radiogroup" aria-label={t('actions.paper')} data-paper-group="" className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
          {(['a4', 'a5'] as const).map((value) => (
            <button key={value} type="button" role="radio" aria-checked={paper === value} data-paper={value} onClick={() => { setPaper(value); rememberPaper(value); setMessage(null); }}
              className={cn('min-h-12 rounded-lg border px-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary', paper === value ? 'border-primary bg-primary-soft text-primary' : 'border-[color:var(--fo-control)] text-text')}>
              {t(value === 'a4' ? 'actions.paperA4' : 'actions.paperA5')}
            </button>
          ))}
        </div>

        {loading ? <p role="status" data-report-loading="" className="text-xs text-muted">{t('actions.loading')}</p> : null}
        {loadFailed ? (
          <div role="alert" data-report-load-failed="" className="space-y-2 rounded-[12px] bg-[color:var(--fo-negative-tint)] p-3 text-sm leading-6 text-negative">
            <p>{t('actions.loadFailed')}</p>
            <button type="button" onClick={() => { if (assets.state.status === 'error') assets.reload(); if (collectionFailed) collectionQuery.reload(); }} className="min-h-11 rounded-lg border border-negative px-3 text-sm font-semibold">{tt('retry')}</button>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-2">
          {item('preview', Eye, t('actions.preview'))}
          {item('print', Printer, t('actions.print'))}
          {item('download', Download, t('actions.download'))}
          {item('share', Share2, t('actions.share'))}
        </div>
        <p className="text-xs leading-5 text-muted">{t('actions.printNote')}</p>

        {message ? (
          <p role={message.tone === 'error' ? 'alert' : 'status'} data-report-message={message.tone} className={cn('rounded-[12px] p-3 text-sm leading-6', message.tone === 'error' ? 'bg-[color:var(--fo-negative-tint)] text-negative' : 'bg-[color:var(--fo-positive-tint)] text-positive')}>{t(`actions.${message.key}`)}</p>
        ) : null}
      </div>

      <Dialog open={preview !== null} onClose={() => setPreview(null)} title={t('actions.previewTitle')} closeLabel={t('actions.closePreview')} className="max-w-2xl">
        {preview ? (
          <div className="space-y-3" data-report-preview-dialog="">
            <ShiftReportPreview model={preview} />
            <div className="grid grid-cols-2 gap-2 border-t border-border pt-3">
              {(['print', 'download'] as const).map((action) => (
                <button key={action} type="button" data-report-action={`${action}-preview`} disabled={busy !== null} onClick={() => void run(action)} className={button}>
                  {action === 'print' ? <Printer aria-hidden="true" className="h-4.5 w-4.5" strokeWidth={1.8} /> : <Download aria-hidden="true" className="h-4.5 w-4.5" strokeWidth={1.8} />}
                  {t(action === 'print' ? 'actions.print' : 'actions.download')}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </Dialog>
    </SectionCard>
  );
}
