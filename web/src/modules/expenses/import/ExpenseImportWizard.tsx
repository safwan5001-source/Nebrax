'use client';

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, ArrowRight, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { FormActions } from '@/components/nebrax';
import { api, ApiError, downloadFile } from '@/lib/api';
import { downloadCsv, toCsv } from '@/lib/export';
import { formatMinorRiyal } from '@/lib/money';
import { cn } from '@/lib/utils';
import { Stepper } from '@/modules/products/import/stepper';
import { ImportJobStatusPanel } from '@/modules/import-jobs/ImportJobStatusPanel';
import { ImportRepairPanel } from '@/modules/import-jobs/ImportRepairPanel';
import { downloadImportFailures, type ApplyOptions } from '@/modules/import-jobs/client';
import { useImportJobEngine, useImportJobUrlParam, useResumeFromUrl } from '@/modules/import-jobs/useImportJobEngine';
import {
  ACCEPTED_EXPENSE_IMPORT_TYPES,
  DEFAULT_EXPENSE_IMPORT_OPTIONS,
  EXPENSE_IMPORT_ROW_LIMIT,
  EXPENSE_PAYMENT_METHODS,
  MAX_EXPENSE_IMPORT_BYTES,
  expenseFieldLabel,
  expenseImportFormData,
  expenseJobOptions,
  expenseMappingGaps,
  parseTaxRate,
  spreadsheetSafe,
  suggestedExpenseMapping,
  toggleRepeatRow,
  type ExpenseColumnMapping,
  type ExpenseImportOptions,
  type ExpenseImportPreview,
  type ExpenseInspectResult,
  type ExpensePaymentMethod,
  type ExpenseReferencePolicy,
} from './contract';

const STEP_KEYS = ['setup', 'preview', 'apply', 'result'] as const;
const ERRORS_COLLAPSED = 5;

interface ExpenseAccount {
  id: string;
  code: string;
  name: string;
  type: string;
  is_group: boolean;
  is_active?: boolean;
}

/**
 * معالج استيراد المصروفات مسوداتٍ (IMP-H5-S2b). الخطوات: ملف وقواعد ومطابقة ← معاينة (بلا كتابة) مع تأكيد صريح للتكرار الحقيقي ← تشغيلة دائمة مربوطة بالمعاينة
 * ← نتيجة مع تنزيل الصفوف الفاشلة وإصلاحها. الخادم مصدر الحقيقة؛ لا ترحيل ولا قيد من هنا (الترحيل فعلٌ منفصل لكل مصروف)، والضريبة والإجمالي يشتقّهما الخادم.
 */
