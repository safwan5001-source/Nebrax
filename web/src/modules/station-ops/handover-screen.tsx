'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowDownRight, ArrowUpRight, CircleAlert, CircleCheck, CircleDashed, Equal, Info, Plus, WifiOff } from 'lucide-react';
import { SAUDI_RIYAL_SYMBOL, formatMinorRiyal } from '@/lib/money';
import { CollectionDetailSection, CollectionEntrySection, type CollectionStatus } from './collection-section';
import { SettlementPreviewSection } from './settlement-preview-section';
import { cashTotals, closePreview, isValidReason, movementBlocker, parseMoney, MOVEMENT_TYPES, type MovementType } from './cash';
import { useStationOps } from './context';
import { useShiftDetail, useStationAssets, useStationPolicy, type StationAssetsResult } from './data';
import { closeBlockers, readingsCoverage, type Coverage } from './entry';
import { formatLitersFixedFromMl } from './format';
import { createIntentStore } from './intents';
import { PageMasthead, ScreenBody } from './masthead';
import { OPS_BASE } from './nav';
import { Quantity } from './quantity';
import { buildShiftReadings } from './readings';
import type { ShiftDetail, Station } from './schemas';
import { ShiftReportActions } from './shift-report/actions';
import { StationGate } from './station-gate';
import { EmptyState, ErrorState, InlineNote, LoadingBlock } from './state-views';
import { opsWrite, type WriteResult } from './write-client';
import { shouldClearIntentKey } from './write-outcome';
import { ActionBar, ConfirmDialog, NumberField, PrimaryButton, SecondaryButton, SectionCard, WriteNotice } from './write-ui';

/**
 * UI-2 — «تسليم الوردية» (W5 + W6): قراءات جاهزة؟ ← عدّ النقد ← تأكيد محميّ. داخل التطبيق فقط.
 *
 * - **عدّ النقد ≠ تحصيل مبيعات**: المتوقع = عهدة الافتتاح + إيداعات − سحوبات − مصروفات (الخادم، CYCLE_4 §4) ولا يشمل نقد مبيعات الوقود؛ لذلك تظهر
 *   الملاحظة صراحةً. الفرق يُحفظ `pending_review` للمشرف ولا يُسوّى ولا يُنشئ قيداً. الشبكة/البطاقات: «غير متاح حاليًا» (لا endpoint — B5).
 * - **الإغلاق** بلا مفتاح idempotency في الخادم لكنه محروس بالحالة (الإغلاق الثاني يُرفض): عند مهلة/انقطاع نعيد **قراءة** الوردية ولا نعيد الإرسال؛
 *   النجاح يُعلن فقط حين يعيد الخادم `closed` بالنقد المعدود نفسه.
 * - حركة النقد: مفتاح نية ثابت ببصمة (وردية، نوع، مبلغ، سبب)؛ والنجاح يتطلب ظهورها في ردّ الخادم.
 */

function CoverageRow({ label, coverage, required, href, fixLabel }: { label: string; coverage: Coverage; required: boolean; href: string; fixLabel: string }) {
  const t = useTranslations('stationOps');
  const done = coverage.total > 0 && coverage.done >= coverage.total;
  const Icon = done ? CircleCheck : CircleDashed;
  return (
    <li data-coverage={done ? 'done' : 'missing'} className="flex items-center justify-between gap-3 py-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <Icon aria-hidden="true" className={`h-5 w-5 shrink-0 ${done ? 'text-positive' : required ? 'text-warning' : 'text-muted'}`} strokeWidth={1.9} />
        <div className="min-w-0">
          <p className="text-sm font-medium text-text">{label}</p>
          <p className="text-xs text-muted tabular-nums">{t('entry.progress', { done: String(coverage.done), total: String(coverage.total) })}{!required ? ` · ${t('handover.readiness.optional')}` : ''}</p>
        </div>
      </div>
      {!done && coverage.total > 0 ? (
        <Link href={href} className="inline-flex min-h-11 shrink-0 items-center rounded-lg border border-[color:var(--fo-control)] bg-surface px-3 text-sm font-semibold text-text hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{fixLabel}</Link>
      ) : null}
    </li>
  );
}

