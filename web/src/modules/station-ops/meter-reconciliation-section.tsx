'use client';

import { useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CircleAlert, CircleCheck, Info, RefreshCw } from 'lucide-react';
import { useMeterReconciliation } from './data';
import { formatLitersFixedFromMl } from './format';
import { classificationOptions, isKnownClassification, needsReview, type MeterNozzle, type MeterReconciliation, varianceKind } from './meter-reconciliation';
import { Quantity } from './quantity';
import type { Station } from './schemas';
import { opsWriteReviewMeterVariance, type MeterReviewWriteResult } from './write-client';
import { WriteNotice } from './write-ui';

/**
 * مطابقة قراءات الفوهات (TANKER-PR8) داخل شاشتَي التسليم (حيّة قبل الإغلاق) والمراجعة (لقطة مجمَّدة بعده).
 *
 * - **كل رقم وحالة من الخادم**: الواجهة لا تحسب ولا تستنتج. فرق العدّاد = مبيعات مباشرة + تعبئة صهاريج + غير مفسَّر.
 * - تعبئة الصهريج **ليست بيعاً** (لا نقداً ولا شبكة)؛ القسم تشغيلي ولا يغيّر مخزوناً ولا مبالغ.
 * - التصنيف قرار وصفي واحد ثابت لكل فرق، يسجّله من يملك مراجعة فروق العدّادات (الخادم يقرّر `can_review`؛ لا نخمّنه من الدور).
 * - **لا إعادة إرسال تلقائية**: نتيجة غير مؤكدة ⇒ يُعاد جلب الحالة من الخادم (لا يُرسَل التصنيف عمياً مرة ثانية).
 * - البوابة مغلقة (404) أو لا صلاحية ⇒ لا شيء يُعرض والشاشة كما كانت حرفياً.
 */
export function MeterReconciliationSection({ station, shiftId }: { station: Station; shiftId: string }) {
  const { allowed, state, retained, reload } = useMeterReconciliation(station, shiftId);
  const t = useTranslations('stationOps');
  const data = state.status === 'success' ? state.data : retained;
  const error = state.status === 'error' ? state.error : null;

  if (!allowed) return null;
  if (error && (error.kind === 'forbidden' || error.kind === 'not_found' || error.kind === 'unauthorized' || error.kind === 'demo')) return null;
  if (data === null) {
    if (error) return <p role="status" data-meter-recon-error="" className="text-sm text-warning">{t('meterRecon.unavailable')}</p>;
    return null; // تحميل أول مرة
  }
  if (data.nozzles.length === 0) return null;

  return <Body station={station} shiftId={shiftId} data={data} refreshing={state.status === 'loading'} stale={error !== null} onReload={reload} />;
}

function Body({ station, shiftId, data, refreshing, stale, onReload }: { station: Station; shiftId: string; data: MeterReconciliation; refreshing: boolean; stale: boolean; onReload: () => void }) {
  const t = useTranslations('stationOps');
  const pending = data.summary.pending_review;

  return (
    <section aria-labelledby="fo-meter-recon-h" data-meter-recon={data.frozen ? 'frozen' : 'live'} data-meter-recon-pending={pending} className="space-y-4 rounded-[14px] border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="fo-meter-recon-h" className="text-base font-semibold text-text">{t('meterRecon.title')}</h2>
          <p className="mt-0.5 flex items-start gap-1.5 text-xs leading-5 text-muted"><Info aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />{t('meterRecon.note')}</p>
          <p className="mt-0.5 text-xs text-muted">{data.frozen ? t('meterRecon.frozenHint') : t('meterRecon.liveHint')}</p>
        </div>
        <button type="button" onClick={onReload} disabled={refreshing} data-meter-recon-refresh="" aria-label={t('meterRecon.refresh')} title={t('meterRecon.refresh')} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[color:var(--fo-control)] text-muted hover:bg-primary-soft disabled:opacity-50">
          <RefreshCw aria-hidden="true" className={refreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} strokeWidth={1.8} />
        </button>
      </div>

      {stale ? <p role="status" data-meter-recon-stale="" className="flex items-start gap-2 text-sm leading-6 text-warning"><CircleAlert aria-hidden="true" className="mt-1 h-4 w-4 shrink-0" strokeWidth={1.8} />{t('meterRecon.unavailable')}</p> : null}

      <SummaryLine data={data} pending={pending} />

      <ul className="divide-y divide-border" data-meter-recon-rows="">
        {data.nozzles.map((row) => (
          <NozzleRow key={row.nozzle_id} row={row} data={data} station={station} shiftId={shiftId} onReviewed={onReload} />
        ))}
      </ul>
    </section>
  );
}

