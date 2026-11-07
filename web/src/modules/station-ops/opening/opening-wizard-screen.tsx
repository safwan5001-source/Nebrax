'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CheckCircle2, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useStationOps } from '../context';
import { useStationAssets } from '../data';
import { createIntentStore } from '../intents';
import { PageMasthead, ScreenBody } from '../masthead';
import { OPS_BASE } from '../nav';
import { StationOpsError } from '../read-client';
import type { Station } from '../schemas';
import { EmptyState, ErrorState, LoadingBlock } from '../state-views';
import { StationGate } from '../station-gate';
import { ActionBar, ConfirmDialog, NumberField, PrimaryButton, SecondaryButton, SectionCard } from '../write-ui';
import { useConfiguredAccounts, useOpeningAccess, useOpeningAccounts, useOpeningDoc, useOpeningDocs } from './data';
import {
  EMPTY_FORM, STEPS, accountSource, bodyFingerprint, buildDraftBody, draftMatchesBody, eligibleAccounts, evaluateCosts, evaluateTanks, formFromDraft, isValidDate, planAccount,
  productTotals, todayLocal, type StepId, type TankInfo, type WizardForm,
} from './logic';
import { createOpeningDraft, getOpeningDoc, getOpeningPreview, listOpeningDocs, postOpening, saveOpeningAccount, updateOpeningDraft } from './opening-client';
import { BlockerList, FailureNotice, Liters, Money, OPENING_BASE, type AnyFailure } from './parts';
import type { OpeningAccount, OpeningDoc, OpeningPreview } from './schemas';

/**
 * PR-2 — معالج الرصيد الافتتاحي للوقود (ثلاث خطوات، جوال أولاً). فوق عقد PR-1 بلا أي قاعدة جديدة:
 * الكميات تُجمع محلياً ← الخطوة الثانية تُحدّد التكلفة والحساب ← المراجعة تحفظ **مسودة** ثم تعرض معاينة الخادم؛ **الترحيل فعلٌ منفصل** بحوار تأكيد.
 * لا قيمة افتراضية لكمية أو تكلفة أو حساب. غير المؤكد بعد الإرسال يُحسم بقراءة الحالة لا بإعادة الإرسال.
 */

const INTENT = 'opening-create';
const FIELD = 'mt-1.5 w-full rounded-[11px] border border-[color:var(--fo-control)] bg-surface px-3 text-base text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60';

export function OpeningWizardScreen() {
  const t = useTranslations('stationOpsOpening');
  return (
    <>
      <PageMasthead title={t('title')} subtitle={t('subtitle')} backHref={`${OPS_BASE}/manage`} backLabel={t('nav.back')} />
      <ScreenBody>
        <StationGate>{(station) => <Entry station={station} />}</StationGate>
      </ScreenBody>
    </>
  );
}

// ───────────────────────── المدخل: البوابة والاستئناف والمرحَّل ─────────────────────────

function Entry({ station }: { station: Station }) {
  const t = useTranslations('stationOpsOpening');
  const access = useOpeningAccess();
  const docs = useOpeningDocs(station);
  const rows = docs.state.status === 'success' ? docs.state.data : null;
  const posted = rows?.find((row) => row.status === 'posted') ?? null;
  const draftId = rows && !posted ? (rows.find((row) => row.status === 'draft')?.id ?? null) : null;
  const draft = useOpeningDoc(station, draftId);

  if (!access.view) return <ErrorState error={new StationOpsError('forbidden', 403)} />;
  if (docs.state.status === 'loading') return <LoadingBlock />;
  if (docs.state.status === 'error') {
    // 404 = بوابة النشر مغلقة: الميزة غير متاحة لهذه المؤسسة (لا خيار غير مدعوم يُعرض).
    if (docs.state.error.kind === 'not_found') return <EmptyState title={t('unavailable.title')} body={t('unavailable.body')} />;
    return <ErrorState error={docs.state.error} onRetry={docs.reload} />;
  }
  if (posted) return <PostedView doc={posted} already />;
  if (!access.draft) return <EmptyState title={t('noAccess.title')} body={t('noAccess.body')} />;
  if (draftId) {
    if (draft.state.status === 'loading') return <LoadingBlock />;
    if (draft.state.status === 'error') return <ErrorState error={draft.state.error} onRetry={draft.reload} />;
    return <Wizard key={draftId} station={station} initialDoc={draft.state.data} />;
  }
  return <Wizard key="new" station={station} initialDoc={null} />;
}

