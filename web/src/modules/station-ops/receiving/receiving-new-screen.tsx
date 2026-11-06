'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, FileText, TriangleAlert, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useStationOps } from '../context';
import { useStationAssets } from '../data';
import { createIntentStore } from '../intents';
import { PageMasthead, ScreenBody } from '../masthead';
import { EmptyState, ErrorState, LoadingBlock } from '../state-views';
import { StationGate } from '../station-gate';
import { ActionBar, NumberField, PrimaryButton, SecondaryButton, SectionCard } from '../write-ui';
import type { Station } from '../schemas';
import { findDeliveryByIntent, runCreate, type FlowInput, type FlowResult } from './create-flow';
import { useReceivingAccess, useStationWarehouse, useSuppliers } from './data';
import { clearForm, formKey, loadForm, saveForm } from './form-draft';
import { EMPTY_FORM, STEPS, evaluate, stepIssues, type FormValues, type Issue, type StepId, type Warning } from './logic';
import { formatBytes, type FileCheck } from './attachments';
import { FilePicker } from './file-picker';
import { FailureNotice, Liters, RECEIVING_BASE, VarianceText, type AnyFailure } from './parts';
import { uploadAttachments } from './receiving-client';
import type { Delivery } from './schemas';

const INTENT = 'rcv-create';

function TextField({ id, label, value, onChange, hint, maxLength = 128, multiline = false, disabled = false }: {
  id: string; label: string; value: string; onChange: (value: string) => void; hint?: string; maxLength?: number; multiline?: boolean; disabled?: boolean;
}) {
  const cls = 'mt-1.5 w-full rounded-[11px] border border-[color:var(--fo-control)] bg-surface px-3 text-base text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60';
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="block text-sm font-medium text-text">{label}</label>
      {multiline
        ? <textarea id={id} value={value} maxLength={maxLength} rows={2} disabled={disabled} onChange={(event) => onChange(event.target.value)} className={`${cls} py-3`} />
        : <input id={id} type="text" value={value} maxLength={maxLength} disabled={disabled} autoComplete="off" onChange={(event) => onChange(event.target.value)} className={`${cls} h-12`} />}
      {hint ? <p className="mt-1 text-xs leading-5 text-muted">{hint}</p> : null}
    </div>
  );
}

function StepHeader({ step }: { step: StepId }) {
  const t = useTranslations('stationOps');
  const index = STEPS.indexOf(step);
  return (
    <nav aria-label={t('receiving.wizard.steps')}>
      <p className="text-sm text-muted"><span className="num">{t('receiving.wizard.stepOf', { step: index + 1, total: STEPS.length })}</span> · <span className="font-semibold text-text">{t(`receiving.wizard.step.${step}`)}</span></p>
      <ol className="mt-2 grid grid-cols-5 gap-1.5" aria-hidden="true">
        {STEPS.map((id, i) => <li key={id} className={cn('h-1.5 rounded-full', i <= index ? 'bg-primary' : 'bg-border')} />)}
      </ol>
    </nav>
  );
}

function IssueList({ issues }: { issues: Issue[] }) {
  const t = useTranslations('stationOps');
  if (issues.length === 0) return null;
  return (
    <ul role="alert" data-issues="" className="space-y-1.5 rounded-[12px] bg-[color:var(--fo-negative-tint)] p-3 text-sm leading-6 text-negative">
      {issues.map((issue) => <li key={issue} className="flex items-start gap-2"><TriangleAlert aria-hidden="true" className="mt-1 h-4 w-4 shrink-0" strokeWidth={1.9} />{t(`receiving.issue.${issue}`)}</li>)}
    </ul>
  );
}

function WarningList({ warnings }: { warnings: Warning[] }) {
  const t = useTranslations('stationOps');
  const shown = warnings;
  if (shown.length === 0) return null;
  return (
    <ul data-warnings="" className="space-y-1.5 rounded-[12px] bg-[color:var(--fo-warning-tint)] p-3 text-sm leading-6 text-warning">
      {shown.map((warning) => <li key={warning} className="flex items-start gap-2"><TriangleAlert aria-hidden="true" className="mt-1 h-4 w-4 shrink-0" strokeWidth={1.9} />{t(`receiving.warning.${warning}`)}</li>)}
    </ul>
  );
}