/** ملخص الحالة: «كلها مطابقة» لا تُعلَن إلا إن لم يوجد فرق ولا قراءة ناقصة؛ ولقطة حيّة بفروق تُعلَن بوضوح (لا مراجعة قبل الإغلاق، فلا يعني `pending = 0` المطابقة). */
function SummaryLine({ data, pending }: { data: MeterReconciliation; pending: number }) {
  const t = useTranslations('stationOps');
  const differences = data.summary.variance_nozzles + data.summary.incomplete_nozzles;
  let state: 'pending' | 'live_differences' | 'reviewed' | 'clear';
  if (pending > 0) state = 'pending';
  else if (differences > 0) state = data.frozen ? 'reviewed' : 'live_differences';
  else state = 'clear';
  const warn = state === 'pending' || state === 'live_differences';

  return (
    <p className="flex items-center gap-2 text-sm font-semibold text-text" data-meter-recon-summary={state}>
      {warn
        ? <CircleAlert aria-hidden="true" className="h-4 w-4 shrink-0 text-warning" strokeWidth={1.9} />
        : <CircleCheck aria-hidden="true" className="h-4 w-4 shrink-0 text-positive" strokeWidth={1.9} />}
      {state === 'pending' ? t('meterRecon.pendingReview', { count: pending })
        : state === 'live_differences' ? t('meterRecon.liveDifferences', { count: differences })
        : state === 'reviewed' ? t('meterRecon.reviewDone')
        : t('meterRecon.allMatched')}
    </p>
  );
}

function statusTone(status: MeterNozzle['status']): string {
  if (status === 'balanced') return 'text-positive';
  if (status === 'within_tolerance') return 'text-muted';
  return 'text-warning';
}

function NozzleRow({ row, data, station, shiftId, onReviewed }: { row: MeterNozzle; data: MeterReconciliation; station: Station; shiftId: string; onReviewed: () => void }) {
  const t = useTranslations('stationOps');
  const locale = useLocale();
  const liters = (ml: number | null) => (ml === null ? '—' : formatLitersFixedFromMl(ml, locale));
  const unit = t('unit.liter');
  const kind = varianceKind(row);
  const showDirection = row.status === 'variance';

  return (
    <li className="space-y-2 py-3 text-sm" data-meter-nozzle={row.nozzle_id} data-meter-status={row.status} data-meter-review={row.review ? 'reviewed' : needsReview(row) ? 'pending' : 'none'}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-text">{t('meterRecon.nozzle', { number: String(row.nozzle_number ?? '—') })}</span>
        <span className={`text-xs font-semibold ${statusTone(row.status)}`} data-meter-status-label="">{t(`meterRecon.status.${row.status}`)}</span>
      </div>

      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted">{t('meterRecon.field.meter')}</dt>
        <dd className="text-end text-text"><Quantity value={liters(row.metered_milliliters)} unit={unit} /></dd>
        <dt className="text-muted">{t('meterRecon.field.direct')}</dt>
        <dd className="text-end text-text"><Quantity value={liters(row.direct_sale_milliliters)} unit={unit} /></dd>
        <dt className="text-muted">{t('meterRecon.field.tanker')}{row.tanker_fill_count > 0 ? <span className="ms-1 text-xs">({t('meterRecon.field.tankerCount', { count: row.tanker_fill_count })})</span> : null}</dt>
        <dd className="text-end text-text" data-meter-tanker=""><Quantity value={liters(row.tanker_fill_milliliters)} unit={unit} /></dd>
        <dt className="font-semibold text-text">{t('meterRecon.field.unexplained')}</dt>
        <dd className={`text-end font-semibold ${row.status === 'variance' || row.status === 'incomplete' ? 'text-warning' : 'text-text'}`} data-meter-unexplained=""><Quantity value={liters(row.unexplained_milliliters)} unit={unit} /></dd>
        {row.draft_sale_milliliters > 0 ? <><dt className="text-xs text-muted">{t('meterRecon.field.draft')}</dt><dd className="text-end text-xs text-muted"><Quantity value={liters(row.draft_sale_milliliters)} unit={unit} /></dd></> : null}
      </dl>

      {row.status === 'incomplete' && row.incompleteness ? <p className="flex items-start gap-1.5 text-xs leading-5 text-warning"><CircleAlert aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />{t(`meterRecon.incomplete.${row.incompleteness === 'closing_below_opening' ? 'closing_below_opening' : 'missing_reading'}`)}</p> : null}
      {showDirection ? <p className="text-xs leading-5 text-warning" data-meter-direction={kind}>{kind === 'over_recorded' ? t('meterRecon.direction.over') : t('meterRecon.direction.surplus')}</p> : null}

      {row.review ? (
        <p className="flex items-start gap-1.5 text-xs leading-5 text-muted" data-meter-reviewed={row.review.classification}>
          <CircleCheck aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-positive" strokeWidth={1.8} />
          <span>{t('meterRecon.review.reviewedAs')} <strong className="text-text">{isKnownClassification(row.review.classification) ? t(`meterRecon.class.${row.review.classification}`) : row.review.classification}</strong>{row.review.note ? ` — ${row.review.note}` : ''}</span>
        </p>
      ) : null}

      {needsReview(row) ? (
        data.can_review
          ? <ReviewForm row={row} data={data} station={station} shiftId={shiftId} onReviewed={onReviewed} />
          : <p className="text-xs text-muted" data-meter-no-permission="">{t('meterRecon.review.noPermission')}</p>
      ) : null}
    </li>
  );
}