function PostedView({ doc, already = false }: { doc: OpeningDoc; already?: boolean }) {
  const t = useTranslations('stationOpsOpening');
  return (
    <section data-posted="" className="space-y-4">
      <div role="status" className="flex items-start gap-3 rounded-[14px] border border-border bg-[color:var(--fo-positive-tint)] p-4 text-positive">
        <CheckCircle2 aria-hidden="true" className="mt-0.5 h-6 w-6 shrink-0" strokeWidth={1.8} />
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{already ? t('posted.alreadyTitle') : t('posted.title')}</h2>
          <p className="mt-1 text-sm leading-6">{already ? t('posted.alreadyBody') : t('posted.body', { number: doc.number, date: doc.opening_date })}</p>
        </div>
      </div>
      <SectionCard>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div><dt className="text-muted">{t('posted.liters')}</dt><dd className="mt-1 text-lg font-semibold"><Liters ml={doc.total_milliliters} /></dd></div>
          {typeof doc.total_value_minor === 'number' ? <div><dt className="text-muted">{t('posted.value')}</dt><dd className="mt-1 text-lg font-semibold"><Money minor={doc.total_value_minor} /></dd></div> : null}
          <div><dt className="text-muted">{t('posted.tanks')}</dt><dd className="num mt-1 text-lg font-semibold">{doc.lines?.length ?? '—'}</dd></div>
          <div><dt className="text-muted" dir="auto">{doc.number}</dt><dd className="num mt-1 text-lg font-semibold" dir="ltr">{doc.opening_date}</dd></div>
        </dl>
      </SectionCard>
      <Link href={`${OPS_BASE}/manage`} className="inline-flex min-h-12 w-full items-center justify-center rounded-[13px] border border-[color:var(--fo-control)] bg-surface px-4 text-[15px] font-bold text-text hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{t('posted.done')}</Link>
    </section>
  );
}

// ───────────────────────── المعالج ─────────────────────────

type Stage = 'idle' | 'account' | 'draft' | 'preview';
type PreviewState = { status: 'idle' } | { status: 'loading' } | { status: 'ready'; data: OpeningPreview } | { status: 'error' };

function StepHeader({ step }: { step: StepId }) {
  const t = useTranslations('stationOpsOpening');
  const index = STEPS.indexOf(step);
  return (
    <nav aria-label={t('steps.label')}>
      <p className="text-sm text-muted"><span className="num">{t('steps.stepOf', { step: index + 1, total: STEPS.length })}</span> · <span className="font-semibold text-text">{t(`steps.${step}`)}</span></p>
      <ol className="mt-2 grid grid-cols-3 gap-1.5" aria-hidden="true">
        {STEPS.map((id, i) => <li key={id} className={cn('h-1.5 rounded-full', i <= index ? 'bg-primary' : 'bg-border')} />)}
      </ol>
    </nav>
  );
}

