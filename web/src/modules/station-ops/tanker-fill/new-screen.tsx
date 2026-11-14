'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowRight, CircleCheck } from 'lucide-react';
import { useStationOps } from '../context';
import { useCurrentShift, useStationAssets } from '../data';
import { createIntentStore } from '../intents';
import { PageMasthead, ScreenBody } from '../masthead';
import { StationOpsError } from '../read-client';
import type { Station } from '../schemas';
import { StationGate } from '../station-gate';
import { EmptyState, ErrorState, InlineNote, LoadingBlock } from '../state-views';
import { NumberField, PrimaryButton, SecondaryButton, SectionCard } from '../write-ui';
import { findRecordedFill, recordFill, type FillWriteResult } from './client';
import { useOwnerTankers, useOwners, useTankerFillAccess, useTankerFillFeature, useTankerPolicy } from './data';
import {
  EMPTY_DRAFT, STEPS, buildIntentPayload, capacityCheck, eligibleNozzleCount, firstInvalidStep, litersFromMl, normalizeVoucher, parseLiters, pumpChoices, stepProblem,
  type FillBody, type FillDraft, type IntentPayload, type Step, type StepContext, type StepProblem,
} from './logic';
import { FillNotice, FillStatusBadge, Liters, NoStockNote, TANKER_BASE, TextField, ChoiceCard, describeFillFailure, mayHaveApplied, shouldClearKey } from './parts';
import { createPendingStore, type PendingAttempt } from './pending';
import type { TankerFill } from './schemas';

/**
 * TANKER-PR7 — معالج تسجيل تعبئة صهريج من تطبيق المحطات (أربع خطوات: الصاحب والصهريج ← المضخة والفوهة ← الكمية والسند ← المراجعة والحفظ).
 *
 * - **الوردية الحالية تلقائياً** (المفتوحة للمحطة) تُعرض ولا تُختار؛ بلا وردية مفتوحة لا يبدأ المعالج. المنتج والخزان يُشتقان من الفوهة للقراءة فقط.
 * - **الخادم السلطة** (الصلاحيات، الفوهة، السعة، السند المكرر، السياسة): الواجهة إرشاد وتحقق مبكر، وأي رفض يعيد الموظف إلى الخطوة المعنيّة.
 * - **لا تكرار ولا إعادة تلقائية**: مفتاح idempotency مستقل لكل نية (يُحفظ غير مؤكداً قبل الإرسال)، والنتيجة غير المؤكدة تُحسم بالقراءة («تحقق من الحالة») ولا يُسمح بسند جديد قبل حسمها.
 * - **التسجيل لا يخصم المخزون**: الحالة تبقى «بانتظار الدمج المخزني» حتى ترحيل مخوَّل (تنبيه ثابت في المراجعة والنجاح).
 */

const INTENT = 'tanker-fill';

type Phase =
  | { name: 'wizard' }
  | { name: 'sending' }
  | { name: 'done'; fill: TankerFill; replayed: boolean };

function problemKey(problem: StepProblem): string {
  return `tankerFill.problem.${problem}`;
}

function Header({ station, shiftNumber }: { station: Station; shiftNumber: string | null }) {
  const t = useTranslations('stationOps');
  return (
    <SectionCard>
      <dl className="grid grid-cols-2 gap-3 text-sm" data-shift-card="">
        <div><dt className="text-xs text-muted">{t('tankerFill.header.station')}</dt><dd className="font-semibold text-text">{station.name}</dd></div>
        <div><dt className="text-xs text-muted">{t('tankerFill.header.shift')}</dt><dd className="num font-semibold text-text" dir="ltr">{shiftNumber ?? '—'}</dd></div>
      </dl>
    </SectionCard>
  );
}