function Wizard({ station }: { station: Station }) {
  const t = useTranslations('stationOps');
  const { scopeKey } = useStationOps();
  const key = formKey(scopeKey, station.id);
  const [form, setForm] = useState<FormValues>(() => loadForm(key) ?? EMPTY_FORM);
  const [step, setStep] = useState<StepId>('who');
  const [attempted, setAttempted] = useState(false);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [stopped, setStopped] = useState<{ failure: AnyFailure; stage: string } | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [created, setCreated] = useState<Delivery | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [rejectedFiles, setRejectedFiles] = useState<FileCheck['rejected']>([]);
  const [uploadState, setUploadState] = useState<{ status: 'idle' | 'uploading' | 'done' } | { status: 'failed'; failure: AnyFailure }>({ status: 'idle' });
  const inFlight = useRef(false);
  const lastInput = useRef<FlowInput | null>(null);
  const savedReadings = useRef<{ signature: string; ids: { before?: string; after?: string } } | null>(null);
  const intents = useMemo(() => createIntentStore(`${scopeKey}|${station.id}`), [scopeKey, station.id]);

  useEffect(() => { saveForm(key, form); }, [key, form]);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(supplierSearch), 300);
    return () => window.clearTimeout(timer);
  }, [supplierSearch]);

  const suppliers = useSuppliers(station, debounced);
  const warehouse = useStationWarehouse(station);
  const assets = useStationAssets(station);
  const stationRow = warehouse.state.status === 'success' ? warehouse.state.data : null;
  const warehouseId = stationRow?.warehouse_id ?? null;
  const evaluation = useMemo(() => evaluate(form, { hasWarehouse: warehouseId !== null }), [form, warehouseId]);

  const tanks = assets.state.status === 'success' ? assets.state.data.tanks.filter((tank) => tank.fuel_station_id === station.id) : [];
  const products = assets.state.status === 'success' ? assets.state.data.products : [];
  const selectedTank = tanks.find((tank) => tank.id === form.tankId) ?? null;

  const set = <K extends keyof FormValues>(field: K, value: FormValues[K]) => { setForm((current) => ({ ...current, [field]: value })); setStopped(null); setNotFound(false); };
  const shown = stepIssues(step, evaluation);
  const index = STEPS.indexOf(step);

  const go = (next: StepId) => { setStep(next); setAttempted(false); };
  const onNext = () => {
    if (stepIssues(step, evaluation).length > 0) { setAttempted(true); return; }
    go(STEPS[Math.min(STEPS.length - 1, index + 1)]);
  };

  const submit = async () => {
    if (inFlight.current) return; // قفل إرسال مكرر
    if (evaluation.issues.length > 0 || !selectedTank || warehouseId === null) { setAttempted(true); return; }
    inFlight.current = true;
    setSaving(true);
    setStopped(null);
    setNotFound(false);
    try {
      const signature = `${selectedTank.id}|${form.readingType}|${form.before.trim()}|${form.after.trim()}`;
      const input: FlowInput = {
        form, evaluation, stationId: station.id, tankId: selectedTank.id, fuelProductId: selectedTank.fuel_product_id, warehouseId,
        intentKey: intents.keyFor(INTENT, { stationId: station.id, form }),
        readingIds: savedReadings.current?.signature === signature ? savedReadings.current.ids : undefined,
        branchId: station.branch_id,
      };
      lastInput.current = input;
      const priorUncertain = intents.isUncertain(INTENT);
      intents.markUncertain(INTENT); // قبل الإرسال: الطلب الجاري قد يلتزم والصفحة تُغلق
      const result: FlowResult = await runCreate(input);
      savedReadings.current = { signature, ids: result.readingIds };
      if (result.kind === 'ok') {
        intents.clear(INTENT);
        clearForm(key);
        setCreated(result.delivery);
        await sendFiles(result.delivery.id);
        return;
      }
      const failure = result.failure;
      const final = failure.kind === 'rejected' || failure.kind === 'not_sent' || failure.kind === 'reading_conflict';
      if (final && !priorUncertain) intents.clear(INTENT);
      setStopped({ failure, stage: result.stage });
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  /** بعد نتيجة غير مؤكدة: نقرأ الخادم بحثاً عن مسودتنا — لا نُنشئ شيئاً. */
  const check = async () => {
    if (!lastInput.current) return;
    setChecking(true);
    const found = await findDeliveryByIntent(lastInput.current);
    setChecking(false);
    if (found) { intents.clear(INTENT); clearForm(key); setCreated(found); await sendFiles(found.id); } else setNotFound(true);
  };

  /** رفع مرفقات السند بعد وجود المسودة (يحتاج معرّفها). فشله لا يُلغي المسودة: تبقى محفوظة والمستخدم يعيد الرفع صراحةً من هنا أو من التفاصيل. */
  const sendFiles = async (deliveryId: string) => {
    if (files.length === 0) return;
    setUploadState({ status: 'uploading' });
    const outcome = await uploadAttachments(deliveryId, files, { branchId: station.branch_id });
    if (outcome.kind === 'ok') { setUploadState({ status: 'done' }); setFiles([]); } else setUploadState({ status: 'failed', failure: outcome });
  };

  const picked = (result: FileCheck) => { setRejectedFiles(result.rejected); setFiles((current) => [...current, ...result.accepted].slice(0, 5)); };

  if (created) {
    return (
      <div role="status" data-created="" className="space-y-4 rounded-[14px] border border-border bg-surface p-5 text-center">
        <CheckCircle2 aria-hidden="true" className="mx-auto h-9 w-9 text-positive" strokeWidth={1.7} />
        <h2 className="text-lg font-semibold text-text">{t('receiving.created.title')}</h2>
        <p className="mx-auto max-w-sm text-sm leading-6 text-muted">{t('receiving.created.body')}</p>
        {uploadState.status === 'uploading' ? <p role="status" data-upload-state="uploading" className="text-sm text-muted">{t('receiving.attach.uploading')}</p> : null}
        {uploadState.status === 'done' ? <p role="status" data-upload-state="done" className="text-sm font-medium text-positive">{t('receiving.created.attached')}</p> : null}
        {uploadState.status === 'failed' ? (
          <div className="space-y-2 text-start" data-upload-state="failed">
            <FailureNotice failure={uploadState.failure} />
            <p className="text-sm leading-6 text-muted">{t('receiving.created.attachFailed')}</p>
            <SecondaryButton data-retry-upload="" onClick={() => void sendFiles(created.id)}>{t('receiving.created.retryUpload')}</SecondaryButton>
          </div>
        ) : null}
        <Link href={`${RECEIVING_BASE}/${created.id}`} data-primary-action="" className="inline-flex min-h-12 w-full items-center justify-center rounded-[13px] bg-[color:var(--fo-cta-bg)] px-4 text-[15px] font-bold text-[color:var(--fo-cta-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{t('receiving.created.open')}</Link>
        <Link href={RECEIVING_BASE} className="inline-flex min-h-12 w-full items-center justify-center rounded-[13px] border border-[color:var(--fo-control)] px-4 text-[15px] font-bold text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{t('receiving.created.list')}</Link>
      </div>
    );
  }

  const supplier = suppliers.state.status === 'success' ? suppliers.state.data.find((row) => row.id === form.supplierId) : undefined;
  const choiceClass = (on: boolean) => cn('flex min-h-[56px] w-full items-center gap-3 rounded-[12px] border px-3.5 py-2 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60', on ? 'border-primary bg-primary-soft' : 'border-[color:var(--fo-control)] bg-surface');
  const radioDot = (on: boolean) => <span aria-hidden="true" className={cn('grid h-5 w-5 shrink-0 place-items-center rounded-full border-2', on ? 'border-primary' : 'border-[color:var(--fo-control)]')}>{on ? <span className="h-2.5 w-2.5 rounded-full bg-primary" /> : null}</span>;

  return (
    <>
      <StepHeader step={step} />

      {step === 'who' ? (
        <div className="space-y-5">
          {warehouse.state.status === 'error' ? <ErrorState error={warehouse.state.error} onRetry={warehouse.reload} /> : null}
          {warehouse.state.status === 'success' ? (
            <p className="text-sm text-muted">{t('receiving.field.warehouse')}: <span className="font-medium text-text">{stationRow?.warehouse?.name ?? t('receiving.wizard.noWarehouse')}</span></p>
          ) : null}

          <SectionCard title={t('receiving.field.supplier')} id="rcv-supplier-h">
            <label htmlFor="rcv-supplier-q" className="sr-only">{t('receiving.wizard.searchSupplier')}</label>
            <input id="rcv-supplier-q" type="search" value={supplierSearch} onChange={(event) => setSupplierSearch(event.target.value)} placeholder={t('receiving.wizard.searchSupplier')} className="h-12 w-full rounded-[11px] border border-[color:var(--fo-control)] bg-surface px-3 text-base text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" />
            <div className="mt-3 max-h-64 space-y-2 overflow-y-auto" role="radiogroup" aria-label={t('receiving.field.supplier')}>
              {suppliers.state.status === 'loading' ? <LoadingBlock rows={2} /> : null}
              {suppliers.state.status === 'error' ? <ErrorState error={suppliers.state.error} onRetry={suppliers.reload} /> : null}
              {suppliers.state.status === 'success' && suppliers.state.data.length === 0 ? <EmptyState title={t('receiving.wizard.noSuppliers')} /> : null}
              {suppliers.state.status === 'success' ? suppliers.state.data.map((row) => (
                <button key={row.id} type="button" role="radio" aria-checked={form.supplierId === row.id} onClick={() => set('supplierId', row.id)} className={choiceClass(form.supplierId === row.id)}>
                  {radioDot(form.supplierId === row.id)}
                  <span className="min-w-0"><span className="block truncate text-[15px] font-medium text-text">{row.name}</span>{row.code ? <span className="block text-xs text-muted">{row.code}</span> : null}</span>
                </button>
              )) : null}
            </div>
            {supplier === undefined && form.supplierId !== '' ? <p className="mt-2 text-xs text-muted">{t('receiving.wizard.supplierKept')}</p> : null}
          </SectionCard>

          <SectionCard title={t('receiving.field.tank')} id="rcv-tank-h">
            {assets.state.status === 'loading' ? <LoadingBlock rows={2} /> : null}
            {assets.state.status === 'error' ? <ErrorState error={assets.state.error} onRetry={assets.reload} /> : null}
            {assets.state.status === 'success' && tanks.length === 0 ? <EmptyState title={t('receiving.wizard.noTanks')} /> : null}
            <div className="space-y-2" role="radiogroup" aria-label={t('receiving.field.tank')}>
              {tanks.map((tank) => {
                const product = products.find((row) => row.id === tank.fuel_product_id);
                const usable = tank.status === 'active' && product?.is_active === true;
                return (
                  <button key={tank.id} type="button" role="radio" aria-checked={form.tankId === tank.id} disabled={!usable} onClick={() => set('tankId', tank.id)} className={choiceClass(form.tankId === tank.id)}>
                    {radioDot(form.tankId === tank.id)}
                    <span className="min-w-0"><span className="block truncate text-[15px] font-medium text-text">{tank.name}</span><span className="block text-xs text-muted">{product?.name ?? '—'}{!usable ? ` · ${t('receiving.wizard.tankUnavailable')}` : ''}</span></span>
                  </button>
                );
              })}
            </div>
          </SectionCard>

          <SectionCard title={t('receiving.wizard.referencesTitle')} id="rcv-refs-h">
            <div className="space-y-4">
              <TextField id="rcv-note" label={t('receiving.field.deliveryNote')} value={form.deliveryNote} onChange={(v) => set('deliveryNote', v)} hint={t('receiving.wizard.deliveryNoteHint')} />
              <TextField id="rcv-po" label={t('receiving.field.purchaseRef')} value={form.purchaseRef} onChange={(v) => set('purchaseRef', v)} />
              <TextField id="rcv-tanker" label={t('receiving.field.tanker')} value={form.tanker} onChange={(v) => set('tanker', v)} />
              <TextField id="rcv-driver" label={t('receiving.field.driver')} value={form.driver} onChange={(v) => set('driver', v)} maxLength={255} />
            </div>
          </SectionCard>
        </div>
      ) : null}

      {step === 'quantities' ? (
        <div className="space-y-5">
          <SectionCard title={t('receiving.wizard.step.quantities')} id="rcv-q-h">
            <div className="space-y-4">
              <NumberField label={t('receiving.field.dispatched')} value={form.dispatched} onChange={(v) => set('dispatched', v)} suffix={t('receiving.unit')} testId="rcv-dispatched" />
              <NumberField label={t('receiving.field.received')} value={form.received} onChange={(v) => set('received', v)} suffix={t('receiving.unit')} testId="rcv-received" />
              <TextField id="rcv-notes" label={t('receiving.field.notes')} value={form.notes} onChange={(v) => set('notes', v)} maxLength={1000} multiline />
            </div>
          </SectionCard>
          <p data-variance="" className="rounded-[12px] border border-border bg-surface p-3 text-sm"><span className="text-muted">{t('receiving.detail.transitVariance')}: </span><VarianceText ml={evaluation.transitVarianceMl} /></p>
        </div>
      ) : null}

      {step === 'readings' ? (
        <div className="space-y-5">
          <p className="text-sm leading-6 text-muted">{t('receiving.wizard.readingsHint')}</p>
          <div role="radiogroup" aria-label={t('receiving.wizard.readingType')} className="grid grid-cols-2 gap-2">
            {(['physical', 'atg'] as const).map((type) => (
              <button key={type} type="button" role="radio" aria-checked={form.readingType === type} onClick={() => set('readingType', type)} className={cn('min-h-12 rounded-lg border text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary', form.readingType === type ? 'border-primary bg-primary-soft text-primary' : 'border-[color:var(--fo-control)] text-text')}>{t(`receiving.readingType.${type}`)}</button>
            ))}
          </div>
          <SectionCard title={t('receiving.wizard.step.readings')} id="rcv-r-h">
            <div className="space-y-4">
              <NumberField label={t('receiving.detail.before')} value={form.before} onChange={(v) => set('before', v)} suffix={t('receiving.unit')} testId="rcv-before" />
              <NumberField label={t('receiving.detail.after')} value={form.after} onChange={(v) => set('after', v)} suffix={t('receiving.unit')} testId="rcv-after" />
            </div>
          </SectionCard>
          {evaluation.tankGainMl !== null ? (
            <dl data-gain="" className="space-y-1 rounded-[12px] border border-border bg-surface p-3 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-muted">{t('receiving.detail.tankGain')}</dt><dd><Liters ml={evaluation.tankGainMl} /></dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">{t('receiving.detail.gainVsReceived')}</dt><dd><VarianceText ml={evaluation.tankGainDiffMl} /></dd></div>
            </dl>
          ) : null}
        </div>
      ) : null}

      {step === 'documents' ? (
        <div className="space-y-5">
          <SectionCard title={t('receiving.attach.stepTitle')} id="rcv-doc-h">
            <p className="mb-3 text-sm leading-6 text-muted">{t('receiving.attach.stepHint')}</p>
            <FilePicker existing={files.length} onPicked={picked} />
            {rejectedFiles.length > 0 ? (
              <ul role="alert" data-rejected-files="" className="mt-3 space-y-1 rounded-[12px] bg-[color:var(--fo-negative-tint)] p-3 text-sm leading-6 text-negative">
                {rejectedFiles.map((item, index) => <li key={`${item.name}-${index}`} dir="auto">{item.name} — {t(`receiving.attach.reject.${item.reason}`)}</li>)}
              </ul>
            ) : null}
            {files.length > 0 ? (
              <ul className="mt-3 space-y-1.5" data-staged="">
                {files.map((file, index) => (
                  <li key={`${file.name}-${index}`} className="flex items-center gap-2 rounded-[10px] border border-border bg-surface px-3 py-2 text-sm">
                    <FileText aria-hidden="true" className="h-4 w-4 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1 truncate" dir="auto">{file.name}</span>
                    <span className="num text-xs text-muted">{formatBytes(file.size)}</span>
                    <button type="button" aria-label={`${t('receiving.attach.unstage')}: ${file.name}`} onClick={() => setFiles((current) => current.filter((_, i) => i !== index))} className="grid h-11 w-11 shrink-0 place-items-center rounded-md hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><X aria-hidden="true" className="h-4 w-4" /></button>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-3 text-sm text-muted" data-no-staged="">{t('receiving.attach.stepNone')}</p>}
          </SectionCard>
        </div>
      ) : null}

      {step === 'review' ? (
        <div className="space-y-5">
          <SectionCard title={t('receiving.wizard.step.review')} id="rcv-rev-h">
            <dl className="divide-y divide-border text-sm">
              {[
                [t('receiving.field.supplier'), supplier?.name ?? '—'],
                [t('receiving.field.tank'), `${selectedTank?.name ?? '—'}${selectedTank ? ` · ${products.find((p) => p.id === selectedTank.fuel_product_id)?.name ?? ''}` : ''}`],
                [t('receiving.field.warehouse'), stationRow?.warehouse?.name ?? '—'],
                [t('receiving.field.deliveryNote'), form.deliveryNote.trim() || '—'],
              ].map(([label, value]) => <div key={label} className="flex items-start justify-between gap-4 py-2.5"><dt className="text-muted">{label}</dt><dd className="min-w-0 break-words text-end text-text">{value}</dd></div>)}
              <div className="flex justify-between gap-4 py-2.5"><dt className="text-muted">{t('receiving.field.dispatched')}</dt><dd><Liters ml={evaluation.dispatchedMl} /></dd></div>
              <div className="flex justify-between gap-4 py-2.5"><dt className="text-muted">{t('receiving.field.received')}</dt><dd><Liters ml={evaluation.receivedMl} /></dd></div>
              <div className="flex justify-between gap-4 py-2.5"><dt className="text-muted">{t('receiving.detail.transitVariance')}</dt><dd><VarianceText ml={evaluation.transitVarianceMl} /></dd></div>
              <div className="flex justify-between gap-4 py-2.5"><dt className="text-muted">{t('receiving.attach.title')}</dt><dd className="num" data-review-files="">{files.length}</dd></div>
              <div className="flex justify-between gap-4 py-2.5"><dt className="text-muted">{t('receiving.detail.before')}</dt><dd><Liters ml={evaluation.beforeMl} /></dd></div>
              <div className="flex justify-between gap-4 py-2.5"><dt className="text-muted">{t('receiving.detail.after')}</dt><dd><Liters ml={evaluation.afterMl} /></dd></div>
              {evaluation.tankGainDiffMl !== null ? <div className="flex justify-between gap-4 py-2.5"><dt className="text-muted">{t('receiving.detail.gainVsReceived')}</dt><dd><VarianceText ml={evaluation.tankGainDiffMl} /></dd></div> : null}
            </dl>
          </SectionCard>
          <WarningList warnings={evaluation.warnings.filter((w) => w !== 'received_above_dispatched' && w !== 'received_below_dispatched')} />
          <p className="rounded-[12px] bg-primary-soft p-3 text-sm leading-6 text-text">{t('receiving.wizard.draftEffect')}</p>
          {stopped ? <FailureNotice failure={stopped.failure} onCheck={() => void check()} checking={checking} /> : null}
          {notFound ? <p role="status" data-not-found="" className="rounded-[12px] bg-[color:var(--fo-warning-tint)] p-3 text-sm leading-6 text-warning">{t('receiving.wizard.notFoundYet')}</p> : null}
        </div>
      ) : null}

      {attempted && shown.length > 0 ? <IssueList issues={shown} /> : null}

      <ActionBar>
        <div className="grid grid-cols-2 gap-2.5">
          <SecondaryButton disabled={index === 0 || saving} onClick={() => go(STEPS[Math.max(0, index - 1)])}>{t('receiving.wizard.back')}</SecondaryButton>
          {step === 'review'
            ? <PrimaryButton data-save-draft="" disabled={saving || evaluation.issues.length > 0} aria-busy={saving} onClick={() => void submit()}>{saving ? t('receiving.wizard.saving') : stopped?.failure.kind === 'unknown' || notFound ? t('receiving.wizard.retry') : t('receiving.wizard.save')}</PrimaryButton>
            : <PrimaryButton data-next-step="" onClick={onNext}>{t('receiving.wizard.next')}</PrimaryButton>}
        </div>
      </ActionBar>
    </>
  );
}

export function ReceivingNewScreen() {
  const t = useTranslations('stationOps');
  const access = useReceivingAccess();
  return (
    <>
      <PageMasthead title={t('receiving.wizard.title')} subtitle={t('receiving.wizard.subtitle')} backHref={RECEIVING_BASE} backLabel={t('receiving.title')} />
      <ScreenBody>
        {!access.create ? <EmptyState title={t('receiving.wizard.noCreate.title')} body={t('receiving.wizard.noCreate.body')} />
          : <StationGate>{(station) => <Wizard station={station} />}</StationGate>}
      </ScreenBody>
    </>
  );
}
