'use client';

import { ChangeEvent, DragEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, ArrowRight, CheckCircle2, Download, FileSpreadsheet, Info, Loader2, Upload } from 'lucide-react';
import { EmptyState, FormActions } from '@/components/nebrax';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { useActorScope, useCan } from '@/lib/use-can';
import { cn } from '@/lib/utils';
import { hasFrozenOptions, type ImportBinding } from '@/modules/import-jobs/client';
import { ImportJobStatusPanel } from '@/modules/import-jobs/ImportJobStatusPanel';
import { MappingPresetBar } from '@/modules/import-jobs/MappingPresetBar';
import { useImportJobEngine, useImportJobUrlParam, useResumeFromUrl } from '@/modules/import-jobs/useImportJobEngine';
import { Stepper } from '@/modules/products/import/stepper';
import { usePartnerStatementsCapability } from '../capability';
import { downloadTemplate, fetchBranches, inspectStatement, previewStatement, type BranchOption, type PreviewOptions } from '../client';
import {
  ACCEPTED_IMPORT_TYPES,
  DEFAULT_AMOUNT_TOLERANCE_MINOR,
  DEFAULT_DATE_TOLERANCE_DAYS,
  DIRECTIONS,
  MAX_AMOUNT_TOLERANCE_MINOR,
  MAX_DATE_TOLERANCE_DAYS,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  PREVIEW_ROW_LIMIT,
  ROLES,
  fieldLabel,
  formatMinor,
  minorToDecimal,
  riyalToMinor,
  toLatinDigits,
  type AmountDirection,
  type ColumnMapping,
  type InspectResult,
  type PartnerRole,
  type PreviewResult,
} from '../contract';
import { describeError, describeMessage } from '../errors';
import { PartnerPicker } from '../PartnerPicker';
import {
  WIZARD_STEPS,
  applyOptionsFrom,
  branchChoices,
  canConfirmImport,
  mappingGaps,
  mappingReady,
  missingRequiredFields,
  previewOptionsFrom,
  previewVerdict,
  reconciliationHref,
  resultOutcome,
  setupIssues,
  setupReady,
  stepIndex,
  suggestedMapping,
  usesSingleAmount,
  type SetupInput,
  type WizardStep,
} from './wizard-state';

const DOMAIN = 'partner_statement' as const;