export function ExpenseImportWizard() {
  const t = useTranslations('expenseImport');
  const tc = useTranslations('common');
  const locale = useLocale();
  const { success, toast } = useToast();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const { setParam } = useImportJobUrlParam();

  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [referencePolicy, setReferencePolicy] = useState<ExpenseReferencePolicy>(DEFAULT_EXPENSE_IMPORT_OPTIONS.referencePolicy);
  const [defaultAccountId, setDefaultAccountId] = useState('');
  const [defaultPayment, setDefaultPayment] = useState<ExpensePaymentMethod>(DEFAULT_EXPENSE_IMPORT_OPTIONS.defaultPaymentMethod);
  const [defaultTax, setDefaultTax] = useState(String(DEFAULT_EXPENSE_IMPORT_OPTIONS.defaultTaxRate));
  const [confirmedRows, setConfirmedRows] = useState<number[]>([]);
  const [accounts, setAccounts] = useState<ExpenseAccount[]>([]);
  const [inspection, setInspection] = useState<ExpenseInspectResult | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [mapping, setMapping] = useState<ExpenseColumnMapping>({});
  const [preview, setPreview] = useState<ExpenseImportPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resumedWithoutFile, setResumedWithoutFile] = useState(false);
  // يمنع ردّاً متأخراً لملفٍ/مدخلاتٍ سابقة من الكتابة فوق الأحدث (الفحص والمعاينة).
  const inspectSeq = useRef(0);
  const previewSeq = useRef(0);

  const engine = useImportJobEngine('expense_import');
  useResumeFromUrl((jobId) => {
    setResumedWithoutFile(true);
    void engine.resume(jobId);
  });

  useEffect(() => {
    api<{ data: ExpenseAccount[] }>('/accounts')
      .then((response) => setAccounts(response.data.filter((account) => account.type === 'expense' && !account.is_group && account.is_active !== false)))
      .catch(() => setAccounts([]));
  }, []);

  useEffect(() => {
    if (engine.job) {
      setParam(engine.job.id);
      if (step < 2 && engine.job.status !== 'ready') setStep(2);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine.job?.id]);

  const parsedTax = parseTaxRate(defaultTax);
  const taxValid = parsedTax !== null;
  const taxRate = parsedTax ?? 0;
  const fields = inspection?.fields ?? [];
  const gaps = useMemo(
    () => expenseMappingGaps(mapping, fields, { defaultAccountId, referencePolicy }),
    [mapping, fields, defaultAccountId, referencePolicy]
  );
  const activeMapping = inspection && inspection.columns.length > 0 ? mapping : undefined;
  const mappingReady = !activeMapping || (gaps.missingRequired.length === 0 && !gaps.missingAccount && !gaps.missingReference && !gaps.duplicate);
  const canPreview = Boolean(file) && !inspecting && !previewing && mappingReady && taxValid;
  const steps = STEP_KEYS.map((key) => ({ key, label: t(`step_${key}`) }));

  function currentOptions(rows: number[] = confirmedRows): ExpenseImportOptions {
    return { referencePolicy, defaultAccountId, defaultPaymentMethod: defaultPayment, defaultTaxRate: taxRate, confirmedRepeatRows: rows, mapping: activeMapping };
  }

  /** تشغيلةٌ سابقة مجمَّدة الملف والخيارات: أي تغيير في الملف/القواعد/المطابقة/التأكيد يُسقطها كي لا يُنفَّذ ما لم يُعايَن (تبقى على الخادم وتُستأنف برابطها). */
  function dropJob() {
    if (!engine.job) return;
    engine.reset();
    setParam(null);
    setResumedWithoutFile(false);
  }

  function invalidatePreview(resetConfirmed = true) {
    dropJob();
    previewSeq.current += 1;
    setPreviewing(false);
    setPreview(null);
    setExpanded(false);
    // أرقام الصفوف المؤكَّدة خاصةٌ بملفٍ وقواعدَ بعينها: أي تغيير فيهما يُسقط التأكيد فيُعاد صراحةً.
    if (resetConfirmed) setConfirmedRows([]);
  }

  function reset() {
    setStep(0);
    setFile(null);
    setInspection(null);
    setMapping({});
    inspectSeq.current += 1;
    setInspecting(false);
    invalidatePreview();
    setError(null);
    setResumedWithoutFile(false);
    setParam(null);
    engine.reset();
    if (fileInput.current) fileInput.current.value = '';
  }

  async function inspectFile(next: File, seq: number) {
    setInspecting(true);
    try {
      const form = new FormData();
      form.append('file', next);
      const response = await api<{ data: ExpenseInspectResult }>('/expenses/import/inspect', { method: 'POST', body: form });
      if (seq !== inspectSeq.current) return;
      setInspection(response.data);
      setMapping(suggestedExpenseMapping(response.data.columns));
    } catch (err) {
      if (seq !== inspectSeq.current) return;
      setInspection(null);
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      if (seq === inspectSeq.current) setInspecting(false);
    }
  }

  function acceptFile(next: File | null) {
    setFile(next);
    setInspection(null);
    setMapping({});
    invalidatePreview();
    setError(null);
    const seq = ++inspectSeq.current;
    setInspecting(false);
    if (!next) return;
    if (next.size > MAX_EXPENSE_IMPORT_BYTES) {
      setFile(null);
      setError(t('file_too_large', { limit: Math.round(MAX_EXPENSE_IMPORT_BYTES / (1024 * 1024)) }));
      if (fileInput.current) fileInput.current.value = '';
      return;
    }
    void inspectFile(next, seq);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    acceptFile(event.dataTransfer.files?.[0] ?? null);
  }

  function updateMapping(index: number, value: string) {
    setMapping((current) => ({ ...current, [index]: value === '' ? null : value }));
    invalidatePreview();
  }

  async function runPreview(rows: number[] = confirmedRows, keepOnError = false): Promise<boolean> {
    if (!file) return false;
    dropJob();
    const seq = ++previewSeq.current;
    setPreviewing(true);
    setError(null);
    try {
      const response = await api<{ data: ExpenseImportPreview }>('/expenses/import/preview', {
        method: 'POST',
        body: expenseImportFormData(file, currentOptions(rows)),
      });
      if (seq !== previewSeq.current) return false;
      setPreview(response.data);
      setStep(1);
      return true;
    } catch (err) {
      if (seq !== previewSeq.current) return false;
      // إعادة معاينة بعد تبديل تأكيدٍ تُبقي المعاينة السابقة سليمةً ويُلغى التبديل، بدل صفحةٍ فارغة.
      if (!keepOnError) setPreview(null);
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
      return false;
    } finally {
      if (seq === previewSeq.current) setPreviewing(false);
    }
  }

  /** تأكيد/إلغاء تأكيد صفٍّ كتكرار حقيقي ثم إعادة المعاينة فوراً: الخادم يعيد الحكم ويصدر ربطاً جديداً بالقائمة المجمَّدة. */
  function toggleConfirmed(row: number, confirmed: boolean) {
    const previous = confirmedRows;
    const next = toggleRepeatRow(confirmedRows, row, confirmed);
    setConfirmedRows(next);
    void runPreview(next, true).then((ok) => {
      if (!ok) setConfirmedRows(previous);
    });
  }

  function applyOptionsPayload(): ApplyOptions {
    return { ...expenseJobOptions(currentOptions()) } as ApplyOptions;
  }

  async function confirmAndApply() {
    setStep(2);
    setError(null);
    if (!engine.job) {
      if (!file) return;
      const job = await engine.upload(file, undefined, null, preview?.binding ? { binding: preview.binding, options: applyOptionsPayload() } : null);
      if (!job) {
        // فشل الإنشاء (معاينة منتهية/خيار مرفوض/شبكة): لا صفحة فارغة — نعود إلى المعاينة والخطأ ظاهر.
        setStep(1);
        return;
      }
      // تشغيلةٌ مربوطةٌ بمعاينة تنفّذ خياراتها المجمَّدة عند الإنشاء: لا خيارات دلالية في طلب التطبيق.
      await engine.applyLoop(job.id, job.preview_bound ? {} : applyOptionsPayload());
      return;
    }
    await engine.applyLoop(engine.job.id, engine.job.preview_bound ? {} : applyOptionsPayload());
  }

  async function repairFailedRows(repairFile: File) {
    if (!engine.job) return;
    const key = `repair-${engine.job.id}-${repairFile.name}-${repairFile.size}-${repairFile.lastModified}`;
    const child = await engine.repair(engine.job.id, repairFile, key);
    if (!child) return;
    // خيارات الفرعية مجمَّدة من أمّها؛ لا نرسل خيارات الصفحة الحالية.
    await engine.applyLoop(child.id, {});
  }

  async function downloadFailedRows(jobId: string) {
    try {
      if ((await downloadImportFailures(jobId)) === 'demo-unavailable') toast({ title: t('demo_unavailable'), variant: 'info' });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('repair_download_failed'));
    }
  }

  async function downloadTemplate() {
    try {
      if ((await downloadFile('/expenses/import/template', 'nebrax-expenses-import-template.csv')) === 'demo-unavailable') {
        toast({ title: t('demo_unavailable'), variant: 'info' });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    }
  }

  function downloadErrors(current: ExpenseImportPreview) {
    downloadCsv(
      'nebrax-expenses-import-errors',
      toCsv([t('report_row'), t('report_messages')], current.errors.map((issue) => [issue.row, spreadsheetSafe(issue.messages.join(' — '))]))
    );
  }

  useEffect(() => {
    if (engine.job?.status === 'completed') {
      setStep(3);
      success(t('success'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine.job?.status]);

  // `apply_result` يحمل قطعة التنفيذ الأخيرة وحدها؛ المجال إنشاءٌ فقط (صفٌّ = مسودة) فالعدد الكلي هو الصفوف المنجزة التراكمية للتشغيلة.
  const createdCount = engine.job?.processed_rows ?? (engine.job?.apply_result as { created?: number } | null | undefined)?.created ?? 0;
  const repeatRows = preview?.repeat_candidates ?? [];

  return (
    <div className="space-y-4 pb-24 lg:pb-0">
      <header className="flex flex-wrap items-start gap-3">
        <Button asChild variant="ghost" size="icon" aria-label={t('back')}>
          <Link href="/expenses">
            <ArrowRight className="h-4 w-4 rtl:rotate-0 ltr:rotate-180" strokeWidth={1.7} />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">{t('subtitle')}</p>
        </div>
        <Button type="button" variant="outline" onClick={() => void downloadTemplate()}>
          <Download className="h-4 w-4" strokeWidth={1.7} />
          {t('download_template')}
        </Button>
      </header>

      <Stepper steps={steps} current={step} onSelect={(index) => index <= step && setStep(index)} label={t('step_label')} />

      {error || engine.error ? (
        <p role="alert" className="rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-sm text-negative">
          {error ?? engine.error}
        </p>
      ) : null}

      {step === 0 ? (
        resumedWithoutFile && engine.job ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('resumed_title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm leading-relaxed text-muted">{t('resumed_hint', { name: engine.job.original_filename })}</p>
              {engine.job.preview_bound ? null : <p role="alert" className="text-sm text-negative">{t('resumed_unbound')}</p>}
              <FormActions
                primary={
                  <Button disabled={!engine.job.preview_bound} onClick={() => void confirmAndApply()}>
                    <Upload className="h-4 w-4" strokeWidth={1.7} />
                    {t('apply')}
                  </Button>
                }
              />
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>{t('step_file')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div
                  onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={onDrop}
                  className={cn('rounded-md border border-dashed p-6 text-center transition-colors', dragging ? 'border-primary bg-primary-soft' : 'border-border bg-background')}
                >
                  <FileSpreadsheet className="mx-auto h-6 w-6 text-muted" strokeWidth={1.6} />
                  <p className="mt-2 text-sm text-muted">{t('drop_hint')}</p>
                  <p className="mt-1 text-xs text-muted">{t('file_hint', { rows: EXPENSE_IMPORT_ROW_LIMIT })}</p>
                  <div className="mt-3">
                    <Label htmlFor="expense-import-file" className="sr-only">{t('step_file')}</Label>
                    <Input
                      id="expense-import-file"
                      ref={fileInput}
                      type="file"
                      accept={ACCEPTED_EXPENSE_IMPORT_TYPES}
                      onChange={(event: ChangeEvent<HTMLInputElement>) => acceptFile(event.target.files?.[0] ?? null)}
                      className="mx-auto max-w-sm"
                    />
                  </div>
                </div>
                {file ? (
                  <p className="flex items-center gap-2 truncate text-sm text-text" dir="ltr" title={file.name}>
                    <FileSpreadsheet className="h-4 w-4 text-primary" strokeWidth={1.7} />
                    {file.name}
                  </p>
                ) : null}
                {inspecting ? (
                  <p role="status" className="flex items-center gap-2 text-sm text-muted">
                    <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.7} />
                    {t('inspecting')}
                  </p>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('step_rules')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs leading-relaxed text-muted">{t('rules_drafts_note')}</p>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="ei-reference">{t('reference_policy')}</Label>
                    <Select id="ei-reference" value={referencePolicy} onChange={(event) => { setReferencePolicy(event.target.value as ExpenseReferencePolicy); invalidatePreview(); }}>
                      <option value="optional">{t('reference_optional')}</option>
                      <option value="required">{t('reference_required')}</option>
                    </Select>
                    <p className="text-xs leading-relaxed text-muted">{t(`reference_${referencePolicy}_hint`)}</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ei-account">{t('default_account')}</Label>
                    <Select id="ei-account" value={defaultAccountId} onChange={(event) => { setDefaultAccountId(event.target.value); invalidatePreview(); }}>
                      <option value="">{t('default_account_none')}</option>
                      {accounts.map((account) => (
                        <option key={account.id} value={account.id}>{account.code} — {account.name}</option>
                      ))}
                    </Select>
                    <p className="text-xs leading-relaxed text-muted">{t('default_account_hint')}</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ei-payment">{t('default_payment')}</Label>
                    <Select id="ei-payment" value={defaultPayment} onChange={(event) => { setDefaultPayment(event.target.value as ExpensePaymentMethod); invalidatePreview(); }}>
                      {EXPENSE_PAYMENT_METHODS.map((method) => (
                        <option key={method} value={method}>{t(`payment_${method}`)}</option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ei-tax">{t('default_tax')}</Label>
                    <Input
                      id="ei-tax"
                      inputMode="numeric"
                      value={defaultTax}
                      aria-invalid={!taxValid}
                      onChange={(event: ChangeEvent<HTMLInputElement>) => { setDefaultTax(event.target.value); invalidatePreview(); }}
                      className="num"
                    />
                    {!taxValid ? <p role="alert" className="text-xs text-negative">{t('default_tax_invalid')}</p> : <p className="text-xs leading-relaxed text-muted">{t('default_tax_hint')}</p>}
                  </div>
                </div>
              </CardContent>
            </Card>

            {inspection ? (
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle>{t('step_mapping')}</CardTitle>
                    <span className="num text-xs text-muted">{t('data_rows', { rows: inspection.total_rows })}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="ms-auto"
                      onClick={() => { setMapping(suggestedExpenseMapping(inspection.columns)); invalidatePreview(); }}
                    >
                      {t('mapping_reset')}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {gaps.missingRequired.length > 0 ? (
                    <p role="alert" className="rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-sm text-negative">
                      {t('mapping_missing_required', { fields: gaps.missingRequired.map((field) => expenseFieldLabel(field, locale)).join('، ') })}
                    </p>
                  ) : null}
                  {gaps.missingAccount ? (
                    <p role="alert" className="rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-sm text-negative">{t('mapping_missing_account')}</p>
                  ) : null}
                  {gaps.missingReference ? (
                    <p role="alert" className="rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-sm text-negative">{t('mapping_missing_reference')}</p>
                  ) : null}
                  {gaps.duplicate ? (
                    <p role="alert" className="rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-sm text-negative">{t('mapping_duplicate')}</p>
                  ) : null}
                  <p className="text-xs leading-relaxed text-muted">{t('mapping_amount_note')}</p>
                  <div className="overflow-x-auto rounded-md border border-border">
                    <table className="w-full min-w-[40rem] text-sm">
                      <thead className="bg-background text-muted">
                        <tr>
                          <th className="px-3 py-2 text-start font-medium">{t('mapping_source')}</th>
                          <th className="px-3 py-2 text-start font-medium">{t('mapping_sample')}</th>
                          <th className="px-3 py-2 text-start font-medium">{t('mapping_target')}</th>
                          <th className="px-3 py-2 text-start font-medium">{t('mapping_state')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {inspection.columns.map((column) => {
                          const selected = mapping[column.index] ?? '';
                          const field = fields.find((item) => item.key === selected);
                          return (
                            <tr key={column.index} className="border-t border-border align-top">
                              <td className="max-w-48 px-3 py-2">
                                <span className="block truncate font-medium text-text" title={column.header}>{column.header || '—'}</span>
                              </td>
                              <td className="max-w-48 px-3 py-2">
                                <span className="block truncate text-xs text-muted" title={column.samples.join(' · ')}>{column.samples.slice(0, 2).join(' · ') || '—'}</span>
                              </td>
                              <td className="px-3 py-2">
                                <Label htmlFor={`ei-map-${column.index}`} className="sr-only">{column.header || t('mapping_column', { n: column.index + 1 })}</Label>
                                <Select id={`ei-map-${column.index}`} value={selected} onChange={(event) => updateMapping(column.index, event.target.value)} className="min-w-44">
                                  <option value="">{t('mapping_ignore')}</option>
                                  {fields.map((item) => (
                                    <option key={item.key} value={item.key}>{expenseFieldLabel(item, locale)}</option>
                                  ))}
                                </Select>
                              </td>
                              <td className="px-3 py-2">
                                <span className="flex flex-wrap gap-1">
                                  <Badge tone={selected ? 'positive' : 'muted'}>{selected ? t('mapping_mapped') : t('mapping_unmapped')}</Badge>
                                  {field?.required ? <Badge tone="muted">{t('mapping_required')}</Badge> : null}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            ) : null}

            <FormActions
              primary={
                <Button disabled={!canPreview} onClick={() => void runPreview()}>
                  {previewing ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.7} /> : <CheckCircle2 className="h-4 w-4" strokeWidth={1.7} />}
                  {t('run_preview')}
                </Button>
              }
            />
          </div>
        )
      ) : null}

      {step === 1 && preview ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('step_preview')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(
                [
                  ['create', String(preview.create_rows)],
                  ['amount', formatMinorRiyal(preview.create_amount_minor)],
                  ['warning', String(preview.warning_rows)],
                  ['error', String(preview.error_rows)],
                ] as const
              ).map(([key, value]) => (
                <div key={key} className="rounded-md border border-border bg-background px-3 py-2">
                  <dt className="text-xs text-muted">{t(`count_${key}`)}</dt>
                  <dd className={cn('num mt-0.5 text-lg font-semibold', key === 'error' && preview.error_rows > 0 ? 'text-negative' : 'text-text')}>{value}</dd>
                </div>
              ))}
            </dl>
            <p className="text-xs leading-relaxed text-muted">{t('preview_drafts_note')}</p>

            {repeatRows.length > 0 ? (
              <section aria-label={t('repeats_title')} className="space-y-2 rounded-md border border-warning/40 bg-warning/5 p-3">
                <h3 className="flex items-center gap-1.5 text-sm font-medium text-text">
                  <AlertTriangle className="h-4 w-4 text-warning" strokeWidth={1.7} />
                  {t('repeats_title')}
                </h3>
                <p className="text-xs leading-relaxed text-muted">{t('repeats_hint')}</p>
                <p role="status" aria-live="polite" className="text-xs text-muted">{previewing ? t('repreviewing') : ''}</p>
                <ul className="space-y-1.5">
                  {repeatRows.map((row) => (
                    <li key={row.row} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={row.confirmed_repeat}
                          disabled={previewing}
                          onChange={(event) => toggleConfirmed(row.row, event.target.checked)}
                        />
                        <span>{t('repeat_confirm', { row: row.row })}</span>
                      </label>
                      <span className="num text-xs text-muted" dir="auto">
                        {[row.date, row.amount_minor === null ? null : formatMinorRiyal(row.amount_minor), row.vendor, row.reference].filter(Boolean).join(' · ')}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {preview.errors.length > 0 ? (
              <div className="space-y-2">
                <ul className="space-y-1 text-xs leading-relaxed text-negative">
                  {preview.errors.slice(0, expanded ? 50 : ERRORS_COLLAPSED).map((issue) => (
                    <li key={issue.row}>{t('row_label', { row: issue.row })}: {issue.messages.join(' — ')}</li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2">
                  {preview.errors.length > ERRORS_COLLAPSED ? (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setExpanded((value) => !value)}>
                      {expanded ? t('errors_show_less') : t('errors_show_more', { count: Math.min(preview.errors.length, 50) })}
                    </Button>
                  ) : null}
                  <Button type="button" variant="outline" size="sm" onClick={() => downloadErrors(preview)}>
                    <Download className="h-4 w-4" strokeWidth={1.7} />
                    {t('download_errors')}
                  </Button>
                </div>
              </div>
            ) : null}

            {preview.warning_rows > 0 ? (
              <p role="status" className="flex items-start gap-1.5 text-xs leading-relaxed text-warning">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
                {t('warnings_note')}
              </p>
            ) : null}
            {preview.rows_truncated ? <p className="text-xs text-muted">{t('rows_truncated', { shown: preview.rows_shown, total: preview.total_rows })}</p> : null}

            {preview.error_rows > 0 ? (
              <p role="alert" className="rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-sm text-negative">{t('fix_errors')}</p>
            ) : null}

            <FormActions
              secondary={<Button type="button" variant="outline" onClick={() => setStep(0)}>{t('back_to_setup')}</Button>}
              primary={
                <Button disabled={preview.error_rows > 0 || !preview.binding || previewing} onClick={() => void confirmAndApply()}>
                  <Upload className="h-4 w-4" strokeWidth={1.7} />
                  {t('apply')}
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : null}

      {step === 2 && engine.job ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('step_apply')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ImportJobStatusPanel
              job={engine.job}
              atomic={false}
              networkUncertain={engine.networkUncertain}
              cancelling={engine.busy === 'cancelling'}
              onCancel={engine.job ? () => void engine.cancel(engine.job!.id) : undefined}
              onOpenParent={(parentId) => void engine.resume(parentId)}
            />
            <ImportRepairPanel
              job={engine.job}
              busy={engine.busy !== null}
              onDownload={() => void downloadFailedRows(engine.job!.id)}
              onRepair={(repairFile) => void repairFailedRows(repairFile)}
            />
          </CardContent>
        </Card>
      ) : null}

      {step === 3 && engine.job?.status === 'completed' ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-positive" strokeWidth={1.7} />
              {t('step_result')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid grid-cols-2 gap-2">
              <div className="rounded-md border border-border bg-background px-3 py-2">
                <dt className="text-xs text-muted">{t('result_created')}</dt>
                <dd className="num mt-0.5 text-lg font-semibold text-text">{createdCount}</dd>
              </div>
            </dl>
            <p className="text-xs leading-relaxed text-muted">{t('result_drafts_hint')}</p>
            <FormActions
              secondary={<Button variant="outline" onClick={reset}>{t('start_another')}</Button>}
              primary={
                <Button asChild variant="primary">
                  <Link href="/expenses">{t('back_to_expenses')}</Link>
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