function Wizard({ station, initialDoc }: { station: Station; initialDoc: OpeningDoc | null }) {
  const t = useTranslations('stationOpsOpening');
  const { scopeKey } = useStationOps();
  const access = useOpeningAccess();
  const assets = useStationAssets(station);
  const configured = useConfiguredAccounts(station);
  const accounts = useOpeningAccounts();
  const intents = useMemo(() => createIntentStore(`${scopeKey}|${station.id}`), [scopeKey, station.id]);

  const [form, setForm] = useState<WizardForm>(() => (initialDoc ? formFromDraft(initialDoc) : { ...EMPTY_FORM, date: todayLocal() }));
  const [step, setStep] = useState<StepId>('tanks');
  const [doc, setDoc] = useState<OpeningDoc | null>(initialDoc);
  const [stage, setStage] = useState<Stage>('idle');
  const [failure, setFailure] = useState<{ value: AnyFailure; scope: 'save' | 'post' } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState>({ status: 'idle' });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [posting, setPosting] = useState(false);
  const [postUnsure, setPostUnsure] = useState(false);
  const [checking, setChecking] = useState(false);
  const [done, setDone] = useState<OpeningDoc | null>(null);
  const inFlight = useRef(false);
  const savedFingerprint = useRef<string | null>(null);
  const lastSent = useRef<{ fingerprint: string; body: ReturnType<typeof buildDraftBody> } | null>(null);
  const branchId = station.branch_id;

  const productNames = useMemo(() => new Map((assets.state.status === 'success' ? assets.state.data.products : []).map((p) => [p.id, p.name])), [assets.state]);
  const tanks: TankInfo[] = useMemo(() => {
    if (assets.state.status !== 'success') return [];
    return assets.state.data.tanks
      .filter((tank) => tank.fuel_station_id === station.id)
      .map((tank) => ({ id: tank.id, name: tank.name, productId: tank.fuel_product_id, capacityMl: tank.capacity_milliliters, active: tank.status === 'active' }))
      .sort((a, b) => (productNames.get(a.productId) ?? '').localeCompare(productNames.get(b.productId) ?? '') || a.name.localeCompare(b.name, undefined, { numeric: true }));
  }, [assets.state, station.id, productNames]);

  const tanksEval = useMemo(() => evaluateTanks(tanks, form), [tanks, form]);
  const products = useMemo(() => productTotals(tanksEval.lines), [tanksEval.lines]);
  const costsEval = useMemo(() => evaluateCosts(products, form, access.recordCost), [products, form, access.recordCost]);
  const effective = configured.state.status === 'success' ? configured.state.data.station : null;
  const tenantDefault = configured.state.status === 'success' ? configured.state.data.tenant : null;
  const source = accountSource(effective, tenantDefault);
  const plan = planAccount(form, effective, source);
  const eligible = accounts.state.status === 'success' ? eligibleAccounts(accounts.state.data) : null;
  const accountOk = plan.accountId !== null && (accounts.allowed ? (eligible?.some((a) => a.id === plan.accountId) ?? false) : plan.accountId === effective);
  const dateOk = isValidDate(form.date);
  const hasCostIssue = Object.values(costsEval.states).some((s) => s.kind === 'issue');
  const costStepOk = dateOk && !hasCostIssue && (!access.recordCost || costsEval.complete) && accountOk && configured.state.status === 'success';

  const set = (patch: Partial<WizardForm>) => { setForm((current) => ({ ...current, ...patch })); setFailure(null); setNotice(null); };

  const loadPreview = async (id: string) => {
    setPreview({ status: 'loading' });
    try { setPreview({ status: 'ready', data: await getOpeningPreview(id, { branchId }) }); } catch { setPreview({ status: 'error' }); }
  };

  const runSave = async () => {
    if (inFlight.current || !tanksEval.canContinue) return;
    inFlight.current = true;
    setFailure(null);
    setNotice(null);
    setPreview({ status: 'idle' });
    try {
      if (plan.needsWrite && plan.accountId) {
        setStage('account');
        const saved = await saveOpeningAccount(plan.scope === 'org' ? { kind: 'org' } : { kind: 'station', stationId: station.id }, plan.accountId, { branchId });
        if (saved.kind !== 'ok') { setFailure({ value: saved, scope: 'save' }); return; }
        configured.reload();
      }
      const body = buildDraftBody({ date: form.date, notes: form.notes, allowZeroCost: form.allowZeroCost, lines: tanksEval.lines, costs: costsEval, canRecordCost: access.recordCost, products });
      const fingerprint = bodyFingerprint(station.id, body);
      let current = doc;
      if (!current || savedFingerprint.current !== fingerprint) {
        setStage('draft');
        lastSent.current = { fingerprint, body };
        const result = current ? await updateOpeningDraft(current.id, body, { branchId }) : await createOpeningDraft(station.id, body, intents.keyFor(INTENT, fingerprint), { branchId });
        if (result.kind !== 'ok') {
          // غير المؤكد: المفتاح يبقى ثابتاً فإعادة المحاولة (بعد التحقق) تعيد المسودة الأولى لا تُنشئ ثانية.
          if (result.kind === 'unknown' || result.kind === 'unverified') intents.markUncertain(INTENT); else intents.clear(INTENT);
          setFailure({ value: result, scope: 'save' });
          return;
        }
        intents.clear(INTENT);
        current = result.doc;
        setDoc(result.doc);
        savedFingerprint.current = fingerprint;
      }
      setStage('preview');
      await loadPreview(current.id);
    } finally {
      inFlight.current = false;
      setStage('idle');
    }
  };

  const runPost = async () => {
    if (inFlight.current || !doc || postUnsure) return;
    inFlight.current = true;
    setPosting(true);
    setConfirmOpen(false);
    setFailure(null);
    setNotice(null);
    try {
      const result = await postOpening(doc.id, { branchId });
      if (result.kind === 'ok' && result.doc.status === 'posted') { setDone(result.doc); return; }
      const failed: AnyFailure = result.kind === 'ok' ? { kind: 'unverified' } : result;
      setFailure({ value: failed, scope: 'post' });
      // لا إعادة ترحيل عمياء: غير المؤكد يُقفل زر الاعتماد حتى تُقرأ الحالة.
      if (failed.kind === 'unknown' || failed.kind === 'unverified') setPostUnsure(true);
      else if (failed.kind === 'rejected' && failed.code === 'blocked') void loadPreview(doc.id);
    } finally {
      inFlight.current = false;
      setPosting(false);
    }
  };

  const adopt = async (fresh: OpeningDoc): Promise<boolean> => {
    const sent = lastSent.current;
    if (!sent || !draftMatchesBody(fresh, sent.body)) return false;
    setDoc(fresh);
    savedFingerprint.current = sent.fingerprint;
    return true;
  };

  const check = async () => {
    setChecking(true);
    try {
      if (failure?.scope === 'post' && doc) {
        const fresh = await getOpeningDoc(doc.id, { branchId });
        if (fresh.status === 'posted') { setDone(fresh); return; }
        setPostUnsure(false);
        setFailure(null);
        setNotice('fail.checkedDraft');
        await loadPreview(doc.id);
        return;
      }
      let fresh: OpeningDoc | null = null;
      if (doc) fresh = await getOpeningDoc(doc.id, { branchId });
      else {
        const draft = (await listOpeningDocs(station.id, { branchId })).find((row) => row.status === 'draft');
        fresh = draft ? await getOpeningDoc(draft.id, { branchId }) : null;
      }
      setFailure(null);
      if (fresh && await adopt(fresh)) { intents.clear(INTENT); setNotice('fail.checkedSaved'); await loadPreview(fresh.id); } else setNotice('fail.checkedNotSaved');
    } catch {
      setFailure({ value: { kind: 'unknown', reason: 'network' }, scope: failure?.scope ?? 'save' });
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    // مغادرة المراجعة تُسقط المعاينة (قد تتغيّر الكميات)، فلا يُعرض قيدٌ قديم.
    if (step !== 'review') setPreview({ status: 'idle' });
  }, [step]);

  if (done) return <PostedView doc={done} />;
  if (assets.state.status === 'loading') return <LoadingBlock />;
  if (assets.state.status === 'error') return <ErrorState error={assets.state.error} onRetry={assets.reload} />;

  const busy = stage !== 'idle' || posting;
  const previewData = preview.status === 'ready' ? preview.data : null;
  const canApprove = access.post && !!previewData?.ready && !postUnsure && !busy && !!doc;

  return (
    <div className="space-y-4">
      <StepHeader step={step} />
      {initialDoc && step === 'tanks' ? <p className="rounded-[12px] bg-primary-soft p-3 text-sm text-text">{t('resume.body', { number: initialDoc.number })}</p> : null}

      {step === 'tanks' ? (
        <TanksStep tanks={tanks} form={form} evaluation={tanksEval} productNames={productNames} onChange={(id, value) => set({ quantities: { ...form.quantities, [id]: value } })} />
      ) : null}

      {step === 'cost' ? (
        <CostStep
          form={form} products={products} productNames={productNames} costs={costsEval} canRecordCost={access.recordCost} dateOk={dateOk} set={set}
          account={{ plan, source, effective, eligible, allowed: accounts.allowed, loading: accounts.allowed && accounts.state.status === 'loading', failed: accounts.allowed && accounts.state.status === 'error', configuredState: configured.state.status, reloadConfigured: configured.reload, reloadAccounts: accounts.reload }}
        />
      ) : null}

      {step === 'review' ? (
        <ReviewStep stage={stage} doc={doc} preview={preview} reloadPreview={() => doc && void loadPreview(doc.id)} canPost={access.post} showWait={busy} />
      ) : null}

      {failure && step === 'review' ? <FailureNotice failure={failure.value} onCheck={() => void check()} checking={checking} /> : null}
      {notice && step === 'review' && !failure ? <p role="status" className="rounded-[12px] bg-primary-soft p-3 text-sm text-text">{t(notice)}</p> : null}

      <ActionBar>
        <div className="flex gap-3">
          {step !== 'tanks' ? <div className="w-1/3"><SecondaryButton disabled={busy} onClick={() => { setFailure(null); setNotice(null); setStep(STEPS[STEPS.indexOf(step) - 1]); }}>{t('nav.back')}</SecondaryButton></div> : null}
          <div className="min-w-0 flex-1">
            {step === 'tanks' ? <PrimaryButton disabled={!tanksEval.canContinue} onClick={() => setStep('cost')}>{t('nav.next')}</PrimaryButton> : null}
            {step === 'cost' ? <PrimaryButton disabled={!costStepOk || busy} onClick={() => { setStep('review'); void runSave(); }}>{t('nav.review')}</PrimaryButton> : null}
            {step === 'review' ? (
              !doc || preview.status === 'error' || preview.status === 'idle' || (failure?.scope === 'save' && !postUnsure)
                ? <PrimaryButton disabled={busy || checking} onClick={() => void runSave()}>{t('review.retry')}</PrimaryButton>
                : <PrimaryButton disabled={!canApprove} onClick={() => setConfirmOpen(true)}>{posting ? t('review.posting') : t('nav.approve')}</PrimaryButton>
            ) : null}
          </div>
        </div>
      </ActionBar>

      <ConfirmDialog open={confirmOpen} title={t('review.confirmTitle')} onClose={() => setConfirmOpen(false)} busy={posting}>
        <p className="text-sm leading-6 text-text">{t('review.confirmBody')}</p>
        <div className="mt-4 flex gap-3">
          <div className="w-1/3"><SecondaryButton onClick={() => setConfirmOpen(false)}>{t('nav.cancel')}</SecondaryButton></div>
          <div className="min-w-0 flex-1"><PrimaryButton disabled={posting} onClick={() => void runPost()}>{t('review.confirmAction')}</PrimaryButton></div>
        </div>
      </ConfirmDialog>
    </div>
  );
}