export function PartnerStatementImportWizard() {
  const t = useTranslations('partnerStatements');
  const locale = useLocale();
  const { toast } = useToast();
  const { can, hydrated } = useCan();
  const capability = usePartnerStatementsCapability();
  const scope = useActorScope();
  const { setParam } = useImportJobUrlParam();
  const fileInput = useRef<HTMLInputElement | null>(null);
  // «جيل» الفحص: ردّ فحص ملف سابق لا يجوز أن يستبدل فحص/مطابقة الملف الحالي (وإلا انعكست أعمدة المدين/الدائن عند الاستيراد).
  const inspectSeq = useRef(0);
  // «جيل» المعاينة: أي تعديل (إعداد/مطابقة/ملف/رجوع) يُبطل معاينة قيد الطلب، فلا يعيد ردّها المتأخر نتيجةً وخياراتٍ قديمة تُنفَّذ لاحقاً.
  const previewSeq = useRef(0);
  const engine = useImportJobEngine(DOMAIN);

  const [step, setStep] = useState<WizardStep>('file');
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [inspection, setInspection] = useState<InspectResult | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [role, setRole] = useState<PartnerRole | ''>('');
  const [partnerId, setPartnerId] = useState('');
  const [periodFrom, setPeriodFrom] = useState('');
  const [periodTo, setPeriodTo] = useState('');
  const [branchId, setBranchId] = useState('');
  const [dateTolerance, setDateTolerance] = useState(String(DEFAULT_DATE_TOLERANCE_DAYS));
  const [amountTolerance, setAmountTolerance] = useState(minorToDecimal(DEFAULT_AMOUNT_TOLERANCE_MINOR));
  const [direction, setDirection] = useState<AmountDirection | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewOptions, setPreviewOptions] = useState<PreviewOptions | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [resumedWithoutFile, setResumedWithoutFile] = useState(false);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [branchesFailed, setBranchesFailed] = useState(false);

  useResumeFromUrl((jobId) => {
    setResumedWithoutFile(true);
    void engine.resume(jobId);
  });

  useEffect(() => {
    if (!engine.job) return;
    setParam(engine.job.id);
    if (engine.job.status === 'completed') setStep('result');
    else if (stepIndex(step) < stepIndex('confirm') && engine.job.status !== 'ready') setStep('confirm');
    else if (resumedWithoutFile && engine.job.status === 'ready') setStep('confirm');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine.job?.id, engine.job?.status]);

  useEffect(() => {
    if (!capability.settled || !capability.canImport) return;
    let live = true;
    fetchBranches()
      .then((list) => {
        if (live) {
          setBranches(list);
          setBranchesFailed(false);
        }
      })
      .catch(() => live && setBranchesFailed(true));
    return () => {
      live = false;
    };
  }, [capability.settled, capability.canImport]);

  const restricted = Boolean(scope && scope.branches.length > 0);
  // دور بلا `branches.view` لا يستطيع قراءة `/branches` (403) مع أن الخادم يسمح له بالاستيراد إلى فروعه: نسقط إلى معرّفات نطاقه من `/me` بدل حقل إلزامي مستحيل.
  const branchOptions = branchChoices({ restricted, scopeIds: scope?.branches ?? [], fetched: branches, failed: branchesFailed });
  const namesUnavailable = restricted && branchOptions.some((option) => option.name === null);

  useEffect(() => {
    if (restricted && branchId === '' && branchOptions.length === 1) setBranchId(branchOptions[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restricted, branchOptions.length]);

  const dateToleranceValue = /^\d{1,3}$/.test(dateTolerance) ? Number(dateTolerance) : null;
  const amountToleranceValue = riyalToMinor(amountTolerance);
  const setup: SetupInput = {
    partnerId,
    role,
    periodFrom,
    periodTo,
    branchId,
    dateToleranceDays: dateToleranceValue,
    amountToleranceMinor: amountToleranceValue,
    branchRequired: restricted,
  };
  const issues = setupIssues(setup, MAX_DATE_TOLERANCE_DAYS);
  const gaps = mappingGaps(mapping, direction);
  const fields = inspection?.fields ?? [];

  const steps = WIZARD_STEPS.map((key) => ({ key, label: t(`wizard.step_${key}`) }));
  const errorText = errorKey ? t(`errors.${errorKey}`) : null;

  function invalidate() {
    previewSeq.current += 1;
    setPreviewing(false);
    setPreview(null);
    setPreviewOptions(null);
    setAcknowledged(false);
  }

  function reset() {
    inspectSeq.current += 1;
    previewSeq.current += 1;
    setPreviewing(false);
    setStep('file');
    setFile(null);
    setInspection(null);
    setMapping({});
    setPreview(null);
    setPreviewOptions(null);
    setAcknowledged(false);
    setErrorKey(null);
    setResumedWithoutFile(false);
    setTouched(false);
    setParam(null);
    engine.reset();
    if (fileInput.current) fileInput.current.value = '';
  }

  async function acceptFile(next: File | null) {
    const seq = ++inspectSeq.current;
    setFile(next);
    setInspecting(false);
    setInspection(null);
    setMapping({});
    invalidate();
    setErrorKey(null);
    if (!next) return;

    if (next.size > MAX_IMPORT_BYTES) {
      setFile(null);
      setErrorKey('file_too_large');
      if (fileInput.current) fileInput.current.value = '';
      return;
    }
    if (!/\.(csv|xlsx)$/i.test(next.name)) {
      setFile(null);
      setErrorKey('file_type');
      if (fileInput.current) fileInput.current.value = '';
      return;
    }

    setInspecting(true);
    try {
      const result = await inspectStatement(next);
      if (seq !== inspectSeq.current) return;
      if (result.total_rows > MAX_IMPORT_ROWS) {
        setErrorKey('file_too_many_rows');
        setFile(null);
        return;
      }
      setInspection(result);
      setMapping(suggestedMapping(result.columns));
    } catch (err) {
      if (seq !== inspectSeq.current) return;
      capability.observe(err);
      setErrorKey(describeError(err).key);
    } finally {
      if (seq === inspectSeq.current) setInspecting(false);
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void acceptFile(event.dataTransfer.files?.[0] ?? null);
  }

  function updateMapping(index: number, value: string) {
    const next = { ...mapping, [index]: value === '' ? null : value };
    setMapping(next);
    if (!usesSingleAmount(next)) setDirection(null);
    invalidate();
  }

  function goSetup() {
    setTouched(true);
    if (file && inspection) setStep('setup');
  }

  function goMapping() {
    setTouched(true);
    if (setupReady(setup, MAX_DATE_TOLERANCE_DAYS)) {
      setTouched(false);
      setStep('mapping');
    }
  }

  async function runPreview() {
    setTouched(true);
    if (!file || !mappingReady(mapping, direction) || !setupReady(setup, MAX_DATE_TOLERANCE_DAYS)) return;
    const options = previewOptionsFrom(setup, mapping, direction);
    const seq = ++previewSeq.current;
    setPreviewing(true);
    setErrorKey(null);
    try {
      const result = await previewStatement(file, options);
      if (seq !== previewSeq.current) return;
      setPreview(result);
      setPreviewOptions(options);
      setAcknowledged(false);
      setStep('preview');
    } catch (err) {
      if (seq !== previewSeq.current) return;
      capability.observe(err);
      invalidate();
      setErrorKey(describeError(err).key);
    } finally {
      if (seq === previewSeq.current) setPreviewing(false);
    }
  }

  async function confirmAndApply() {
    if (!canConfirmImport(preview, acknowledged) && !engine.job) return;
    setErrorKey(null);
    if (!engine.job) {
      if (!file || !preview?.binding || !previewOptions) return;
      setStep('confirm');
      const job = await engine.upload(file, undefined, null, { binding: { expires_at: '', ...preview.binding } as ImportBinding, options: applyOptionsFrom(previewOptions) });
      if (!job) return;
      await engine.applyLoop(job.id, {});
      return;
    }
    await engine.applyLoop(engine.job.id, hasFrozenOptions(engine.job) || !previewOptions ? {} : applyOptionsFrom(previewOptions));
  }

  async function onDownloadTemplate() {
    const outcome = await downloadTemplate().catch(() => null);
    if (outcome === 'demo-unavailable') toast({ title: t('wizard.template_demo_unavailable'), variant: 'info' });
  }

  const engineError = engine.error ? describeMessage(engine.error) : null;
  const outcome = engine.job?.status === 'completed' ? resultOutcome(engine.job.apply_result) : null;
  const verdict = preview ? previewVerdict(preview) : null;

  // ─────────── بوابات الوصول (الظهور ليس تفويضاً: الخادم يعيد الفحص) ───────────
  const header = (
    <header className="flex flex-wrap items-start gap-3">
      <Button asChild variant="ghost" size="icon" aria-label={t('wizard.back')}>
        <Link href="/partner-statements">
          <ArrowRight className="h-4 w-4 ltr:rotate-180" strokeWidth={1.7} />
        </Link>
      </Button>
      <div className="min-w-0 flex-1">
        <h1 className="text-xl font-semibold text-text">{t('wizard.title')}</h1>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">{t('wizard.subtitle')}</p>
      </div>
      {capability.canImport ? (
        <Button variant="outline" onClick={() => void onDownloadTemplate()}>
          <Download className="h-4 w-4" strokeWidth={1.7} />
          {t('wizard.download_template')}
        </Button>
      ) : null}
    </header>
  );

  if (hydrated && !can('partner_statements.reconcile')) {
    return (
      <div className="space-y-4">
        {header}
        <EmptyState titleAs="h2" title={t('wizard.no_permission_title')} description={t('wizard.no_permission_hint')} action={can('partner_statements.view') ? <Button asChild variant="outline"><Link href="/partner-statements">{t('wizard.back_to_list')}</Link></Button> : undefined} />
      </div>
    );
  }
  if (capability.state === 'disabled') {
    return (
      <div className="space-y-4">
        {header}
        <EmptyState titleAs="h2" title={t('state.disabled_title')} description={t('state.disabled_hint')} action={can('apps.view') ? <Button asChild variant="outline"><Link href="/applications">{t('state.open_applications')}</Link></Button> : undefined} />
      </div>
    );
  }
  if (capability.state === 'suspended') {
    return (
      <div className="space-y-4">
        {header}
        <EmptyState titleAs="h2" title={t('wizard.suspended_title')} description={t('state.suspended_hint')} action={<Button asChild variant="outline"><Link href="/partner-statements">{t('wizard.back_to_list')}</Link></Button>} />
      </div>
    );
  }

  const sar = t('wizard.currency_sar');

  return (
    <div className="space-y-4 pb-24 lg:pb-0">
      {header}

      <p className="num text-xs text-muted md:hidden">{t('wizard.step_of', { current: String(stepIndex(step) + 1), total: String(steps.length) })}</p>
      <Stepper steps={steps} current={stepIndex(step)} onSelect={(index) => { if (index < stepIndex(step) && !engine.job) { if (stepIndex(step) < stepIndex('preview')) invalidate(); setStep(WIZARD_STEPS[index]); } }} label={t('wizard.steps_label')} />

      {errorText || engineError ? (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-negative/40 bg-negative/5 p-3 text-sm text-negative">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.7} />
          <span className="leading-relaxed">{errorText ?? t(`errors.${engineError?.key ?? 'unknown'}`)}</span>
        </div>
      ) : null}

      {/* ───────────── 1) الملف ───────────── */}
      {step === 'file' ? (
        resumedWithoutFile && engine.job ? (
          <Card>
            <CardHeader><CardTitle>{t('wizard.resumed_title')}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm leading-relaxed text-muted">{t('wizard.resumed_hint', { name: engine.job.original_filename })}</p>
              <FormActions primary={<Button onClick={() => setStep('confirm')}>{t('wizard.continue')}</Button>} />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader><CardTitle>{t('wizard.step_file')}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div
                onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                className={cn('flex flex-col items-center gap-2 rounded-md border border-dashed p-6 text-center transition-colors', dragging ? 'border-primary bg-primary-soft' : 'border-border')}
              >
                <Upload className="h-5 w-5 text-muted" strokeWidth={1.7} />
                <p className="text-sm text-text">{t('wizard.drop_hint')}</p>
                <p className="text-xs leading-relaxed text-muted">{t('wizard.file_limits', { rows: String(MAX_IMPORT_ROWS), mb: String(Math.round(MAX_IMPORT_BYTES / (1024 * 1024))) })}</p>
                <input
                  ref={fileInput}
                  id="ps-file"
                  type="file"
                  accept={ACCEPTED_IMPORT_TYPES}
                  aria-label={t('wizard.choose_file')}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => void acceptFile(event.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-muted file:me-3 file:min-h-[44px] file:rounded file:border file:border-border file:bg-background file:px-3 file:text-sm file:text-text md:file:min-h-0 md:file:py-1.5"
                />
              </div>
              {inspecting ? (
                <p className="flex items-center gap-2 text-sm text-muted" role="status"><Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.7} />{t('wizard.inspecting')}</p>
              ) : null}
              {file && inspection ? (
                <p className="flex items-center gap-2 text-sm text-text" role="status">
                  <FileSpreadsheet className="h-4 w-4 text-primary" strokeWidth={1.7} />
                  <span className="truncate" dir="auto">{file.name}</span>
                  <span className="num text-muted">{t('wizard.rows_found', { count: String(inspection.total_rows) })}</span>
                </p>
              ) : null}
              <p className="text-xs leading-relaxed text-muted">{t('wizard.direction_note')}</p>
              <FormActions primary={<Button disabled={!file || !inspection} onClick={goSetup}>{t('wizard.next')}</Button>} />
            </CardContent>
          </Card>
        )
      ) : null}

      {/* ───────────── 2) الطرف والفترة والسياسات المجمَّدة ───────────── */}
      {step === 'setup' ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>{t('wizard.step_setup')}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="ps-role">{t('wizard.role')}</Label>
                <Select id="ps-role" value={role} aria-invalid={touched && issues.role ? true : undefined} onChange={(event) => { setRole(event.target.value as PartnerRole | ''); setPartnerId(''); invalidate(); }}>
                  <option value="">{t('wizard.role_choose')}</option>
                  {ROLES.map((value) => <option key={value} value={value}>{t(`role.${value}`)}</option>)}
                </Select>
                {touched && issues.role ? <p role="alert" className="text-xs text-negative">{t('wizard.role_required')}</p> : null}
              </div>

              <PartnerPicker
                role={role}
                value={partnerId}
                label={t('wizard.partner')}
                disabled={role === ''}
                error={touched && issues.partner ? t('wizard.partner_required') : null}
                onChange={(id) => { setPartnerId(id); invalidate(); }}
              />

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="ps-period-from">{t('wizard.period_from')}</Label>
                  <Input id="ps-period-from" type="date" lang="en" dir="ltr" value={periodFrom} onChange={(event) => { setPeriodFrom(event.target.value); invalidate(); }} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ps-period-to">{t('wizard.period_to')}</Label>
                  <Input id="ps-period-to" type="date" lang="en" dir="ltr" value={periodTo} onChange={(event) => { setPeriodTo(event.target.value); invalidate(); }} />
                </div>
              </div>
              {touched && issues.period ? <p role="alert" className="text-xs text-negative">{t(`wizard.period_${issues.period}`)}</p> : null}

              <div className="space-y-1.5">
                <Label htmlFor="ps-branch">{t('wizard.branch')}</Label>
                <Select id="ps-branch" value={branchId} aria-invalid={touched && issues.branch ? true : undefined} onChange={(event) => { setBranchId(event.target.value); invalidate(); }}>
                  {restricted ? <option value="">{t('wizard.branch_choose')}</option> : <option value="">{t('scope.organization')}</option>}
                  {branchOptions.map((branch) => <option key={branch.id} value={branch.id}>{branch.name ?? t('wizard.branch_unnamed', { code: branch.id.slice(0, 8) })}</option>)}
                </Select>
                <p className="text-xs leading-relaxed text-muted">{restricted ? t('wizard.branch_restricted_hint') : t('wizard.branch_hint')}</p>
                {namesUnavailable ? <p className="text-xs leading-relaxed text-warning">{t('wizard.branch_names_unavailable')}</p> : null}
                {touched && issues.branch ? <p role="alert" className="text-xs text-negative">{t('wizard.branch_required')}</p> : null}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>{t('wizard.policies_title')}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <p className="flex items-start gap-2 rounded-md border border-border bg-background p-3 text-xs leading-relaxed text-muted">
                <Info className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.7} />
                {t('wizard.policies_frozen')}
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="ps-currency">{t('wizard.currency')}</Label>
                <Input id="ps-currency" value={sar} readOnly disabled dir="ltr" />
                <p className="text-xs leading-relaxed text-muted">{t('wizard.currency_hint')}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ps-date-tolerance">{t('wizard.date_tolerance')}</Label>
                <Input
                  id="ps-date-tolerance"
                  inputMode="numeric"
                  dir="ltr"
                  value={dateTolerance}
                  aria-invalid={touched && issues.dateTolerance ? true : undefined}
                  onChange={(event) => { setDateTolerance(toLatinDigits(event.target.value)); invalidate(); }}
                />
                <p className="text-xs leading-relaxed text-muted">{t('wizard.date_tolerance_hint', { max: String(MAX_DATE_TOLERANCE_DAYS) })}</p>
                {touched && issues.dateTolerance ? <p role="alert" className="text-xs text-negative">{t('errors.date_tolerance_invalid')}</p> : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ps-amount-tolerance">{t('wizard.amount_tolerance')}</Label>
                <Input
                  id="ps-amount-tolerance"
                  inputMode="decimal"
                  dir="ltr"
                  value={amountTolerance}
                  aria-invalid={touched && issues.amountTolerance ? true : undefined}
                  onChange={(event) => { setAmountTolerance(toLatinDigits(event.target.value)); invalidate(); }}
                />
                <p className="text-xs leading-relaxed text-muted">{t('wizard.amount_tolerance_hint', { max: formatMinor(MAX_AMOUNT_TOLERANCE_MINOR) })}</p>
                {touched && issues.amountTolerance ? <p role="alert" className="text-xs text-negative">{t('errors.amount_tolerance_invalid')}</p> : null}
              </div>
              <p className="text-xs leading-relaxed text-muted">{t('wizard.reversed_included')}</p>
            </CardContent>
          </Card>

          <div className="lg:col-span-2">
            <FormActions
              secondary={<Button variant="outline" onClick={() => setStep('file')}>{t('wizard.previous')}</Button>}
              primary={<Button onClick={goMapping}>{t('wizard.next')}</Button>}
            />
          </div>
        </div>
      ) : null}

      {/* ───────────── 3) مطابقة الأعمدة ───────────── */}
      {step === 'mapping' && inspection ? (
        <Card>
          <CardHeader><CardTitle>{t('wizard.step_mapping')}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm leading-relaxed text-muted">{t('wizard.mapping_hint')}</p>
            <MappingPresetBar
              domain={DOMAIN}
              columns={inspection.columns}
              mapping={mapping}
              fieldKeys={fields.map((field) => field.key)}
              onApply={(next) => { setMapping(next); if (!usesSingleAmount(next)) setDirection(null); invalidate(); }}
            />
            <ul className="grid grid-cols-1 gap-2 md:grid-cols-2" aria-label={t('wizard.mapping_list')}>
              {inspection.columns.map((column) => (
                <li key={column.index} className="space-y-2 rounded-md border border-border p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-text" dir="auto">{column.header || t('wizard.column_unnamed', { n: String(column.index + 1) })}</p>
                    <p className="truncate text-xs text-muted" dir="auto">{column.samples.length ? column.samples.slice(0, 3).join(' · ') : '—'}</p>
                  </div>
                  <Select
                    value={mapping[column.index] ?? ''}
                    aria-label={t('wizard.mapping_target_for', { column: column.header || String(column.index + 1) })}
                    onChange={(event) => updateMapping(column.index, event.target.value)}
                  >
                    <option value="">{t('wizard.mapping_ignore')}</option>
                    {fields.map((field) => (
                      <option key={field.key} value={field.key}>{fieldLabel(field, locale)}{field.required ? ' *' : ''}</option>
                    ))}
                  </Select>
                </li>
              ))}
            </ul>

            {usesSingleAmount(mapping) ? (
              <div className="space-y-1.5 rounded-md border border-border p-3">
                <Label htmlFor="ps-direction">{t('wizard.direction')}</Label>
                <Select id="ps-direction" value={direction ?? ''} onChange={(event) => { setDirection((event.target.value || null) as AmountDirection | null); invalidate(); }}>
                  <option value="">{t('wizard.direction_choose')}</option>
                  {DIRECTIONS.map((value) => <option key={value} value={value}>{t(`wizard.direction_${value}`)}</option>)}
                </Select>
                <p className="text-xs leading-relaxed text-muted">{t('wizard.direction_hint')}</p>
              </div>
            ) : null}

            {!mappingReady(mapping, direction) ? (
              <ul className="space-y-1 text-sm text-negative" role="alert">
                {gaps.duplicate ? <li>{t('errors.mapping_duplicate')}</li> : null}
                {gaps.missingDate ? <li>{t('errors.mapping_missing_date')}</li> : null}
                {gaps.amountConflict ? <li>{t('errors.mapping_amount_conflict')}</li> : null}
                {gaps.amountMissing && !gaps.amountConflict ? <li>{t('errors.mapping_amount_missing')}</li> : null}
                {gaps.directionRequired ? <li>{t('errors.direction_required')}</li> : null}
                {gaps.directionUnexpected ? <li>{t('errors.direction_unexpected')}</li> : null}
                {missingRequiredFields(mapping, fields).filter((field) => field.key !== 'line_date').map((field) => <li key={field.key}>{t('wizard.mapping_missing_required', { field: fieldLabel(field, locale) })}</li>)}
              </ul>
            ) : null}

            <FormActions
              secondary={<Button variant="outline" onClick={() => { invalidate(); setStep('setup'); }}>{t('wizard.previous')}</Button>}
              primary={
                <Button disabled={!mappingReady(mapping, direction) || previewing} onClick={() => void runPreview()}>
                  {previewing ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.7} /> : null}
                  {t('wizard.run_preview')}
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : null}

      {/* ───────────── 4) المعاينة ───────────── */}
      {step === 'preview' && preview ? (
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>{t('wizard.step_preview')}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text">
                <bdi className="font-medium">{preview.partner_name}</bdi>
                <span aria-hidden="true">·</span>
                <span>{t(`role.${preview.role}`)}</span>
                <span aria-hidden="true">·</span>
                <span className="num" dir="ltr">{preview.period_from} → {preview.period_to}</span>
                <span aria-hidden="true">·</span>
                <span dir="ltr">{sar}</span>
              </p>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <Counter label={t('wizard.counter_rows')} value={preview.total_rows} />
                <Counter label={t('wizard.counter_valid')} value={preview.valid_rows} tone="positive" />
                <Counter label={t('wizard.counter_errors')} value={preview.error_rows} tone={preview.error_rows > 0 ? 'negative' : undefined} />
                <Counter label={t('wizard.counter_warnings')} value={preview.warning_rows} tone={preview.warning_rows > 0 ? 'warning' : undefined} />
                <Counter label={t('wizard.counter_debit')} value={formatMinor(preview.total_debit_minor)} />
                <Counter label={t('wizard.counter_credit')} value={formatMinor(preview.total_credit_minor)} />
              </dl>

              <PolicySummary t={t} preview={preview} />

              {preview.checks.balance_mismatches.length > 0 ? (
                <p className="flex items-start gap-2 text-sm text-warning" role="status">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.7} />
                  {t('wizard.balance_mismatch', { count: String(preview.checks.balance_mismatches.length) })}
                </p>
              ) : null}

              {verdict === 'already_imported' ? (
                <div role="status" className="flex flex-wrap items-center gap-3 rounded-md border border-primary/30 bg-primary-soft p-3 text-sm text-text">
                  <Info className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.7} />
                  <span className="leading-relaxed">{t('wizard.already_imported')}</span>
                  <Button asChild variant="outline" size="sm"><Link href={reconciliationHref(preview.existing_reconciliation_id)}>{t('wizard.open_existing')}</Link></Button>
                </div>
              ) : null}
              {verdict === 'blocked_errors' ? (
                <div role="alert" className="space-y-2 rounded-md border border-negative/40 bg-negative/5 p-3 text-sm text-negative">
                  <p className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={1.7} />{t('wizard.blocking_errors', { count: String(preview.error_rows) })}</p>
                  <ul className="space-y-0.5 text-xs">
                    {preview.errors.slice(0, 10).map((item) => <li key={item.row}><span className="num">{t('wizard.row_n', { n: String(item.row) })}</span>: {item.messages.join(' — ')}</li>)}
                  </ul>
                </div>
              ) : null}
              {verdict === 'blocked_empty' ? <p role="alert" className="text-sm text-negative">{t('errors.no_rows')}</p> : null}
              {verdict === 'ready' ? (
                <p className="flex items-center gap-2 text-sm text-positive"><CheckCircle2 className="h-4 w-4" strokeWidth={1.7} />{t('wizard.no_blocking_errors')}</p>
              ) : null}
              {preview.rows_truncated ? <p className="text-xs text-muted">{t('wizard.rows_truncated', { shown: String(preview.rows_shown), limit: String(PREVIEW_ROW_LIMIT) })}</p> : null}
            </CardContent>
          </Card>

          <div className="hidden overflow-x-auto rounded border border-border md:block">
            <table className="w-full min-w-[52rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-background text-xs text-muted">
                  <th className="p-2 text-start font-medium">{t('wizard.col_row')}</th>
                  <th className="p-2 text-start font-medium">{t('wizard.col_status')}</th>
                  <th className="p-2 text-start font-medium">{t('wizard.col_date')}</th>
                  <th className="p-2 text-start font-medium">{t('wizard.col_reference')}</th>
                  <th className="p-2 text-start font-medium">{t('wizard.col_description')}</th>
                  <th className="p-2 text-end font-medium">{t('wizard.counter_debit')}</th>
                  <th className="p-2 text-end font-medium">{t('wizard.counter_credit')}</th>
                  <th className="p-2 text-start font-medium">{t('wizard.col_notes')}</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.row} className="border-b border-border/60 align-top">
                    <td className="num p-2 text-muted">{row.row}</td>
                    <td className="p-2"><Badge tone={row.status === 'ok' ? 'positive' : row.status === 'warning' ? 'warning' : 'negative'}>{t(`wizard.row_${row.status}`)}</Badge></td>
                    <td className="num p-2 text-text" dir="ltr">{row.line_date ?? '—'}</td>
                    <td className="num p-2 text-text" dir="auto">{row.reference ?? '—'}</td>
                    <td className="max-w-[16rem] truncate p-2 text-text" dir="auto">{row.description ?? '—'}</td>
                    <td className="num p-2 text-end text-text" dir="ltr">{row.debit_minor ? formatMinor(row.debit_minor) : '—'}</td>
                    <td className="num p-2 text-end text-text" dir="ltr">{row.credit_minor ? formatMinor(row.credit_minor) : '—'}</td>
                    <td className={cn('p-2 text-xs leading-relaxed', row.messages.length ? 'text-negative' : 'text-warning')}>{[...row.messages, ...row.warnings].join(' — ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="space-y-2 md:hidden" aria-label={t('wizard.preview_rows')}>
            {preview.rows.map((row) => (
              <li key={row.row} className="rounded border border-border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="num text-xs text-muted">{t('wizard.row_n', { n: String(row.row) })}</p>
                    <p className="truncate text-sm font-medium text-text" dir="auto">{row.reference ?? row.description ?? '—'}</p>
                    <p className="num text-xs text-muted" dir="ltr">{row.line_date ?? '—'}</p>
                  </div>
                  <Badge tone={row.status === 'ok' ? 'positive' : row.status === 'warning' ? 'warning' : 'negative'}>{t(`wizard.row_${row.status}`)}</Badge>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <div><dt className="text-muted">{t('wizard.counter_debit')}</dt><dd className="num text-text" dir="ltr">{row.debit_minor ? formatMinor(row.debit_minor) : '—'}</dd></div>
                  <div><dt className="text-muted">{t('wizard.counter_credit')}</dt><dd className="num text-text" dir="ltr">{row.credit_minor ? formatMinor(row.credit_minor) : '—'}</dd></div>
                </dl>
                {row.messages.length || row.warnings.length ? <p className={cn('mt-2 text-xs leading-relaxed', row.messages.length ? 'text-negative' : 'text-warning')}>{[...row.messages, ...row.warnings].join(' — ')}</p> : null}
              </li>
            ))}
          </ul>

          <FormActions
            secondary={<Button variant="outline" onClick={() => setStep('mapping')}>{t('wizard.previous')}</Button>}
            primary={<Button disabled={verdict !== 'ready'} onClick={() => { setAcknowledged(false); setStep('confirm'); }}>{t('wizard.next')}</Button>}
          />
        </div>
      ) : null}

      {/* ───────────── 5) التأكيد والتنفيذ ───────────── */}
      {step === 'confirm' ? (
        <Card>
          <CardHeader><CardTitle>{t('wizard.step_confirm')}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {!engine.job && preview && previewOptions ? (
              <>
                <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                  <Summary label={t('wizard.partner')} value={preview.partner_name} />
                  <Summary label={t('wizard.role')} value={t(`role.${preview.role}`)} />
                  <Summary label={t('wizard.period')} value={`${preview.period_from} → ${preview.period_to}`} ltr />
                  <Summary label={t('wizard.branch')} value={previewOptions.branchId ? (branches.find((branch) => branch.id === previewOptions.branchId)?.name ?? t('scope.branch')) : t('scope.organization')} />
                  <Summary label={t('wizard.currency')} value={sar} ltr />
                  <Summary label={t('wizard.counter_rows')} value={String(preview.total_rows)} ltr />
                  <Summary label={t('wizard.counter_debit')} value={formatMinor(preview.total_debit_minor)} ltr />
                  <Summary label={t('wizard.counter_credit')} value={formatMinor(preview.total_credit_minor)} ltr />
                </dl>
                <PolicySummary t={t} preview={preview} />
                <label className="flex min-h-[44px] items-start gap-3 rounded-md border border-border p-3 text-sm text-text md:min-h-0">
                  <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-[var(--primary)]" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
                  <span className="leading-relaxed">{t('wizard.acknowledge')}</span>
                </label>
                <p className="text-xs leading-relaxed text-muted">{t('disclaimer')}</p>
                <FormActions
                  secondary={<Button variant="outline" onClick={() => setStep('preview')}>{t('wizard.previous')}</Button>}
                  primary={
                    <Button disabled={!canConfirmImport(preview, acknowledged) || engine.busy !== null} onClick={() => void confirmAndApply()}>
                      <Upload className="h-4 w-4" strokeWidth={1.7} />
                      {t('wizard.import_now')}
                    </Button>
                  }
                />
              </>
            ) : null}

            {engine.job ? (
              <>
                <ImportJobStatusPanel job={engine.job} atomic networkUncertain={engine.networkUncertain} />
                {engine.canApply && engine.busy === null ? (
                  <FormActions primary={<Button onClick={() => void confirmAndApply()}>{t('wizard.import_now')}</Button>} />
                ) : null}
                {engine.job.status === 'failed' || engine.job.status === 'cancelled' ? (
                  <FormActions primary={<Button variant="outline" onClick={reset}>{t('wizard.start_over')}</Button>} />
                ) : null}
              </>
            ) : null}
            {engine.busy === 'uploading' && !engine.job ? (
              <p className="flex items-center gap-2 text-sm text-muted" role="status"><Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.7} />{t('wizard.uploading')}</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* ───────────── 6) النتيجة ───────────── */}
      {step === 'result' && outcome ? (
        <Card>
          <CardHeader><CardTitle>{t('wizard.step_result')}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {outcome.kind === 'replayed' ? (
              <p role="status" className="flex items-start gap-2 text-sm text-text"><Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={1.7} />{t('wizard.result_replayed')}</p>
            ) : (
              <p role="status" className="flex items-center gap-2 text-sm text-positive"><CheckCircle2 className="h-4 w-4" strokeWidth={1.7} />{t('wizard.result_created', { count: String(outcome.lines ?? 0) })}</p>
            )}
            <p className="text-sm leading-relaxed text-muted">{t('wizard.result_next')}</p>
            <FormActions
              secondary={<Button variant="outline" onClick={reset}>{t('wizard.import_another')}</Button>}
              primary={
                outcome.reconciliationId ? (
                  <Button asChild><Link href={reconciliationHref(outcome.reconciliationId)}>{t('wizard.open_result')}</Link></Button>
                ) : (
                  <Button asChild variant="outline"><Link href="/partner-statements">{t('wizard.back_to_list')}</Link></Button>
                )
              }
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Counter({ label, value, tone }: { label: string; value: number | string; tone?: 'positive' | 'negative' | 'warning' }) {
  return (
    <div className="rounded-md border border-border p-3">
      <dt className="text-xs leading-relaxed text-muted">{label}</dt>
      <dd className={cn('num mt-1 text-lg font-semibold', tone === 'positive' ? 'text-positive' : tone === 'negative' ? 'text-negative' : tone === 'warning' ? 'text-warning' : 'text-text')} dir="ltr">{value}</dd>
    </div>
  );
}

function Summary({ label, value, ltr = false }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={cn('mt-0.5 truncate text-text', ltr && 'num')} dir={ltr ? 'ltr' : undefined}>{ltr ? value : <bdi>{value}</bdi>}</dd>
    </div>
  );
}

/** السياسات المجمَّدة كما أعادها الخادم في المعاينة (لا كما كتبها المستخدم): هي ما سيُثبَّت فعلاً مع الكشف. */
function PolicySummary({ t, preview }: { t: ReturnType<typeof useTranslations>; preview: PreviewResult }) {
  const policy = preview.policy;
  return (
    <section aria-label={t('wizard.policies_title')} className="rounded-md border border-border bg-background p-3">
      <p className="mb-2 text-xs font-medium text-muted">{t('wizard.policies_frozen_short')}</p>
      <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
        <Summary label={t('wizard.date_tolerance')} value={t('wizard.days_value', { count: String(policy.date_tolerance_days) })} ltr />
        <Summary label={t('wizard.amount_tolerance')} value={formatMinor(policy.amount_tolerance_minor)} ltr />
        <Summary label={t('wizard.direction')} value={policy.amount_direction ? t(`wizard.direction_${policy.amount_direction}`) : t('wizard.direction_by_columns')} />
      </dl>
    </section>
  );
}