function StepBar({ step }: { step: Step }) {
  const t = useTranslations('stationOps');
  const index = STEPS.indexOf(step);
  return (
    <nav aria-label={t('tankerFill.steps.label')} data-step={step}>
      <ol className="flex items-center gap-2">
        {STEPS.map((name, i) => (
          <li key={name} aria-current={i === index ? 'step' : undefined} className={`flex-1 rounded-full px-2 py-1 text-center text-xs font-semibold ${i === index ? 'bg-primary text-[color:var(--fo-cta-fg)]' : i < index ? 'bg-primary-soft text-primary' : 'bg-background text-muted'}`}>
            <span className="num">{i + 1}</span> <span className="max-sm:sr-only">{t(`tankerFill.steps.${name}`)}</span>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function TankerFillNewScreen() {
  const t = useTranslations('stationOps');
  return (
    <>
      <PageMasthead title={t('tankerFill.new.title')} subtitle={t('tankerFill.new.subtitle')} backHref={TANKER_BASE} backLabel={t('tankerFill.backToList')} />
      <ScreenBody>
        <StationGate>{(station) => <Flow station={station} />}</StationGate>
      </ScreenBody>
    </>
  );
}

function Flow({ station }: { station: Station }) {
  const t = useTranslations('stationOps');
  const { scopeKey } = useStationOps();
  const access = useTankerFillAccess();
  const feature = useTankerFillFeature(station);
  const current = useCurrentShift(station);

  if (!access.canStart) {
    return <EmptyState title={t('tankerFill.noAccess.title')} body={t('tankerFill.noAccess.body')} />;
  }
  if (feature.state === 'checking') return <LoadingBlock rows={2} />;
  if (feature.state === 'closed') return <EmptyState title={t('tankerFill.closed.title')} body={t('tankerFill.closed.body')} />;
  if (feature.state === 'forbidden') return <EmptyState title={t('tankerFill.noAccess.title')} body={t('tankerFill.noAccess.body')} />;
  if (feature.state === 'unavailable') return <ErrorState error={new StationOpsError('server')} onRetry={feature.reload} />;
  if (current.state.status === 'loading') return <LoadingBlock rows={2} />;
  if (current.state.status === 'error') return <ErrorState error={current.state.error} onRetry={current.reload} />;
  const shift = current.state.data.shift;
  if (!shift) {
    // محاولة غير محسومة سابقة تبقى قابلة للحسم (قراءة فقط) حتى بعد إغلاق الوردية؛ **التسجيل الجديد** وحده مشروط بوردية مفتوحة.
    if (createPendingStore(`${scopeKey}|${station.id}`).load()) return <Wizard station={station} shiftId={null} shiftNumber={null} reloadShift={current.reload} />;
    return (
      <div data-no-open-shift="" className="space-y-3 pt-5">
        <EmptyState title={t('tankerFill.noShift.title')} body={t('tankerFill.noShift.body')} />
        <SecondaryButton onClick={current.reload}>{t('write.check')}</SecondaryButton>
      </div>
    );
  }
  return <Wizard station={station} shiftId={shift.id} shiftNumber={shift.number} reloadShift={current.reload} />;
}

function Wizard({ station, shiftId, shiftNumber, reloadShift }: { station: Station; shiftId: string | null; shiftNumber: string | null; reloadShift: () => void }) {
  const t = useTranslations('stationOps');
  const { scopeKey } = useStationOps();
  const assets = useStationAssets(station);
  const { policy } = useTankerPolicy(station);
  const intents = useMemo(() => createIntentStore(`${scopeKey}|${station.id}|tanker`), [scopeKey, station.id]);
  const pendingStore = useMemo(() => createPendingStore(`${scopeKey}|${station.id}`), [scopeKey, station.id]);
  const submitting = useRef(false);

  const [step, setStep] = useState<Step>('owner');
  const [draft, setDraft] = useState<FillDraft>(EMPTY_DRAFT);
  const [phase, setPhase] = useState<Phase>({ name: 'wizard' });
  const [failure, setFailure] = useState<FillWriteResult | null>(null);
  const [pending, setPending] = useState<PendingAttempt | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<'not_found' | 'error' | null>(null);

  useEffect(() => { setPending(pendingStore.load()); }, [pendingStore]);

  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search), 300);
    return () => window.clearTimeout(timer);
  }, [search]);
  const owners = useOwners(station, debounced);
  const tankersQuery = useOwnerTankers(station, draft.ownerId);
  const tankers = useMemo(() => (tankersQuery.state.status === 'success' ? tankersQuery.state.data.rows : []), [tankersQuery.state]);

  const groups = useMemo(() => (assets.catalog ? pumpChoices(assets.catalog) : []), [assets.catalog]);
  const eligibleIds = useMemo(() => new Set(groups.flatMap((group) => group.nozzles.filter((choice) => choice.eligible).map((choice) => choice.view.nozzle.id))), [groups]);
  const ctx: StepContext = useMemo(() => ({ tankers, policy, eligibleNozzleIds: eligibleIds }), [tankers, policy, eligibleIds]);

  // صهريج واحد نشط للصاحب ⇒ يُختار تلقائياً (يمكن إلغاؤه إن سمحت السياسة). مرة واحدة لكل صاحب كي لا يعيد اختياره بعد إلغاء الموظف له.
  const autoPicked = useRef<string | null>(null);
  useEffect(() => {
    if (draft.ownerId && tankersQuery.state.status === 'success' && tankers.length === 1 && autoPicked.current !== draft.ownerId) {
      autoPicked.current = draft.ownerId;
      setDraft((d) => (d.ownerId === autoPicked.current && d.tankerId === null ? { ...d, tankerId: tankers[0].id } : d));
    }
  }, [draft.ownerId, tankers, tankersQuery.state.status]);

  const update = (patch: Partial<FillDraft>) => { setDraft((d) => ({ ...d, ...patch })); setFailure(null); };
  const pickOwner = (ownerId: string) => {
    if (ownerId === draft.ownerId) return;
    autoPicked.current = null;
    update({ ownerId, tankerId: null, confirmOverrun: false });
  };

  const tanker = tankers.find((row) => row.id === draft.tankerId) ?? null;
  const owner = owners.state.status === 'success' ? owners.state.data.rows.find((row) => row.id === draft.ownerId) ?? null : null;
  const ownerName = owner?.name ?? (draft.ownerId ? t('tankerFill.review.ownerSelected') : '');
  const nozzleChoice = groups.flatMap((group) => group.nozzles.map((choice) => ({ group, choice }))).find(({ choice }) => choice.view.nozzle.id === draft.nozzleId) ?? null;
  const quantity = parseLiters(draft.quantityInput);
  const capacity = capacityCheck(quantity.ok ? quantity.milliliters : null, tanker?.capacity_milliliters, policy.overrun);

  const resetAll = () => {
    setDraft(EMPTY_DRAFT); setStep('owner'); setFailure(null); setSearch(''); setDebounced(''); setPhase({ name: 'wizard' }); setCheckResult(null); autoPicked.current = null;
  };

  /** نتيجة الإرسال/إعادة الإرسال: يُعلَن النجاح فقط إن طابق ردّ الخادم ما أُرسل، وغير المؤكد يُحفظ لحسمه ولا يُنشأ بعده سند جديد. */
  const settle = useCallback((result: FillWriteResult, body: FillBody, priorUncertain: boolean) => {
    const matches = result.kind === 'ok'
      && result.fill.fuel_station_id === body.fuel_station_id && result.fill.fuel_nozzle_id === body.fuel_nozzle_id
      && result.fill.fuel_tanker_owner_id === body.fuel_tanker_owner_id && result.fill.quantity_milliliters === body.quantity_milliliters
      && result.fill.voucher_number === body.voucher_number;
    if (result.kind === 'ok' && matches) {
      intents.clear(INTENT);
      pendingStore.clear();
      setPending(null);
      setFailure(null);
      setPhase({ name: 'done', fill: result.fill, replayed: result.replayed });
      return;
    }
    const effective: FillWriteResult = result.kind === 'ok' ? { kind: 'unverified' } : result;
    if (shouldClearKey(effective, priorUncertain)) {
      intents.clear(INTENT);
      pendingStore.clear(); // رفض نهائي/لم يُرسل: المحاولة التي حُفظت قبل الإرسال لم تعد معلّقة
    }
    if (mayHaveApplied(effective)) {
      pendingStore.save(body);
      setPending(pendingStore.load());
    }
    const described = describeFillFailure(effective);
    if (described?.shiftChanged) reloadShift();
    if (described?.step) setStep(described.step);
    setFailure(effective);
    setPhase({ name: 'wizard' });
  }, [intents, pendingStore, reloadShift]);

  const submit = useCallback(async () => {
    if (submitting.current) return;
    if (!shiftId) return;
    const payload = buildIntentPayload({ stationId: station.id, shiftId, draft, tankers, policy });
    if (!payload) return;
    const invalid = firstInvalidStep(draft, ctx);
    if (invalid !== null) { setStep(invalid); return; } // معلومات وصلت متأخرة (مثلاً صهاريج الصاحب) ⇒ يعود الموظف إلى الخطوة التي تشرح المطلوب بدل زر حفظ صامت
    submitting.current = true;
    setFailure(null);
    setPhase({ name: 'sending' });
    try {
      const key = intents.keyFor(INTENT, payload);
      // الطلب الجاري قد يلتزم قبل أن تُغلق الصفحة: تُعلَّم النية غير مؤكدة (ومحفوظة) **قبل** الإرسال، وتُسوّى بعد النتيجة.
      const priorUncertain = intents.isUncertain(INTENT);
      intents.markUncertain(INTENT);
      const body: FillBody = { ...payload, idempotency_key: key };
      // تُحفظ المحاولة كاملةً **قبل** الإرسال: إغلاق الصفحة أثناء الطلب (قد يلتزم الخادم) يترك «تحقّق من الحالة» متاحاً عند العودة. تُمسح عند أي نتيجة حاسمة.
      pendingStore.save(body);
      settle(await recordFill(body, { branchId: station.branch_id }), body, priorUncertain);
    } finally {
      submitting.current = false;
    }
  }, [ctx, draft, intents, pendingStore, policy, settle, shiftId, station.branch_id, station.id, tankers]);

  /** «تحقق من الحالة» لمحاولة غير محسومة: **قراءة فقط**. وُجد السند ⇒ نجاح مؤكد؛ لم يوجد ⇒ للموظف أن يعيد الإرسال بالمفتاح نفسه صراحةً أو يتجاهل. */
  const checkPending = useCallback(async () => {
    if (!pending || checking) return;
    setChecking(true);
    setCheckResult(null);
    try {
      const { idempotency_key: _key, ...payload } = pending.body;
      const found = await findRecordedFill(payload as IntentPayload, { branchId: station.branch_id, attemptAt: pending.at });
      if (found) {
        intents.clear(INTENT);
        pendingStore.clear();
        setPending(null);
        setPhase({ name: 'done', fill: found, replayed: true });
      } else {
        setCheckResult('not_found');
      }
    } catch {
      setCheckResult('error');
    } finally {
      setChecking(false);
    }
  }, [checking, intents, pending, pendingStore, station.branch_id]);

  const resendPending = useCallback(async () => {
    if (!pending || submitting.current) return;
    submitting.current = true;
    setPhase({ name: 'sending' });
    try {
      settle(await recordFill(pending.body, { branchId: station.branch_id }), pending.body, true);
    } finally {
      submitting.current = false;
    }
  }, [pending, settle, station.branch_id]);

  const discardPending = () => {
    intents.clear(INTENT);
    pendingStore.clear();
    setPending(null);
    setCheckResult(null);
    setFailure(null);
  };

  // ───────────── عرض ─────────────

  if (assets.state.status === 'loading') return <div className="pt-5"><LoadingBlock rows={2} /></div>;
  if (assets.state.status === 'error') return <div className="pt-5"><ErrorState error={assets.state.error} onRetry={assets.reload} /></div>;

  if (phase.name === 'done') return <SuccessPanel fill={phase.fill} replayed={phase.replayed} station={station} onAnother={resetAll} />;

  if (pending) {
    const body = pending.body;
    return (
      <div className="space-y-4 pt-5" data-pending-attempt="">
        <Header station={station} shiftNumber={shiftNumber} />
        <SectionCard title={t('tankerFill.pending.title')}>
          <p className="text-sm leading-6 text-text">{t('tankerFill.pending.body')}</p>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-xs text-muted">{t('tankerFill.field.voucher')}</dt><dd className="num font-semibold text-text" dir="ltr">{body.voucher_number}</dd></div>
            <div><dt className="text-xs text-muted">{t('tankerFill.field.quantity')}</dt><dd className="font-semibold text-text"><Liters ml={body.quantity_milliliters} /></dd></div>
          </dl>
        </SectionCard>
        {checkResult === 'not_found' ? <InlineNote tone="warning">{t('tankerFill.pending.notFound')}</InlineNote> : null}
        {checkResult === 'error' ? <InlineNote tone="warning">{t('tankerFill.pending.checkFailed')}</InlineNote> : null}
        <FillNotice failure={failure ? describeFillFailure(failure) : null} />
        <PrimaryButton onClick={() => void checkPending()} disabled={checking || phase.name === 'sending'}>{checking ? t('write.checking') : t('write.check')}</PrimaryButton>
        {checkResult === 'not_found' ? (
          <>
            <SecondaryButton onClick={() => void resendPending()} disabled={phase.name === 'sending'} data-resend="">{t('tankerFill.pending.resend')}</SecondaryButton>
            <SecondaryButton onClick={discardPending} disabled={phase.name === 'sending'} data-discard="">{t('tankerFill.pending.discard')}</SecondaryButton>
          </>
        ) : null}
      </div>
    );
  }

  // بلا وردية مفتوحة (بعد حسم محاولة سابقة): لا تسجيل جديد.
  if (!shiftId) {
    return (
      <div data-no-open-shift="" className="space-y-3 pt-5">
        <EmptyState title={t('tankerFill.noShift.title')} body={t('tankerFill.noShift.body')} />
        <SecondaryButton onClick={reloadShift}>{t('write.check')}</SecondaryButton>
      </div>
    );
  }

  const here = STEPS.indexOf(step);
  const problem = stepProblem(step, draft, ctx);
  // لا تقدّم من خطوة الصاحب قبل اكتمال تحميل صهاريجه (وإلا يُفترض «لا صهاريج» فيفوت اختيار مطلوب)؛ فشل التحميل يُحلّ بإعادة المحاولة المعروضة.
  const tankersReady = step !== 'owner' || !draft.ownerId || tankersQuery.state.status === 'success';
  const canContinue = problem === null && tankersReady;
  const next = () => { if (canContinue) setStep(STEPS[here + 1]); };
  const back = () => { setFailure(null); setStep(STEPS[Math.max(0, here - 1)]); };
  const sending = phase.name === 'sending';

  return (
    <div className="space-y-4 pt-5" data-tanker-wizard="" data-station-id={station.id}>
      <Header station={station} shiftNumber={shiftNumber} />
      <StepBar step={step} />
      <FillNotice failure={failure ? describeFillFailure(failure) : null} onCheck={failure && mayHaveApplied(failure) ? () => void checkPending() : undefined} checking={checking} />

      {step === 'owner' ? (
        <OwnerStep
          draft={draft} policy={policy} search={search} onSearch={setSearch} owners={owners.state} onRetryOwners={owners.reload}
          tankersState={tankersQuery.state} onRetryTankers={tankersQuery.reload} onOwner={pickOwner} onTanker={(tankerId) => update({ tankerId, confirmOverrun: false })}
        />
      ) : null}
      {step === 'nozzle' ? <NozzleStep groups={groups} selectedId={draft.nozzleId} onSelect={(nozzleId) => update({ nozzleId })} eligibleCount={eligibleNozzleCount(groups)} /> : null}
      {step === 'quantity' ? <QuantityStep draft={draft} onChange={update} capacityMode={capacity.mode} overrunMl={capacity.overrunMilliliters} tankerCapacity={tanker?.capacity_milliliters ?? null} plate={tanker?.plate_number ?? null} /> : null}
      {step === 'review' ? (
        <ReviewStep
          station={station} shiftNumber={shiftNumber ?? '—'} ownerName={ownerName} plate={tanker?.plate_number ?? null}
          pump={nozzleChoice?.group.pump.pump_number ?? ''} nozzle={nozzleChoice?.choice.view.nozzle.nozzle_number ?? ''}
          product={nozzleChoice?.choice.view.product?.name ?? ''} tank={nozzleChoice?.choice.view.tank?.name ?? ''}
          liters={quantity.ok ? quantity.liters : ''} voucher={(() => { const v = normalizeVoucher(draft.voucherInput); return v.ok ? v.value : ''; })()}
          overrunMl={capacity.mode === 'confirm' && draft.confirmOverrun ? capacity.overrunMilliliters : capacity.mode === 'allow' ? capacity.overrunMilliliters : 0}
        />
      ) : null}

      {step !== 'review' && problem && showProblem(step, draft, problem) ? <InlineNote tone="warning">{t(problemKey(problem))}</InlineNote> : null}

      <div className="space-y-2" data-wizard-actions="">
        {step === 'review' ? (
          <PrimaryButton onClick={() => void submit()} disabled={sending} data-save="">{sending ? t('tankerFill.review.saving') : t('tankerFill.review.save')}</PrimaryButton>
        ) : (
          <PrimaryButton onClick={next} disabled={!canContinue} data-next="">{t('tankerFill.next')}</PrimaryButton>
        )}
        {here > 0 ? <SecondaryButton onClick={back} disabled={sending} data-back="">{t('tankerFill.back')}</SecondaryButton> : null}
      </div>
    </div>
  );
}

/** لا نُظهر «مطلوب» كخطأ قبل أن يبدأ الموظف الخطوة؛ تُعرض المشكلة حين يكون فيها إدخال أو اختيار مطلوب للمتابعة. */
function showProblem(step: Step, draft: FillDraft, problem: StepProblem): boolean {
  if (step === 'owner') return problem === 'tanker_required' || draft.ownerId !== null;
  if (step === 'nozzle') return false;
  if (step === 'quantity') return problem === 'capacity_confirmation_required' ? false : draft.quantityInput.trim() !== '' || draft.voucherInput.trim() !== '';
  return false;
}

// ───────────────────────── الخطوات ─────────────────────────

function OwnerStep({ draft, policy, search, onSearch, owners, onRetryOwners, tankersState, onRetryTankers, onOwner, onTanker }: {
  draft: FillDraft;
  policy: ReturnType<typeof useTankerPolicy>['policy'];
  search: string;
  onSearch: (value: string) => void;
  owners: ReturnType<typeof useOwners>['state'];
  onRetryOwners: () => void;
  tankersState: ReturnType<typeof useOwnerTankers>['state'];
  onRetryTankers: () => void;
  onOwner: (id: string) => void;
  onTanker: (id: string | null) => void;
}) {
  const t = useTranslations('stationOps');
  const locale = useLocale();
  const tankers = tankersState.status === 'success' ? tankersState.data.rows : [];
  const required = policy.selectionRequired === true;
  return (
    <div className="space-y-4">
      <SectionCard title={t('tankerFill.owner.title')} id="tf-owner">
        <TextField label={t('tankerFill.owner.search')} type="search" dir="auto" value={search} onChange={onSearch} testId="owner-search" />
        <div className="mt-3 space-y-2" role="radiogroup" aria-labelledby="tf-owner" data-owner-list="">
          {owners.status === 'loading' ? <LoadingBlock rows={2} /> : null}
          {owners.status === 'error' ? <ErrorState error={owners.error} onRetry={onRetryOwners} /> : null}
          {owners.status === 'success' && owners.data.rows.length === 0 ? <InlineNote>{search.trim() ? t('tankerFill.owner.noResults') : t('tankerFill.owner.none')}</InlineNote> : null}
          {owners.status === 'success' ? owners.data.rows.map((row) => (
            <ChoiceCard key={row.id} testId={`owner-${row.id}`} selected={draft.ownerId === row.id} onSelect={() => onOwner(row.id)} title={row.name} hint={row.code ? <span dir="ltr" className="num">{row.code}</span> : undefined} />
          )) : null}
          {owners.status === 'success' && owners.data.truncated ? <InlineNote>{t('tankerFill.owner.truncated')}</InlineNote> : null}
        </div>
      </SectionCard>

      {draft.ownerId ? (
        <SectionCard title={t('tankerFill.tanker.title')} id="tf-tanker">
          <p className="mb-3 text-sm text-muted" data-tanker-policy={required ? 'required' : policy.selectionRequired === false ? 'optional' : 'unknown'}>
            {required ? t('tankerFill.tanker.required') : t('tankerFill.tanker.optional')}
          </p>
          {tankersState.status === 'loading' ? <LoadingBlock rows={1} /> : null}
          {tankersState.status === 'error' ? <ErrorState error={tankersState.error} onRetry={onRetryTankers} /> : null}
          {tankersState.status === 'success' ? (
            <div className="space-y-2" role="radiogroup" aria-labelledby="tf-tanker" data-tanker-list="">
              {tankers.length === 0 ? <InlineNote>{t('tankerFill.tanker.noneRegistered')}</InlineNote> : null}
              {tankers.map((row) => (
                <ChoiceCard
                  key={row.id}
                  testId={`tanker-${row.id}`}
                  selected={draft.tankerId === row.id}
                  onSelect={() => onTanker(row.id)}
                  title={<bdi>{row.plate_number}</bdi>}
                  hint={row.capacity_milliliters ? t('tankerFill.tanker.capacity', { liters: formatCapacity(row.capacity_milliliters, locale) }) : t('tankerFill.tanker.capacityUnknown')}
                />
              ))}
              {tankers.length > 0 && !required ? (
                <ChoiceCard testId="tanker-none" selected={draft.tankerId === null} onSelect={() => onTanker(null)} title={t('tankerFill.tanker.withoutTanker')} hint={t('tankerFill.tanker.withoutHint')} />
              ) : null}
              {tankersState.data.truncated ? <InlineNote>{t('tankerFill.owner.truncated')}</InlineNote> : null}
            </div>
          ) : null}
        </SectionCard>
      ) : null}
    </div>
  );
}

function formatCapacity(ml: number, locale: string): string {
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-SA-u-nu-latn' : 'en-US', { maximumFractionDigits: 3 }).format(Number(litersFromMl(ml)));
}

function NozzleStep({ groups, selectedId, onSelect, eligibleCount }: { groups: ReturnType<typeof pumpChoices>; selectedId: string | null; onSelect: (id: string) => void; eligibleCount: number }) {
  const t = useTranslations('stationOps');
  if (eligibleCount === 0) return <EmptyState title={t('tankerFill.nozzle.noneTitle')} body={t('tankerFill.nozzle.noneBody')} />;
  let selected: ReturnType<typeof pumpChoices>[number]['nozzles'][number] | null = null;
  for (const group of groups) for (const choice of group.nozzles) if (choice.view.nozzle.id === selectedId) selected = choice;
  return (
    <div className="space-y-4" data-nozzle-step="">
      {groups.map((group) => (
        <SectionCard key={group.pump.id} title={t('tankerFill.nozzle.pump', { number: group.pump.pump_number })}>
          <div className="space-y-2" role="radiogroup" aria-label={t('tankerFill.nozzle.pump', { number: group.pump.pump_number })}>
            {group.nozzles.map((choice) => (
              <ChoiceCard
                key={choice.view.nozzle.id}
                testId={`nozzle-${choice.view.nozzle.id}`}
                selected={selectedId === choice.view.nozzle.id}
                disabled={!choice.eligible}
                onSelect={() => onSelect(choice.view.nozzle.id)}
                title={t('tankerFill.nozzle.nozzle', { number: choice.view.nozzle.nozzle_number })}
                hint={choice.view.product?.name ?? undefined}
                reason={choice.reason ? t(`tankerFill.nozzle.blocked.${choice.reason}`) : null}
              />
            ))}
          </div>
        </SectionCard>
      ))}
      {selected ? (
        <SectionCard title={t('tankerFill.nozzle.derived')}>
          <dl className="grid grid-cols-2 gap-3 text-sm" data-derived="">
            <div><dt className="text-xs text-muted">{t('tankerFill.field.product')}</dt><dd className="font-semibold text-text">{selected.view.product?.name ?? '—'}</dd></div>
            <div><dt className="text-xs text-muted">{t('tankerFill.field.tank')}</dt><dd className="font-semibold text-text">{selected.view.tank?.name ?? '—'}</dd></div>
          </dl>
          <p className="mt-2 text-xs text-muted">{t('tankerFill.nozzle.derivedNote')}</p>
        </SectionCard>
      ) : null}
    </div>
  );
}

function QuantityStep({ draft, onChange, capacityMode, overrunMl, tankerCapacity, plate }: {
  draft: FillDraft;
  onChange: (patch: Partial<FillDraft>) => void;
  capacityMode: 'none' | 'confirm' | 'block' | 'allow';
  overrunMl: number;
  tankerCapacity: number | null;
  plate: string | null;
}) {
  const t = useTranslations('stationOps');
  const quantity = parseLiters(draft.quantityInput);
  const voucher = normalizeVoucher(draft.voucherInput);
  const quantityError = draft.quantityInput.trim() !== '' && !quantity.ok ? t(`tankerFill.problem.quantity_${quantity.problem}`) : null;
  const voucherError = draft.voucherInput.trim() !== '' && !voucher.ok ? t(`tankerFill.problem.voucher_${voucher.problem}`) : null;
  const normalisedHint = voucher.ok && voucher.value !== draft.voucherInput ? t('tankerFill.voucher.willSave', { value: voucher.value }) : t('tankerFill.voucher.hint');
  return (
    <div className="space-y-4" data-quantity-step="">
      <SectionCard>
        <div className="space-y-4">
          <NumberField
            label={t('tankerFill.field.quantity')}
            value={draft.quantityInput}
            onChange={(value) => onChange({ quantityInput: value, confirmOverrun: false })}
            suffix={t('tankerFill.liters')}
            hint={t('tankerFill.quantity.hint')}
            error={quantityError}
            testId="quantity-input"
          />
          <TextField label={t('tankerFill.field.voucher')} value={draft.voucherInput} onChange={(value) => onChange({ voucherInput: value })} hint={normalisedHint} error={voucherError} maxLength={80} testId="voucher-input" />
        </div>
      </SectionCard>

      {capacityMode === 'confirm' ? (
        <div role="alert" data-capacity="confirm" className="space-y-3 rounded-[14px] border border-warning bg-[color:var(--fo-warning-tint)] p-3.5 text-sm leading-6 text-text">
          <p>{t('tankerFill.capacity.over', { overrun: litersFromMl(overrunMl), capacity: litersFromMl(tankerCapacity ?? 0), plate: plate ?? '' })}</p>
          <label className="flex min-h-12 cursor-pointer items-center gap-3 font-semibold">
            <input type="checkbox" checked={draft.confirmOverrun} onChange={(event) => onChange({ confirmOverrun: event.target.checked })} data-confirm-overrun="" className="h-6 w-6 shrink-0" />
            <span>{t('tankerFill.capacity.confirm')}</span>
          </label>
        </div>
      ) : null}
      {capacityMode === 'block' ? <p role="alert" data-capacity="block" className="rounded-[14px] bg-[color:var(--fo-negative-tint)] p-3.5 text-sm leading-6 text-negative">{t('tankerFill.capacity.blocked', { overrun: litersFromMl(overrunMl) })}</p> : null}
      {capacityMode === 'allow' ? <InlineNote tone="warning">{t('tankerFill.capacity.allowed', { overrun: litersFromMl(overrunMl) })}</InlineNote> : null}
    </div>
  );
}

function ReviewStep({ station, shiftNumber, ownerName, plate, pump, nozzle, product, tank, liters, voucher, overrunMl }: {
  station: Station; shiftNumber: string; ownerName: string; plate: string | null; pump: string; nozzle: string; product: string; tank: string; liters: string; voucher: string; overrunMl: number;
}) {
  const t = useTranslations('stationOps');
  const rows: Array<[string, ReactNode]> = [
    [t('tankerFill.header.station'), station.name],
    [t('tankerFill.header.shift'), <span key="s" className="num" dir="ltr">{shiftNumber}</span>],
    [t('tankerFill.field.owner'), ownerName],
    [t('tankerFill.field.tanker'), plate ? <bdi key="p">{plate}</bdi> : t('tankerFill.review.noTanker')],
    [t('tankerFill.field.pump'), <span key="u" className="num" dir="ltr">{pump}</span>],
    [t('tankerFill.field.nozzle'), <span key="n" className="num" dir="ltr">{nozzle}</span>],
    [t('tankerFill.field.product'), product],
    [t('tankerFill.field.tank'), tank],
    [t('tankerFill.field.quantity'), <span key="q" className="num" dir="ltr" data-review-liters="">{liters} {t('tankerFill.liters')}</span>],
    [t('tankerFill.field.voucher'), <span key="v" className="num" dir="ltr" data-review-voucher="">{voucher}</span>],
  ];
  return (
    <div className="space-y-4" data-review-step="">
      <SectionCard title={t('tankerFill.review.title')}>
        <dl className="divide-y divide-border text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-start justify-between gap-4 py-2.5"><dt className="text-muted">{label}</dt><dd className="min-w-0 text-end font-semibold text-text">{value}</dd></div>
          ))}
        </dl>
        {overrunMl > 0 ? <p className="mt-2 text-sm text-warning" data-review-overrun="">{t('tankerFill.review.overrun', { overrun: litersFromMl(overrunMl) })}</p> : null}
      </SectionCard>
      <NoStockNote />
      <p className="text-sm leading-6 text-muted">{t('tankerFill.review.noEdit')}</p>
    </div>
  );
}