// ───────────────────────── الخطوة 1: الخزانات والكميات ─────────────────────────

function TanksStep({ tanks, form, evaluation, productNames, onChange }: {
  tanks: TankInfo[]; form: WizardForm; evaluation: ReturnType<typeof evaluateTanks>; productNames: Map<string, string>; onChange: (tankId: string, value: string) => void;
}) {
  const t = useTranslations('stationOpsOpening');
  const locale = useLocale();
  if (tanks.length === 0) return <EmptyState title={t('tanks.noTanks')} body={t('tanks.noTanksBody')} />;
  return (
    <section className="space-y-3" aria-labelledby="op-tanks-h">
      <div>
        <h2 id="op-tanks-h" className="text-base font-semibold text-text">{t('tanks.heading')}</h2>
        <p className="mt-0.5 text-sm text-muted">{t('tanks.hint')}</p>
      </div>
      <ul className="space-y-3">
        {tanks.map((tank) => {
          const state = evaluation.states[tank.id];
          const capacity = new Intl.NumberFormat(locale === 'ar' ? 'ar-SA-u-nu-latn' : locale, { maximumFractionDigits: 0 }).format(Math.round(tank.capacityMl / 1000));
          return (
            <li key={tank.id} className="rounded-[14px] border border-border bg-surface p-4">
              <div className="mb-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold text-text">{tank.name}</p>
                  <p className="text-sm text-muted">{productNames.get(tank.productId) ?? '—'} · <span className="num" dir="ltr">{t('tanks.capacity', { capacity })}</span></p>
                </div>
                {!tank.active ? <span className="shrink-0 rounded-md bg-[color:var(--fo-warning-tint)] px-2 py-0.5 text-xs font-semibold text-warning">{t('tanks.inactive')}</span> : null}
              </div>
              <NumberField
                label={t('tanks.quantity', { name: tank.name })} value={form.quantities[tank.id] ?? ''} onChange={(value) => onChange(tank.id, value)} suffix={t('tanks.unit')} placeholder="" disabled={!tank.active}
                error={state?.kind === 'issue' ? t(`tanks.issue.${state.issue}`) : null} testId={`qty-${tank.id}`}
              />
            </li>
          );
        })}
      </ul>
      <div className="flex items-center justify-between rounded-[14px] border border-border bg-surface p-4">
        <span className="text-sm text-muted">{t('tanks.total')}</span>
        <span className="text-lg font-semibold text-text" data-total=""><Liters ml={evaluation.totalMl} /></span>
      </div>
      {evaluation.lines.length === 0 && !evaluation.hasIssue ? <p className="text-sm text-muted">{t('tanks.needOne')}</p> : null}
    </section>
  );
}

