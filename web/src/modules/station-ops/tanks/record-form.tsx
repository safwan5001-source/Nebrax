'use client';

import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CheckCircle2, Hourglass } from 'lucide-react';
import { millilitersToLiters } from '@/lib/fuel-quantity';
import { createIntentStore } from '../intents';
import { useStationOps } from '../context';
import type { Station } from '../schemas';
import { ConfirmDialog, NumberField, PrimaryButton, SecondaryButton, SectionCard } from '../write-ui';
import { FailureNotice, type AnyFailure } from '../receiving/parts';
import { recordReading, type WriteFailure } from '../receiving/receiving-client';
import { SwitchRow } from '../admin/ui';
import { formatLitersFixedFromMl, formatStampInZone } from '../format';
import { evaluateLateTime, evaluateReading, evidenceBody, methodsFor, percentText, readingIntent, type Method } from './logic';
import { Liters, TANKS_BASE } from './parts';
import { historyResponse, lateRequestsResponse, type ReadingKind, type TankLevel } from './schemas';
import { levelsGet } from './levels-client';

/**
 * FUEL-B6 — نموذج تسجيل قراءة خزان سريع.
 *
 * - **مراجعة قبل الحفظ** (القراءة لا تُعدَّل ولا تُحذف بعد الحفظ) ثم تأكيد؛ لا حفظ تلقائي ولا كتابة من أثر جانبي.
 * - **منع الإرسال المزدوج**: قفل `useRef` + زر معطّل + مفتاح دليل ثابت لكل نية (`intents`) يُعلَّم «غير مؤكد» قبل الإرسال ولا يُمسح إلا بحسم صريح؛
 *   والخادم نفسه يعيد القراءة الأولى لأي إعادة بالمفتاح نفسه (idempotent) فلا تكرار حتى لو أُعيد الإرسال.
 * - **لا ساعة عميل**: وقت القياس يختمه الخادم. **لا أثر مخزني أو محاسبي** (يقول النموذج ذلك صراحةً).
 * - نتيجة غير مؤكدة (مهلة/انقطاع/5xx) لا تُعلَن فشلاً ولا تُعاد تلقائياً: «تحقق من الحالة» يقرأ السجل ويبحث عن مفتاح هذه النية.
 */

const INTENT = 'tank-reading';