function SuccessPanel({ fill, replayed, station, onAnother }: { fill: TankerFill; replayed: boolean; station: Station; onAnother: () => void }) {
  const t = useTranslations('stationOps');
  return (
    <div className="space-y-4 pt-5" data-fill-success="" data-fill-id={fill.id}>
      <SectionCard>
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[color:var(--fo-positive-tint)] text-positive"><CircleCheck className="h-6 w-6" strokeWidth={1.9} /></span>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-text">{replayed ? t('tankerFill.success.replayed') : t('tankerFill.success.title')}</h2>
            <p className="mt-1 text-sm leading-6 text-muted">{t('tankerFill.success.number')}: <span className="num font-semibold text-text" dir="ltr" data-fill-number="">{fill.number}</span></p>
          </div>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div><dt className="text-xs text-muted">{t('tankerFill.field.voucher')}</dt><dd className="num font-semibold text-text" dir="ltr">{fill.voucher_number}</dd></div>
          <div><dt className="text-xs text-muted">{t('tankerFill.field.quantity')}</dt><dd className="font-semibold text-text"><Liters ml={fill.quantity_milliliters} /></dd></div>
          <div><dt className="text-xs text-muted">{t('tankerFill.header.station')}</dt><dd className="font-semibold text-text">{station.name}</dd></div>
          <div><dt className="text-xs text-muted">{t('tankerFill.field.status')}</dt><dd><FillStatusBadge fill={fill} /></dd></div>
        </dl>
      </SectionCard>
      <NoStockNote />
      <PrimaryButton onClick={onAnother} data-another="">{t('tankerFill.success.another')}</PrimaryButton>
      <Link href={`${TANKER_BASE}/${encodeURIComponent(fill.id)}`} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-[13px] border border-[color:var(--fo-control)] bg-surface px-4 text-[15px] font-bold text-text hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        {t('tankerFill.success.open')}
        <ArrowRight aria-hidden="true" className="h-4 w-4 ltr:rotate-0 rtl:rotate-180" strokeWidth={1.9} />
      </Link>
      <Link href={TANKER_BASE} className="flex min-h-12 w-full items-center justify-center rounded-[13px] px-4 text-[15px] font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{t('tankerFill.success.list')}</Link>
    </div>
  );
}