function DirectionBadge({ variance }: { variance: number }) {
  const t = useTranslations('stationOps');
  const direction = variance === 0 ? 'none' : variance > 0 ? 'overage' : 'shortage';
  const Icon = direction === 'overage' ? ArrowUpRight : direction === 'shortage' ? ArrowDownRight : Equal;
  return (
    <span className="inline-flex items-center gap-1.5 text-base font-bold text-text">
      <Icon aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
      <span className="num">{formatMinorRiyal(Math.abs(variance))}</span>
      <span className="text-sm font-semibold">{t(`handover.summary.direction.${direction}`)}</span>
    </span>
  );
}

function DonePanel({ detail, justClosed, station, assets }: { detail: ShiftDetail; justClosed: boolean; station: Station; assets: StationAssetsResult }) {
  const t = useTranslations('stationOps');
  const locale = useLocale();
  const variance = detail.cash_variance_minor;
  return (
    <div className="space-y-4 pt-5" data-handover-done="">
      <SectionCard>
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[color:var(--fo-positive-tint)] text-positive"><CircleCheck className="h-6 w-6" strokeWidth={1.9} /></span>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-text">{justClosed ? t('handover.done.title') : t('handover.done.alreadyTitle')}</h2>
            <p className="mt-1 text-sm leading-6 text-muted">{detail.status === 'approved' ? t('shiftStatus.approved') : t('handover.done.body')}</p>
          </div>
        </div>
        <dl className="mt-4 divide-y divide-border text-sm">
          <div className="flex items-baseline justify-between gap-3 py-2.5"><dt className="text-muted">{t('handover.liters')}</dt><dd className="text-base font-semibold text-text"><Quantity value={formatLitersFixedFromMl(detail.operational_meter_milliliters, locale)} unit={t('unit.liter')} /></dd></div>
          <div className="flex items-baseline justify-between gap-3 py-2.5"><dt className="text-muted">{t('handover.summary.expected')}</dt><dd className="num text-base font-semibold text-text">{detail.expected_operational_cash_minor == null ? '—' : formatMinorRiyal(detail.expected_operational_cash_minor)}</dd></div>
          <div className="flex items-baseline justify-between gap-3 py-2.5"><dt className="text-muted">{t('handover.summary.counted')}</dt><dd className="num text-base font-semibold text-text">{detail.counted_cash_minor == null ? '—' : formatMinorRiyal(detail.counted_cash_minor)}</dd></div>
          <div className="flex items-baseline justify-between gap-3 py-2.5"><dt className="text-muted">{t('handover.summary.variance')}</dt><dd>{variance == null ? '—' : <DirectionBadge variance={variance} />}</dd></div>
        </dl>
        <p className="mt-3 text-xs leading-5 text-muted">{t('handover.summary.note')}</p>
      </SectionCard>
      <CollectionDetailSection station={station} shiftId={detail.id} />
      <ShiftReportActions station={station} detail={detail} assets={assets} justClosed={justClosed} />
      <Link href={OPS_BASE} data-primary-action="" className="flex min-h-14 w-full items-center justify-center rounded-[13px] bg-[color:var(--fo-cta-bg)] px-4 text-[15px] font-bold text-[color:var(--fo-cta-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background">{t('handover.done.home')}</Link>
    </div>
  );
}