export function RecordForm({ station, row, onSaved }: { station: Station; row: TankLevel; onSaved: () => void }) {
  const t = useTranslations('stationOps');
  const locale = useLocale();
  const { scopeKey, viewer } = useStationOps();
  const intents = useMemo(() => createIntentStore(`${scopeKey}|${station.id}|${row.tank.id}`), [scopeKey, station.id, row.tank.id]);
  const [type, setType] = useState<ReadingKind>('physical');
  const [method, setMethod] = useState<Method>('dipstick');
  const [raw, setRaw] = useState('');
  const [note, setNote] = useState('');
  const [phase, setPhase] = useState<'edit' | 'review' | 'saving'>('edit');
  const [failure, setFailure] = useState<AnyFailure | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkedMissing, setCheckedMissing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pendingSent, setPendingSent] = useState(false);
  const [late, setLate] = useState(false);
  const [lateLocal, setLateLocal] = useState('');
  const [lateReason, setLateReason] = useState('');
  const sending = useRef(false);
  const policy = row.backdating;
  const canLate = policy?.can_submit === true;
  const maxHours = policy?.max_hours ?? 24;
  const reasonRequired = policy?.reason_required ?? true;
  const lateWindow = late ? evaluateLateTime(lateLocal, station.timezone, maxHours, Date.now()) : null;
  const lateOk = !late || (lateWindow?.kind === 'ok' && (!reasonRequired || lateReason.trim() !== ''));

  const limits = useMemo(() => ({
    capacityMl: row.tank.capacity_milliliters,
    safeCapacityMl: row.tank.safe_capacity_milliliters,
    minimumLevelMl: row.tank.minimum_level_milliliters,
    deadStockMl: row.tank.dead_stock_milliliters,
  }), [row.tank]);
  const previous = row.latest_by_type[type]?.quantity_milliliters ?? null;
  const evaluation = evaluateReading(raw, limits, previous);
  const valid = evaluation.kind === 'ok' && lateOk;

  const reset = () => { setFailure(null); setCheckedMissing(false); setSaved(false); setPendingSent(false); };
  const changeType = (next: ReadingKind) => { setType(next); setMethod(methodsFor(next)[0]); reset(); };

  const lateIso = late && lateWindow?.kind === 'ok' ? lateWindow.iso : null;
  const intentPayload = () => (evaluation.kind === 'ok' ? readingIntent({ stationId: station.id, tankId: row.tank.id, type, ml: evaluation.ml, method, note, at: lateIso, reason: lateIso ? lateReason : '' }) : null);

  const finish = (asRequest = false) => {
    intents.clear(INTENT);
    setRaw(''); setNote(''); setLate(false); setLateLocal(''); setLateReason('');
    setPhase('edit'); setFailure(null); setCheckedMissing(false); setSaved(!asRequest); setPendingSent(asRequest);
    onSaved();
  };

  const submit = async () => {
    const payload = intentPayload();
    if (sending.current || evaluation.kind !== 'ok' || payload === null) return;
    sending.current = true;
    setPhase('saving');
    setFailure(null);
    setCheckedMissing(false);
    try {
      const key = intents.keyFor(INTENT, payload);
      const priorUncertain = intents.isUncertain(INTENT);
      intents.markUncertain(INTENT); // قبل الإرسال: الطلب الجاري قد يلتزم والصفحة تُغلق
      const result = await recordReading({
        fuel_station_id: station.id, fuel_tank_id: row.tank.id, reading_type: type,
        quantity_liters: millilitersToLiters(evaluation.ml), evidence_key: key, evidence: evidenceBody(method, note),
        // وقت القياس والسبب يُرسلان **فقط** من إدخال المستخدم الصريح لقراءة متأخرة؛ بغيرهما يختم الخادم الوقت.
        ...(lateIso ? { measured_at: lateIso, ...(lateReason.trim() !== '' ? { late_reason: lateReason.trim() } : {}) } : {}),
      }, { branchId: station.branch_id });

      // النجاح يُعلَن فقط حين يطابق ردّ الخادم ما أُرسل (الخزان والكمية).
      if (result.kind === 'ok' && result.reading.fuel_tank_id === row.tank.id && result.reading.quantity_milliliters === evaluation.ml) {
        finish();
        return;
      }
      // طلب قراءة متأخرة قُبل وبانتظار موافقة المشرف (ليس قراءة تشغيلية): نعلن ذلك صراحةً، لا «تم الحفظ».
      if (result.kind === 'pending' && result.request.fuel_tank_id === row.tank.id && result.request.quantity_milliliters === evaluation.ml) {
        finish(true);
        return;
      }
      if (result.kind === 'rejected' || result.kind === 'not_sent') {
        if (!priorUncertain) intents.clear(INTENT);
        setPhase('edit');
        setFailure(result);
        return;
      }
      setPhase('edit');
      setFailure(result.kind === 'ok' || result.kind === 'pending' ? { kind: 'unverified' } : (result as WriteFailure));
    } finally {
      sending.current = false;
    }
  };

  // «تحقق من الحالة»: يقرأ آخر السجل ويبحث عن مفتاح هذه النية. وُجد ⇒ حُفظت فعلاً. لم يوجد ⇒ لم تُحفظ، وإعادة الإرسال آمنة (المفتاح نفسه).
  const check = async () => {
    const payload = intentPayload();
    if (checking || payload === null) return;
    setChecking(true);
    try {
      const key = intents.keyFor(INTENT, payload);
      const page = await levelsGet('/fuel-stations/readings', historyResponse, {
        branchId: station.branch_id,
        query: { fuel_station_id: station.id, fuel_tank_id: row.tank.id, per_page: 20 },
      });
      if (page.data.some((reading) => reading.evidence_key === key)) { finish(); return; }
      if (lateIso) {
        const requests = await levelsGet('/fuel-stations/reading-requests', lateRequestsResponse, { branchId: station.branch_id, query: { station_id: station.id, per_page: 20 } });
        if (requests.data.some((request) => request.evidence_key === key)) { finish(true); return; }
      }
      setCheckedMissing(true);
    } catch {
      setCheckedMissing(false);
    } finally {
      setChecking(false);
    }
  };

  const overMessage = evaluation.kind === 'over_capacity' ? t('tanks.detail.over', { capacity: formatLitersFixedFromMl(limits.capacityMl, locale) }) : null;
  const invalidMessage = evaluation.kind === 'invalid' ? t('tanks.detail.invalid') : null;
  const warnings = evaluation.kind === 'ok' ? evaluation.flags : [];

  return (
    <SectionCard title={t('tanks.detail.recordTitle')} id="tank-record-title">
      <div className="space-y-4" data-record-form="">
        <p className="text-sm leading-6 text-muted">{t('tanks.detail.recordHint')}</p>

        <fieldset>
          <legend className="text-sm font-medium text-text">{t('tanks.detail.typeLabel')}</legend>
          <div className="mt-2 grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
            {(['physical', 'atg'] as const).map((value) => (
              <label key={value} className={`flex min-h-12 cursor-pointer items-center justify-center rounded-[11px] border px-2 text-center text-sm font-semibold ${type === value ? 'border-primary bg-primary-soft text-primary' : 'border-[color:var(--fo-control)] bg-surface text-text'}`}>
                <input type="radio" name="reading-type" value={value} checked={type === value} onChange={() => changeType(value)} className="sr-only" disabled={phase !== 'edit'} />
                {t(`tanks.type.${value}`)}
              </label>
            ))}
          </div>
          {type === 'atg' ? <p className="mt-1.5 text-xs leading-5 text-muted">{t('tanks.type.atgHint')}</p> : null}
        </fieldset>

        <fieldset>
          <legend className="text-sm font-medium text-text">{t('tanks.detail.methodLabel')}</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {methodsFor(type).map((value) => (
              <label key={value} className={`flex min-h-12 cursor-pointer items-center justify-center rounded-[11px] border px-2 text-center text-sm font-medium ${method === value ? 'border-primary bg-primary-soft text-primary' : 'border-[color:var(--fo-control)] bg-surface text-text'}`}>
                <input type="radio" name="reading-method" value={value} checked={method === value} onChange={() => { setMethod(value); reset(); }} className="sr-only" disabled={phase !== 'edit'} />
                {t(`tanks.method.${value}`)}
              </label>
            ))}
          </div>
        </fieldset>

        <NumberField
          label={t('tanks.detail.quantityLabel')}
          value={raw}
          onChange={(value) => { setRaw(value); reset(); }}
          suffix={t('tanks.detail.quantitySuffix')}
          hint={t('tanks.detail.quantityHint')}
          error={overMessage ?? invalidMessage}
          warning={warnings.length > 0 ? warnings.map((flag) => t(`tanks.flag.${flag}`)).join(' · ') : null}
          disabled={phase !== 'edit'}
          testId="tank-quantity"
        />

        {evaluation.kind === 'ok' ? (
          <p className="rounded-[11px] bg-primary-soft px-3 py-2.5 text-sm leading-6 text-text" data-preview="">
            {t('tanks.detail.preview', { percent: percentText(evaluation.fillBasisPoints, locale), available: formatLitersFixedFromMl(evaluation.availableMl, locale) })}
            {evaluation.deltaMl !== null && evaluation.deltaMl !== 0 ? <> {t('tanks.detail.delta', { value: `${evaluation.deltaMl > 0 ? '+' : '−'}${formatLitersFixedFromMl(Math.abs(evaluation.deltaMl), locale)}` })}</> : null}
          </p>
        ) : null}

        {canLate ? (
          <div className="space-y-3 rounded-[12px] border border-border p-3" data-late-section="">
            <SwitchRow id="tank-late" label={t('tanks.late.toggle')} checked={late} onChange={() => { setLate((value) => !value); reset(); }} disabled={phase !== 'edit'} note={t(policy?.policy === 'supervisor_approval' ? 'tanks.late.toggleHintApproval' : 'tanks.late.toggleHintDirect', { hours: String(maxHours) })} />
            {late ? (
              <>
                <label className="block text-sm font-medium text-text">
                  {t('tanks.late.timeLabel')}
                  <input
                    type="datetime-local"
                    lang="en"
                    dir="ltr"
                    value={lateLocal}
                    onChange={(event) => { setLateLocal(event.target.value); reset(); }}
                    disabled={phase !== 'edit'}
                    data-late-time=""
                    className="mt-1.5 h-12 w-full rounded-[11px] border border-[color:var(--fo-control)] bg-surface px-3 text-base text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  />
                </label>
                <p className="text-xs leading-5 text-muted">{t('tanks.late.timeHint', { hours: String(maxHours) })}</p>
                {lateWindow && lateWindow.kind !== 'empty' && lateWindow.kind !== 'ok' ? (
                  <p role="alert" data-late-error={lateWindow.kind} className="text-sm leading-5 text-negative">{t(`tanks.late.error.${lateWindow.kind}`, { hours: String(maxHours) })}</p>
                ) : null}
                <label className="block text-sm font-medium text-text">
                  {reasonRequired ? t('tanks.late.reasonRequired') : t('tanks.late.reasonOptional')}
                  <textarea
                    value={lateReason}
                    onChange={(event) => { setLateReason(event.target.value.slice(0, 500)); reset(); }}
                    placeholder={t('tanks.late.reasonPlaceholder')}
                    rows={2}
                    maxLength={500}
                    disabled={phase !== 'edit'}
                    data-late-reason=""
                    aria-required={reasonRequired}
                    className="mt-1.5 w-full rounded-[11px] border border-[color:var(--fo-control)] bg-surface px-3 py-2.5 text-base text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  />
                </label>
              </>
            ) : null}
          </div>
        ) : null}

        <label className="block text-sm font-medium text-text">
          {t('tanks.detail.noteLabel')}
          <textarea
            value={note}
            onChange={(event) => { setNote(event.target.value.slice(0, 500)); reset(); }}
            placeholder={t('tanks.detail.notePlaceholder')}
            rows={2}
            maxLength={500}
            disabled={phase !== 'edit'}
            className="mt-1.5 w-full rounded-[11px] border border-[color:var(--fo-control)] bg-surface px-3 py-2.5 text-base text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </label>

        <dl className="grid gap-1 text-sm leading-6">
          <div className="flex flex-wrap gap-x-2"><dt className="text-muted">{t('tanks.detail.timeLabel')}:</dt><dd className="text-text">{t('tanks.detail.timeValue')}</dd></div>
          <div className="flex flex-wrap gap-x-2"><dt className="text-muted">{t('tanks.detail.recorderLabel')}:</dt><dd className="text-text">{t('tanks.detail.recorderValue', { name: viewer.name })}</dd></div>
        </dl>

        {pendingSent ? (
          <div data-pending-sent="" role="status" className="space-y-2 rounded-[11px] bg-[color:var(--fo-warning-tint)] px-3 py-2.5 text-sm font-semibold text-warning">
            <p className="flex items-start gap-2">
              <Hourglass aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={1.9} />
              <span>{t('tanks.late.pendingSent')}</span>
            </p>
            <Link href={`${TANKS_BASE}/requests`} className="inline-flex min-h-11 items-center rounded-lg border border-current px-3 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{t('tanks.late.viewRequests')}</Link>
          </div>
        ) : null}
        {saved ? (
          <p role="status" data-saved="" className="flex items-center gap-2 rounded-[11px] bg-[color:var(--fo-positive-tint)] px-3 py-2.5 text-sm font-semibold text-positive">
            <CheckCircle2 aria-hidden="true" className="h-5 w-5 shrink-0" strokeWidth={1.9} />{t('tanks.detail.saved')}
          </p>
        ) : null}
        {failure ? <FailureNotice failure={failure} onCheck={check} checking={checking} /> : null}
        {checkedMissing ? <p role="status" data-check-missing="" className="text-sm leading-6 text-muted">{t('tanks.detail.checkMissing')}</p> : null}

        <PrimaryButton onClick={() => { setFailure(null); setPhase('review'); }} disabled={!valid || phase !== 'edit'} data-review-button="">
          {late ? t(policy?.policy === 'supervisor_approval' ? 'tanks.late.reviewApproval' : 'tanks.late.review') : t('tanks.detail.review')}
        </PrimaryButton>
        <p className="text-xs leading-5 text-muted">{t('tanks.detail.operationalNote')}</p>
      </div>

      <ConfirmDialog open={phase === 'review' || phase === 'saving'} title={t('tanks.detail.confirmTitle')} onClose={() => setPhase('edit')} busy={phase === 'saving'}>
        <div className="space-y-4" data-confirm="">
          <dl className="space-y-2 text-sm leading-6">
            <div className="flex justify-between gap-3"><dt className="text-muted">{row.tank.name}</dt><dd className="text-text">{row.fuel_product.name ?? ''}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted">{t(`tanks.type.${type}`)}</dt><dd className="text-text">{t(`tanks.method.${method}`)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted">{t('tanks.detail.quantityLabel')}</dt><dd className="text-lg font-bold text-text">{evaluation.kind === 'ok' ? <Liters ml={evaluation.ml} /> : null}</dd></div>
            {lateIso ? (
              <>
                <div className="flex justify-between gap-3"><dt className="text-muted">{t('tanks.late.timeLabel')}</dt><dd className="num text-text">{formatStampInZone(lateIso, locale, station.timezone)}</dd></div>
                <div className="flex justify-between gap-3"><dt className="shrink-0 text-muted">{t('tanks.late.reasonShort')}</dt><dd className="min-w-0 break-words text-end text-text">{lateReason.trim() || '—'}</dd></div>
              </>
            ) : null}
          </dl>
          {lateIso && policy?.policy === 'supervisor_approval' ? <p className="rounded-[11px] bg-[color:var(--fo-warning-tint)] px-3 py-2.5 text-sm leading-6 text-warning" data-approval-note="">{t('tanks.late.approvalNote')}</p> : null}
          <p className="text-sm leading-6 text-muted">{t('tanks.detail.confirmBody')}</p>
          <PrimaryButton onClick={submit} disabled={phase === 'saving'} data-confirm-save="">{phase === 'saving' ? t('tanks.detail.saving') : t('tanks.detail.confirmSave')}</PrimaryButton>
          <SecondaryButton onClick={() => setPhase('edit')} disabled={phase === 'saving'}>{t('tanks.detail.confirmBack')}</SecondaryButton>
        </div>
      </ConfirmDialog>
    </SectionCard>
  );
}