// ───────────────────────── الخطوة 2: التكلفة والإعدادات ─────────────────────────

interface AccountView {
  plan: ReturnType<typeof planAccount>;
  source: ReturnType<typeof accountSource>;
  effective: string | null;
  eligible: OpeningAccount[] | null;
  allowed: boolean;
  loading: boolean;
  failed: boolean;
  configuredState: 'loading' | 'success' | 'error';
  reloadConfigured: () => void;
  reloadAccounts: () => void;
}

function CostStep({ form, products, productNames, costs, canRecordCost, dateOk, set, account }: {
  form: WizardForm; products: ReturnType<typeof productTotals>; productNames: Map<string, string>; costs: ReturnType<typeof evaluateCosts>; canRecordCost: boolean; dateOk: boolean;
  set: (patch: Partial<WizardForm>) => void; account: AccountView;
}) {
  const t = useTranslations('stationOpsOpening');
  return (
    <div className="space-y-4">
      <SectionCard title={t('cost.heading')} id="op-cost-h">
        <div className="space-y-4">
          <div>
            <label htmlFor="op-date" className="block text-sm font-medium text-text">{t('cost.date')}</label>
            <input id="op-date" type="date" dir="ltr" value={form.date} onChange={(event) => set({ date: event.target.value })} aria-invalid={!dateOk || undefined} aria-describedby="op-date-hint" className={`${FIELD} h-12`} />
            <p id="op-date-hint" className={cn('mt-1 text-xs leading-5', dateOk ? 'text-muted' : 'text-negative')}>{dateOk ? t('cost.dateHint') : t('cost.dateInvalid')}</p>
          </div>
          {canRecordCost ? (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-text">{t('cost.costsTitle')}</h3>
              {products.map((product) => {
                const state = costs.states[product.productId];
                const name = productNames.get(product.productId) ?? '—';
                return (
                  <NumberField
                    key={product.productId} label={t('cost.perLiter', { name })} value={form.costs[product.productId] ?? ''} suffix={t('cost.currency')} placeholder="" testId={`cost-${product.productId}`}
                    onChange={(value) => set({ costs: { ...form.costs, [product.productId]: value } })}
                    hint={<LitersHint ml={product.ml} />} error={state?.kind === 'issue' ? t(`cost.issue.${state.issue}`) : null}
                  />
                );
              })}
            </div>
          ) : <p className="rounded-[12px] bg-primary-soft p-3 text-sm leading-6 text-text">{t('cost.noAuthority')}</p>}
        </div>
      </SectionCard>

      <AccountSection form={form} set={set} account={account} />

      <details className="rounded-[14px] border border-border bg-surface p-4">
        <summary className="min-h-11 cursor-pointer text-base font-semibold text-text">{t('cost.advanced.title')}</summary>
        <div className="mt-3 space-y-4">
          <div>
            <label htmlFor="op-notes" className="block text-sm font-medium text-text">{t('cost.advanced.notes')}</label>
            <textarea id="op-notes" rows={2} maxLength={1000} value={form.notes} onChange={(event) => set({ notes: event.target.value })} className={`${FIELD} py-3`} />
          </div>
          {canRecordCost ? (
            <label className="flex min-h-12 items-start gap-3 text-sm text-text">
              <input type="checkbox" checked={form.allowZeroCost} onChange={(event) => set({ allowZeroCost: event.target.checked })} className="mt-1 h-5 w-5 shrink-0" />
              <span><span className="block font-medium">{t('cost.advanced.allowZero')}</span><span className="block text-xs leading-5 text-muted">{t('cost.advanced.allowZeroHint')}</span></span>
            </label>
          ) : null}
          {account.source !== 'station' && account.allowed ? (
            <fieldset>
              <legend className="text-sm font-medium text-text">{t('cost.advanced.scope')}</legend>
              {(['station', 'org'] as const).map((scope) => (
                <label key={scope} className="flex min-h-11 items-center gap-3 text-sm text-text">
                  <input type="radio" name="op-scope" checked={form.accountScope === scope} onChange={() => set({ accountScope: scope })} className="h-5 w-5" />
                  {scope === 'station' ? t('cost.advanced.scopeStation') : t('cost.advanced.scopeOrg')}
                </label>
              ))}
            </fieldset>
          ) : null}
        </div>
      </details>
    </div>
  );
}