function MovementDialog({ open, onClose, detail, station, intents, onSaved }: {
  open: boolean;
  onClose: () => void;
  detail: ShiftDetail;
  station: Station;
  intents: ReturnType<typeof createIntentStore>;
  /** يمرّر الوردية التي أكّدها الخادم في ردّ الكتابة لتُعرض فوراً (GET التالي للمراجعة فقط، وقد يفشل). */
  onSaved: (shift: ShiftDetail) => void;
}) {
  const t = useTranslations('stationOps');
  const [type, setType] = useState<MovementType>('cash_in');
  const [amountRaw, setAmountRaw] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<WriteResult | null>(null);
  const sending = useRef(false);

  const totals = cashTotals(detail);
  const parsed = amountRaw.trim() === '' ? null : parseMoney(amountRaw, { min: 1 });
  const amount = parsed && parsed.ok ? parsed.minor : null;
  const amountError = parsed && !parsed.ok ? t('handover.movement.amountInvalid') : null;
  const blocker = amount !== null ? movementBlocker(totals, type, amount) : null;
  const valid = amount !== null && isValidReason(reason) && blocker === null;

  const submit = async () => {
    if (sending.current || !valid || amount === null) return;
    sending.current = true;
    setBusy(true);
    setFailure(null);
    try {
      const cleanReason = reason.trim();
      const key = intents.keyFor('cash', { shift: detail.id, type, amount, reason: cleanReason });
      // قبل الإرسال: الطلب الجاري قد يلتزم والصفحة تُغلق — النية غير مؤكدة (ومحفوظة) حتى تُحسم.
      const priorUncertain = intents.isUncertain('cash');
      intents.markUncertain('cash');
      const result = await opsWrite({ action: 'cash_movement', shiftId: detail.id, body: { type, amount_minor: amount, reason: cleanReason, idempotency_key: key } }, { branchId: station.branch_id });
      const confirmed = result.kind === 'ok' && (result.shift.cash_movements ?? []).some((m) => m.type === type && m.amount_minor === amount && m.reason === cleanReason);
      if (confirmed) {
        intents.clear('cash');
        setAmountRaw(''); setReason(''); setType('cash_in');
        onSaved((result as Extract<WriteResult, { kind: 'ok' }>).shift);
        return;
      }
      if (shouldClearIntentKey(result, priorUncertain)) intents.clear('cash');
      setFailure(result.kind === 'ok' ? { kind: 'unverified' } : result);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  return (
    <ConfirmDialog open={open} title={t('handover.movement.title')} onClose={onClose} busy={busy}>
      <div className="space-y-4">
        <fieldset>
          <legend className="text-sm font-medium text-text">{t('handover.movement.type')}</legend>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {MOVEMENT_TYPES.map((value) => (
              <label key={value} className={`flex min-h-12 cursor-pointer items-center justify-center rounded-[11px] border px-2 text-center text-sm font-semibold ${type === value ? 'border-primary bg-primary-soft text-primary' : 'border-[color:var(--fo-control)] bg-surface text-text'}`}>
                <input type="radio" name="movement-type" value={value} checked={type === value} onChange={() => { setType(value); setFailure(null); }} className="sr-only" disabled={busy} />
                {t(`handover.movement.types.${value}`)}
              </label>
            ))}
          </div>
        </fieldset>
        <NumberField
          label={t('handover.movement.amount')}
          value={amountRaw}
          onChange={(value) => { setAmountRaw(value); setFailure(null); }}
          suffix={SAUDI_RIYAL_SYMBOL}
          error={amountError ?? (blocker ? t('handover.movement.exceeds', { expected: totals ? formatMinorRiyal(totals.expected) : '—' }) : null)}
          disabled={busy}
          testId="movement-amount"
        />
        <div>
          <label htmlFor="movement-reason" className="block text-sm font-medium text-text">{t('handover.movement.reason')}</label>
          <textarea
            id="movement-reason"
            value={reason}
            onChange={(event) => { setReason(event.target.value); setFailure(null); }}
            rows={2}
            maxLength={2000}
            disabled={busy}
            className="mt-1.5 w-full rounded-[11px] border border-[color:var(--fo-control)] bg-surface px-3 py-2.5 text-base text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          <p className="mt-1 text-xs text-muted">{t('handover.movement.reasonHint')}</p>
        </div>
        <p className="text-xs leading-5 text-muted">{t('handover.movement.note')}</p>
        <WriteNotice result={failure} />
        <PrimaryButton disabled={!valid || busy} onClick={() => void submit()} data-confirm-movement="">{t('handover.movement.confirm')}</PrimaryButton>
        <SecondaryButton disabled={busy} onClick={onClose}>{t('handover.movement.cancel')}</SecondaryButton>
      </div>
    </ConfirmDialog>
  );
}

function Content({ station, shiftId }: { station: Station; shiftId: string }) {
  const t = useTranslations('stationOps');
  const locale = useLocale();
  const { scopeKey, viewer, can } = useStationOps();
  const query = useShiftDetail(station, shiftId);
  const assets = useStationAssets(station);
  const { policy } = useStationPolicy(station);
  const intents = useMemo(() => createIntentStore(`${scopeKey}|${station.id}`), [scopeKey, station.id]);

  const [countedRaw, setCountedRaw] = useState('');
  const [note, setNote] = useState('');
  const [movementOpen, setMovementOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [acked, setAcked] = useState(false);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<WriteResult | null>(null);
  const [closedShift, setClosedShift] = useState<ShiftDetail | null>(null);
  /** وردية أكّدها ردّ كتابة (حركة نقد) مع نسخة GET التي كانت معروضة وقتها: تُعرض حتى تصل بيانات GET أحدث (هوية كائن مختلفة). */
  const [confirmed, setConfirmed] = useState<{ shift: ShiftDetail; base: ShiftDetail | null } | null>(null);
  const [checking, setChecking] = useState(false);
  const [staffResult, setStaffResult] = useState<WriteResult | null>(null);
  const [saved, setSaved] = useState(false);
  const submitting = useRef(false);
  const [collection, setCollection] = useState<CollectionStatus>({ enabled: false, gate: null });

  const queried: ShiftDetail | null = query.state.status === 'success' ? query.state.data : query.retained?.data ?? null;
  const detail: ShiftDetail | null = confirmed && (query.state.status !== 'success' || query.state.data === confirmed.base) ? confirmed.shift : queried;
  const catalog = assets.catalog;

  const check = useCallback(() => {
    setChecking(true);
    query.reload();
    window.setTimeout(() => setChecking(false), 600);
  }, [query]);

  const counted = countedRaw.trim() === '' ? null : parseMoney(countedRaw);
  const countedMinor = counted && counted.ok ? counted.minor : null;
  const countedError = counted && !counted.ok ? t('handover.cash.countedInvalid') : null;

  const submit = useCallback(async () => {
    if (submitting.current || countedMinor === null) return;
    submitting.current = true;
    setSending(true);
    setFailure(null);
    try {
      const result = await opsWrite(
        { action: 'close', shiftId, body: { counted_cash_minor: countedMinor, ...(note.trim() ? { closing_note: note.trim() } : {}) } },
        { branchId: station.branch_id },
      );
      if (result.kind === 'ok' && result.shift.status === 'closed' && result.shift.counted_cash_minor === countedMinor) {
        // نعرض ما أعاده الخادم نفسه فوراً (مؤكَّد: closed + النقد المعدود نفسه) دون انتظار إعادة القراءة.
        setClosedShift(result.shift);
        setConfirmOpen(false);
        query.reload();
        return;
      }
      setConfirmOpen(false);
      setFailure(result.kind === 'ok' ? { kind: 'unverified' } : result);
    } finally {
      submitting.current = false;
      setSending(false);
    }
  }, [countedMinor, note, query, shiftId, station.branch_id]);

  if (closedShift) return <DonePanel detail={closedShift} justClosed station={station} assets={assets} />;
  if (!query.allowed) return <div className="pt-5"><EmptyState title={t('shift.noPermission.title')} body={t('shift.noPermission.body')} /></div>;
  if (!detail) {
    if (query.state.status === 'error') return <div className="pt-5"><ErrorState error={query.state.error} onRetry={query.reload} /></div>;
    return <div className="pt-5"><LoadingBlock rows={3} /></div>;
  }
  if (detail.status !== 'open') return <DonePanel detail={detail} justClosed={false} station={station} assets={assets} />;
  if (!can('fuel.shift.close') || !can('fuel.shift.cash_count')) {
    return <div className="pt-5"><EmptyState title={t('shift.noPermission.title')} body={t('shift.noPermission.body')} /></div>;
  }
  if (assets.state.status === 'error') return <div className="pt-5"><ErrorState error={assets.state.error} onRetry={assets.reload} /></div>;
  if (assets.state.status === 'loading' || !catalog) return <div className="pt-5"><LoadingBlock rows={3} /></div>;

  const base = `${OPS_BASE}/shifts/${encodeURIComponent(shiftId)}`;
  const coverage = readingsCoverage(detail, catalog);
  const { blockers, hardBlock } = closeBlockers(detail, catalog, policy);
  const view = buildShiftReadings(detail, catalog);
  const totals = cashTotals(detail);
  const preview = totals && countedMinor !== null ? closePreview(totals, countedMinor) : null;
  const varianceBlocked = preview !== null && preview.variance !== 0 && policy.allowCloseWithCashVariance === false;
  // Q1/Q3: والبوابة مفتوحة، التسليم يتطلب إقرار تحصيل محفوظاً مكتملاً، وسبب الفرق (لمن يراه) في ملاحظة التسليم.
  const collectionBlocked = collection.gate?.blocked === true;
  const reasonMissing = collection.gate?.reasonRequired === true && note.trim() === '';
  const canReview = countedMinor !== null && !hardBlock && !varianceBlocked && !collectionBlocked && !reasonMissing;
  const staffMissing = blockers.some((b) => b.kind === 'staff_missing');
  const invalidOrder = blockers.find((b) => b.kind === 'invalid_order');
  const mismatch = blockers.find((b) => b.kind === 'tank_type_mismatch');
  const allCovered = blockers.length === 0;

  const assignSelf = async () => {
    const result = await opsWrite({ action: 'assign_staff', shiftId, body: { user_id: viewer.id, role: 'attendant' } }, { branchId: station.branch_id });
    setStaffResult(result.kind === 'ok' || (result.kind === 'rejected' && result.code === 'staff_already_assigned') ? null : result);
    query.reload();
  };

  return (
    <div className="space-y-4 pt-5" data-handover="">
      <SectionCard title={t('handover.step.readings')} id="handover-readings-h">
        <ul className="divide-y divide-border" data-readiness="">
          <CoverageRow label={t('handover.readiness.meterOpening')} coverage={coverage.meterOpening} required={policy.openingMeterRequired} href={`${base}/readings/opening`} fixLabel={t('handover.readiness.fix')} />
          <CoverageRow label={t('handover.readiness.meterClosing')} coverage={coverage.meterClosing} required={policy.closingMeterRequired} href={`${base}/readings/closing`} fixLabel={t('handover.readiness.fix')} />
          <CoverageRow label={t('handover.readiness.tankOpening')} coverage={coverage.tankOpening} required={policy.openingTankRequired} href={`${base}/readings/opening`} fixLabel={t('handover.readiness.fix')} />
          <CoverageRow label={t('handover.readiness.tankClosing')} coverage={coverage.tankClosing} required={policy.closingTankRequired} href={`${base}/readings/closing`} fixLabel={t('handover.readiness.fix')} />
        </ul>
        {allCovered ? <p className="mt-2 flex items-center gap-2 text-sm font-medium text-positive"><CircleCheck aria-hidden="true" className="h-4 w-4" strokeWidth={2} />{t('handover.readiness.ok')}</p> : null}
        {invalidOrder ? <p role="alert" className="mt-2 flex items-start gap-2 text-sm text-negative"><CircleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />{t('handover.readiness.invalidOrder', { count: String(invalidOrder.remaining) })}</p> : null}
        {mismatch ? <p role="alert" className="mt-2 flex items-start gap-2 text-sm text-negative"><CircleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />{t('handover.readiness.tankMismatch', { count: String(mismatch.remaining) })}</p> : null}
        {staffMissing ? (
          <div className="mt-2 space-y-2">
            <p className="flex items-start gap-2 text-sm text-warning"><CircleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />{t('handover.readiness.staff')}</p>
            <SecondaryButton onClick={() => void assignSelf()}>{t('openShift.staff.retry')}</SecondaryButton>
            <WriteNotice result={staffResult} />
          </div>
        ) : null}
        {!policy.known ? <div className="mt-2"><InlineNote tone="warning">{t('handover.readiness.policyUnknown')}</InlineNote></div> : null}
        <p className="mt-3 flex items-baseline justify-between gap-3 border-t border-border pt-3 text-sm"><span className="text-muted">{t('handover.liters')}</span><span className="text-base font-semibold text-text">{view.summary.recordedComplete > 0 ? <Quantity value={formatLitersFixedFromMl(view.summary.computedMl, locale)} unit={t('unit.liter')} /> : '—'}</span></p>
      </SectionCard>

      <CollectionEntrySection station={station} shiftId={shiftId} countedMinor={countedMinor} intents={intents} onStatus={setCollection} />
      <SettlementPreviewSection station={station} shiftId={shiftId} />

      <SectionCard title={t('handover.step.cash')} id="handover-cash-h">
        <dl className="divide-y divide-border text-sm">
          <div className="flex items-baseline justify-between gap-3 py-2.5"><dt className="text-muted">{t('handover.cash.float')}</dt><dd className="num text-base font-semibold text-text">{formatMinorRiyal(detail.opening_float_minor)}</dd></div>
          {totals ? (
            <>
              <div className="flex items-baseline justify-between gap-3 py-2.5"><dt className="text-muted">{t('handover.cash.in')}</dt><dd className="num text-base font-semibold text-text">{formatMinorRiyal(totals.cashIn)}</dd></div>
              <div className="flex items-baseline justify-between gap-3 py-2.5"><dt className="text-muted">{t('handover.cash.out')}</dt><dd className="num text-base font-semibold text-text">{formatMinorRiyal(totals.cashOut)}</dd></div>
              <div className="flex items-baseline justify-between gap-3 py-2.5"><dt className="text-muted">{t('handover.cash.expense')}</dt><dd className="num text-base font-semibold text-text">{formatMinorRiyal(totals.expenses)}</dd></div>
            </>
          ) : null}
          <div className="flex items-baseline justify-between gap-3 py-2.5"><dt className="font-medium text-text">{t('handover.cash.expected')}</dt><dd className="num text-base font-bold text-text" data-expected="">{totals ? formatMinorRiyal(totals.expected) : <span className="text-sm font-normal text-muted">{t('handover.cash.unavailable')}</span>}</dd></div>
        </dl>
        {totals ? <p className="mt-2 flex items-start gap-2 text-xs leading-5 text-muted"><Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.7} />{t('handover.cash.expectedNote')}</p> : null}

        <div className="mt-4">
          <h3 className="text-sm font-semibold text-text">{t('handover.cash.movements')}</h3>
          {(detail.cash_movements ?? []).length === 0 ? (
            <p className="mt-1 text-sm text-muted">{t('handover.cash.noMovements')}</p>
          ) : (
            <ul className="mt-1 divide-y divide-border" data-movements="">
              {(detail.cash_movements ?? []).map((movement) => (
                <li key={movement.id} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0"><span className="font-medium text-text">{movement.type === 'cash_in' || movement.type === 'cash_out' || movement.type === 'expense' ? t(`handover.movement.types.${movement.type}`) : movement.type}</span>{movement.reason ? <span className="block break-words text-xs text-muted">{movement.reason}</span> : null}</span>
                  <span className="num shrink-0 font-semibold text-text">{formatMinorRiyal(movement.amount_minor)}</span>
                </li>
              ))}
            </ul>
          )}
          {saved ? <p role="status" className="mt-2 text-sm font-medium text-positive">{t('handover.movement.saved')}</p> : null}
          <div className="mt-3"><SecondaryButton onClick={() => { setSaved(false); setMovementOpen(true); }} data-open-movement=""><Plus aria-hidden="true" className="h-4 w-4" strokeWidth={2} />{t('handover.cash.add')}</SecondaryButton></div>
        </div>
      </SectionCard>

      <SectionCard title={t('handover.step.confirm')} id="handover-confirm-h">
        <NumberField
          label={t('handover.cash.counted')}
          value={countedRaw}
          onChange={(value) => { setCountedRaw(value); setFailure(null); }}
          suffix={SAUDI_RIYAL_SYMBOL}
          hint={t('handover.cash.countedHint')}
          error={countedError}
          disabled={sending}
          testId="counted-cash"
        />
        <div className="mt-4 rounded-[12px] border border-border p-3.5" data-variance-preview="">
          {preview ? (
            <dl className="space-y-2 text-sm">
              <div className="flex items-baseline justify-between gap-3"><dt className="text-muted">{t('handover.summary.expected')}</dt><dd className="num font-semibold text-text">{formatMinorRiyal(preview.expected)}</dd></div>
              <div className="flex items-baseline justify-between gap-3"><dt className="text-muted">{t('handover.summary.counted')}</dt><dd className="num font-semibold text-text">{formatMinorRiyal(preview.counted)}</dd></div>
              <div className="flex items-baseline justify-between gap-3"><dt className="text-muted">{t('handover.summary.variance')}</dt><dd><DirectionBadge variance={preview.variance} /></dd></div>
            </dl>
          ) : (
            <p className="text-sm text-muted">{t('handover.summary.noCount')}</p>
          )}
          <p className="mt-2 text-xs leading-5 text-muted">{t('handover.summary.note')}</p>
          {preview && preview.variance !== 0 && policy.allowCloseWithCashVariance !== null ? (
            <p className={`mt-1 text-xs leading-5 ${policy.allowCloseWithCashVariance ? 'text-muted' : 'text-negative'}`}>{policy.allowCloseWithCashVariance ? t('handover.summary.policyAllows') : t('handover.summary.policyBlocks')}</p>
          ) : null}
        </div>

        <div className="mt-4">
          <label htmlFor="closing-note" className="block text-sm font-medium text-text">{collection.gate?.reasonRequired ? t('collection.reasonLabel') : t('handover.summary.noteLabel')}</label>
          <textarea id="closing-note" aria-required={collection.gate?.reasonRequired ? true : undefined} value={note} onChange={(event) => setNote(event.target.value)} rows={2} maxLength={2000} disabled={sending} className="mt-1.5 w-full rounded-[11px] border border-[color:var(--fo-control)] bg-surface px-3 py-2.5 text-base text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" />
        </div>

        <div className="mt-4 rounded-[12px] border border-dashed border-border p-3.5" data-network-blocked="">
          <p className="flex items-center gap-2 text-sm font-semibold text-text"><WifiOff aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />{t('handover.network.title')}</p>
          <p className="mt-1 text-xs leading-5 text-muted">{t('handover.network.body')}</p>
        </div>
      </SectionCard>

      <WriteNotice result={failure} onCheck={check} checking={checking} />

      <ActionBar>
        <div className="mx-auto max-w-3xl space-y-2">
          {hardBlock ? <p role="status" className="text-xs text-warning">{t('handover.blocked')}</p> : null}
          {!hardBlock && collectionBlocked ? <p role="status" data-handover-collection-blocked="" className="text-xs text-warning">{t(`collection.gate.${collection.gate?.reason}`)}</p> : null}
          {!hardBlock && !collectionBlocked && reasonMissing ? <p role="status" data-handover-reason-missing="" className="text-xs text-warning">{t('collection.reasonRequired')}</p> : null}
          <PrimaryButton disabled={!canReview || sending} onClick={() => { setAcked(false); setConfirmOpen(true); }}>{t('handover.review')}</PrimaryButton>
        </div>
      </ActionBar>

      <MovementDialog open={movementOpen} onClose={() => setMovementOpen(false)} detail={detail} station={station} intents={intents} onSaved={(shift) => { setConfirmed({ shift, base: queried }); setMovementOpen(false); setSaved(true); query.reload(); }} />

      <ConfirmDialog open={confirmOpen} title={t('handover.confirm.title')} onClose={() => setConfirmOpen(false)} busy={sending}>
        <div className="space-y-4">
          <p className="text-sm leading-6 text-muted">{t('handover.confirm.body')}</p>
          {preview ? (
            <dl className="space-y-2 rounded-[12px] border border-border p-3 text-sm">
              <div className="flex items-baseline justify-between gap-3"><dt className="text-muted">{t('handover.liters')}</dt><dd className="font-semibold text-text">{view.summary.recordedComplete > 0 ? <Quantity value={formatLitersFixedFromMl(view.summary.computedMl, locale)} unit={t('unit.liter')} /> : '—'}</dd></div>
              <div className="flex items-baseline justify-between gap-3"><dt className="text-muted">{t('handover.summary.counted')}</dt><dd className="num font-semibold text-text">{formatMinorRiyal(preview.counted)}</dd></div>
              <div className="flex items-baseline justify-between gap-3"><dt className="text-muted">{t('handover.summary.variance')}</dt><dd><DirectionBadge variance={preview.variance} /></dd></div>
            </dl>
          ) : null}
          <label className="flex min-h-11 items-start gap-3 text-sm text-text">
            <input type="checkbox" checked={acked} onChange={(event) => setAcked(event.target.checked)} disabled={sending} className="mt-1 h-5 w-5 shrink-0 accent-[color:var(--primary)]" data-confirm-ack="" />
            <span>{t('handover.confirm.ack')}</span>
          </label>
          <PrimaryButton disabled={!acked || sending} onClick={() => void submit()} data-confirm-close="">{sending ? t('handover.confirm.sending') : t('handover.confirm.cta')}</PrimaryButton>
          <SecondaryButton disabled={sending} onClick={() => setConfirmOpen(false)}>{t('handover.confirm.back')}</SecondaryButton>
        </div>
      </ConfirmDialog>
    </div>
  );
}

export function HandoverScreen({ shiftId }: { shiftId: string }) {
  const t = useTranslations('stationOps');
  return (
    <>
      <PageMasthead title={t('handover.title')} subtitle={t('handover.subtitle')} backHref={`${OPS_BASE}/shifts/${encodeURIComponent(shiftId)}`} backLabel={t('shiftDetail.back')} />
      <ScreenBody flush>
        <StationGate gateClassName="pt-5">{(station) => <Content station={station} shiftId={shiftId} />}</StationGate>
      </ScreenBody>
    </>
  );
}