function ReviewForm({ row, data, station, shiftId, onReviewed }: { row: MeterNozzle; data: MeterReconciliation; station: Station; shiftId: string; onReviewed: () => void }) {
  const t = useTranslations('stationOps');
  const options = classificationOptions(row, data.review_classifications);
  const [classification, setClassification] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Exclude<MeterReviewWriteResult, { kind: 'ok' }> | null>(null);
  const sending = useRef(false);
  const noteMissing = classification === 'other' && note.trim().length < 3;
  const canSubmit = classification !== '' && !noteMissing && !busy;

  const submit = async () => {
    if (sending.current || !canSubmit) return;
    sending.current = true;
    setBusy(true);
    setFailure(null);
    try {
      const body = { nozzle_id: row.nozzle_id, classification, ...(note.trim() ? { note: note.trim() } : {}) };
      const result = await opsWriteReviewMeterVariance(shiftId, body, { branchId: station.branch_id });
      if (result.kind === 'ok') {
        onReviewed();
        return;
      }
      setFailure(result);
      // رفض أو نتيجة غير مؤكدة: تُحدَّث الحالة من الخادم (لا نعيد الإرسال عمياً).
      if (result.kind !== 'not_sent') onReviewed();
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  const fieldId = `fo-mv-${row.nozzle_id}`;

  return (
    <div className="space-y-2 rounded-lg bg-[color:var(--fo-warning-tint)] p-3" data-meter-review-form={row.nozzle_id}>
      <p className="text-sm font-semibold text-text">{t('meterRecon.review.title')}</p>
      <label htmlFor={`${fieldId}-c`} className="block text-xs text-muted">{t('meterRecon.review.classification')}</label>
      <select id={`${fieldId}-c`} value={classification} onChange={(event) => setClassification(event.target.value)} disabled={busy} data-meter-class-select="" className="h-11 w-full rounded-lg border border-[color:var(--fo-control)] bg-surface px-3 text-base text-text">
        <option value="">{t('meterRecon.review.choose')}</option>
        {options.map((value) => <option key={value} value={value}>{isKnownClassification(value) ? t(`meterRecon.class.${value}`) : value}</option>)}
      </select>
      <label htmlFor={`${fieldId}-n`} className="block text-xs text-muted">{t('meterRecon.review.note')}</label>
      <textarea id={`${fieldId}-n`} value={note} onChange={(event) => setNote(event.target.value)} disabled={busy} maxLength={500} rows={2} data-meter-note="" className="w-full rounded-lg border border-[color:var(--fo-control)] bg-surface px-3 py-2 text-base text-text" />
      {noteMissing ? <p className="text-xs text-warning" data-meter-note-required="">{t('meterRecon.review.noteRequired')}</p> : null}
      <p className="text-xs leading-5 text-muted">{t('meterRecon.review.descriptive')}</p>
      <WriteNotice result={failure} />
      <button type="button" onClick={() => void submit()} disabled={!canSubmit} data-meter-review-submit="" className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-[color:var(--fo-cta-bg)] px-4 text-base font-semibold text-[color:var(--fo-cta-fg)] disabled:opacity-50">
        {busy ? t('meterRecon.review.sending') : t('meterRecon.review.submit')}
      </button>
    </div>
  );
}