function LitersHint({ ml }: { ml: number }) {
  const t = useTranslations('stationOpsOpening');
  const locale = useLocale();
  return <>{t('cost.perLiterHint', { liters: new Intl.NumberFormat(locale === 'ar' ? 'ar-SA-u-nu-latn' : locale, { maximumFractionDigits: 3 }).format(ml / 1000) })}</>;
}

function AccountSection({ form, set, account }: { form: WizardForm; set: (patch: Partial<WizardForm>) => void; account: AccountView }) {
  const t = useTranslations('stationOpsOpening');
  const chosen = account.plan.accountId ?? '';
  const ineligible = account.allowed && account.eligible !== null && account.effective !== null && !account.eligible.some((a) => a.id === account.effective) && form.accountId === null;
  return (
    <SectionCard title={t('cost.account.title')} id="op-account-h">
      <div className="space-y-3">
        {account.configuredState === 'loading' ? <p role="status" className="text-sm text-muted">…</p> : null}
        {account.configuredState === 'error' ? <p role="alert" className="text-sm text-negative">{t('cost.account.loadFailed')} <button type="button" onClick={account.reloadConfigured} className="min-h-11 font-semibold underline">↻</button></p> : null}
        {account.configuredState === 'success' ? (
          <p className="text-sm text-muted" data-account-source={account.source}>{t(`cost.account.source_${account.source}`)}</p>
        ) : null}
        {!account.allowed ? (
          <p className="rounded-[12px] bg-primary-soft p-3 text-sm leading-6 text-text">{account.effective ? t('cost.account.preconfigured') : t('cost.account.noList')}</p>
        ) : account.loading ? <p role="status" className="text-sm text-muted">…</p>
          : account.failed ? <p role="alert" className="text-sm text-negative">{t('cost.account.loadFailed')} <button type="button" onClick={account.reloadAccounts} className="min-h-11 font-semibold underline">↻</button></p>
            : account.eligible !== null && account.eligible.length === 0 ? <p role="alert" className="text-sm text-negative">{t('cost.account.noEligible')}</p>
              : account.eligible !== null ? (
                <div>
                  <label htmlFor="op-account" className="block text-sm font-medium text-text">{t('cost.account.label')}</label>
                  <select id="op-account" value={ineligible ? '' : chosen} onChange={(event) => set({ accountId: event.target.value || null })} className={`${FIELD} h-12`}>
                    <option value="">{t('cost.account.placeholder')}</option>
                    {account.eligible.map((item) => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}
                  </select>
                  <p className="mt-1 text-xs leading-5 text-muted">{t('cost.account.hint')}</p>
                  {ineligible ? <p role="alert" className="mt-1 flex items-start gap-1.5 text-sm text-warning"><TriangleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />{t('cost.account.ineligible')}</p> : null}
                </div>
              ) : null}
        {account.plan.needsWrite && account.allowed ? <p className="text-xs leading-5 text-muted" data-account-will-save="">{account.plan.scope === 'org' ? t('cost.account.willSaveOrg') : t('cost.account.willSave')}</p> : null}
      </div>
    </SectionCard>
  );
}

// ───────────────────────── الخطوة 3: المراجعة ─────────────────────────

function ReviewStep({ stage, doc, preview, reloadPreview, canPost, showWait }: {
  stage: Stage; doc: OpeningDoc | null; preview: PreviewState; reloadPreview: () => void; canPost: boolean; showWait: boolean;
}) {
  const t = useTranslations('stationOpsOpening');
  if (showWait && preview.status !== 'ready') {
    return <div role="status" aria-live="polite"><LoadingBlock rows={2} label={stage === 'preview' ? t('review.previewing') : t('review.saving')} /></div>;
  }
  if (preview.status === 'error') {
    return <div role="alert" className="rounded-[14px] border border-border bg-[color:var(--fo-negative-tint)] p-4 text-sm text-negative">{t('review.previewFailed')} <button type="button" onClick={reloadPreview} className="min-h-11 font-semibold underline">↻</button></div>;
  }
  if (preview.status !== 'ready') return null;
  const data = preview.data;
  const hasMoney = !!data.journal || data.products.some((p) => typeof p.value_minor === 'number');
  return (
    <section className="space-y-4" aria-labelledby="op-review-h">
      <div>
        <h2 id="op-review-h" className="text-base font-semibold text-text">{t('review.heading')}</h2>
        {doc ? <p className="mt-0.5 text-sm text-muted">{t('review.draftSaved', { number: doc.number })}</p> : null}
      </div>

      <div data-ready={data.ready ? 'yes' : 'no'} className={cn('rounded-[12px] p-3 text-sm font-semibold', data.ready ? 'bg-[color:var(--fo-positive-tint)] text-positive' : 'bg-[color:var(--fo-warning-tint)] text-warning')}>
        {data.ready ? t('review.ready') : t('review.notReady')}
      </div>
      {data.blockers.length > 0 ? <div><h3 className="mb-1.5 text-sm font-semibold text-text">{t('review.blockers')}</h3><BlockerList items={data.blockers} tone="negative" /></div> : null}
      {data.warnings.length > 0 ? <div><h3 className="mb-1.5 text-sm font-semibold text-text">{t('review.warnings')}</h3><BlockerList items={data.warnings} tone="warning" /></div> : null}

      <SectionCard title={t('review.products')}>
        <ul className="divide-y divide-border">
          {data.products.map((product) => (
            <li key={product.fuel_product_id} className="py-2.5 text-sm">
              <div className="flex items-baseline justify-between gap-3"><span className="font-semibold text-text">{product.name ?? '—'}</span><Liters ml={product.total_milliliters} /></div>
              {typeof product.unit_cost_per_liter_minor === 'number' || typeof product.value_minor === 'number' ? (
                <div className="mt-1 flex items-baseline justify-between gap-3 text-muted">
                  <span>{t('review.costPerLiter')}: <Money minor={product.unit_cost_per_liter_minor} /></span>
                  <span>{t('review.value')}: <Money minor={product.value_minor} /></span>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        <ul className="mt-2 space-y-1 border-t border-border pt-2 text-sm text-muted">
          {data.lines.map((line) => <li key={line.fuel_tank_id} className="flex items-baseline justify-between gap-3"><span className="truncate">{line.tank_name ?? '—'}</span><Liters ml={line.quantity_milliliters} /></li>)}
        </ul>
        <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-border pt-2 font-semibold text-text">
          <span>{t('review.total')}</span><Liters ml={data.total_milliliters} />
        </div>
        {typeof data.total_value_minor === 'number' ? <div className="mt-1 flex items-baseline justify-between gap-3 font-semibold text-text"><span>{t('review.value')}</span><Money minor={data.total_value_minor} /></div> : null}
      </SectionCard>

      {data.journal ? (
        <SectionCard title={t('review.entryTitle')}>
          <p className="mb-2 text-xs text-muted">{t('review.entryNote')}</p>
          <dl className="space-y-3 text-sm" data-journal="">
            {([['debit', data.journal.debit], ['credit', data.journal.credit]] as const).map(([side, line]) => (
              <div key={side} className="rounded-[12px] border border-border bg-background p-3">
                <dt className="text-xs font-semibold text-muted">{t(`review.${side}`)}</dt>
                <dd className="mt-1 flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate font-semibold text-text"><span className="num" dir="ltr">{line.code ?? ''}</span> {line.name ?? ''}</span>
                  <Money minor={line.amount_minor} />
                </dd>
              </div>
            ))}
          </dl>
          {data.not_checked?.includes('accounting_period_lock') ? <p className="mt-2 text-xs leading-5 text-muted">{t('review.notChecked')}</p> : null}
        </SectionCard>
      ) : !hasMoney ? <p className="rounded-[12px] bg-primary-soft p-3 text-sm leading-6 text-text">{t('review.noMoney')}</p> : null}

      {!canPost ? <p className="rounded-[12px] bg-primary-soft p-3 text-sm leading-6 text-text">{t('review.needAuthority')}</p> : null}
    </section>
  );
}
