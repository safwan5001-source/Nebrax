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
import { cn } from '@/lib/utils';
import { Stepper } from '@/modules/products/import/stepper';
import { ImportJobStatusPanel } from '@/modules/import-jobs/ImportJobStatusPanel';
import { ImportRepairPanel } from '@/modules/import-jobs/ImportRepairPanel';
import { downloadImportFailures, type ApplyOptions } from '@/modules/import-jobs/client';
import { useImportJobEngine, useImportJobUrlParam, useResumeFromUrl } from '@/modules/import-jobs/useImportJobEngine';
import {
  ACCEPTED_TAXONOMY_IMPORT_TYPES,
  DEFAULT_TAXONOMY_IMPORT_OPTIONS,
  MAX_TAXONOMY_IMPORT_BYTES,
  TAXONOMY_IMPORT_ROW_LIMIT,
  TAXONOMY_MODES,
  spreadsheetSafe,
  suggestedTaxonomyMapping,
  taxonomyFieldLabel,
  taxonomyImportFormData,
  taxonomyJobOptions,
  taxonomyMappingGaps,
  type TaxonomyBlankPolicy,
  type TaxonomyColumnMapping,
  type TaxonomyImportOptions,
  type TaxonomyImportPreview,
  type TaxonomyInspectResult,
  type TaxonomyKind,
  type TaxonomyMode,
  type TaxonomyParentPolicy,
} from './contract';

const STEP_KEYS = ['setup', 'preview', 'apply', 'result'] as const;
const ERRORS_COLLAPSED = 5;
const ROWS_COLLAPSED = 10;

/**
 * معالج استيراد التصنيفات أو العلامات التجارية (IMP-H4-S6a) — شاشةٌ واحدة للنوعين؛ النوع يحدّده مدخل الصفحة. الخطوات: ملف وقواعد ومطابقة ← معاينة (بلا كتابة)
 * ← تشغيلة دائمة مربوطة بالمعاينة ← نتيجة مع تنزيل الصفوف الفاشلة وإصلاحها. الخادم مصدر الحقيقة؛ لا إعادة تسمية ولا نقل ولا ربط بالمنتجات ولا أثر محاسبي.
 */
export function ProductTaxonomyImportWizard({ kind }: { kind: TaxonomyKind }) {
  const t = useTranslations('taxonomyImport');
  const tc = useTranslations('common');
  const locale = useLocale();
  const { success, toast } = useToast();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const { setParam } = useImportJobUrlParam();
  const backHref = `/inventory-settings/${kind === 'category' ? 'categories' : 'brands'}`;

  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [mode, setMode] = useState<TaxonomyMode>(DEFAULT_TAXONOMY_IMPORT_OPTIONS.mode);
  const [blankPolicy, setBlankPolicy] = useState<TaxonomyBlankPolicy>(DEFAULT_TAXONOMY_IMPORT_OPTIONS.blankPolicy);
  const [parentPolicy, setParentPolicy] = useState<TaxonomyParentPolicy>(DEFAULT_TAXONOMY_IMPORT_OPTIONS.parentPolicy);
  const [inspection, setInspection] = useState<TaxonomyInspectResult | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [mapping, setMapping] = useState<TaxonomyColumnMapping>({});
  const [preview, setPreview] = useState<TaxonomyImportPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [rowsExpanded, setRowsExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resumedWithoutFile, setResumedWithoutFile] = useState(false);
  // يمنع ردّاً متأخراً لملفٍ/مدخلاتٍ سابقة من الكتابة فوق الأحدث (الفحص والمعاينة).
  const inspectSeq = useRef(0);
  const previewSeq = useRef(0);

  const engine = useImportJobEngine('product_taxonomy');
  useResumeFromUrl((jobId) => {
    setResumedWithoutFile(true);
    void engine.resume(jobId);
  });

  useEffect(() => {
    if (engine.job) {
      setParam(engine.job.id);
      if (step < 2 && engine.job.status !== 'ready') setStep(2);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine.job?.id]);

  const fields = inspection?.fields ?? [];
  const writableFields = useMemo(() => fields.filter((field) => field.writable || field.key === 'nebrax_id'), [fields]);
  const gaps = useMemo(() => taxonomyMappingGaps(mapping, mode), [mapping, mode]);
  const activeMapping = inspection && inspection.columns.length > 0 ? mapping : undefined;
  const mappingReady = !activeMapping || (!gaps.missingName && !gaps.missingIdentifier && !gaps.duplicate);
  // بلا فحص ناجح لا مطابقة ولا حقول: المعاينة ستفشل بالسبب نفسه، فلا تُتاح.
  const canPreview = Boolean(file) && inspection !== null && !inspecting && !previewing && mappingReady;
  const steps = STEP_KEYS.map((key) => ({ key, label: t(`step_${key}`) }));
  // معاينةٌ استُهلك ربطها (تشغيلة انتهت): لا تنفيذ ثانٍ منها — تُعاد المعاينة لتشغيلة جديدة.
  const jobTerminal = engine.job !== null && ['failed', 'completed', 'cancelled'].includes(engine.job.status);
  const wrongDomainJob = resumedWithoutFile && engine.job !== null && engine.job.domain !== 'product_taxonomy';

  function currentOptions(): TaxonomyImportOptions {
    return { kind, mode, blankPolicy, parentPolicy, mapping: activeMapping };
  }

  /** تشغيلةٌ سابقة مجمَّدة الملف والخيارات: أي تغيير يُسقطها كي لا يُنفَّذ ما لم يُعايَن (تبقى على الخادم وتُستأنف برابطها). */
  function dropJob() {
    // أثناء الرفع/التنفيذ لا تُسقَط التشغيلة: `engine.reset()` لا يوقف حلقة التنفيذ الجارية، فتعيد التشغيلة المُسقَطة وتتناقض الشاشة مع ما يُكتب فعلاً.
    if (!engine.job || engine.busy === 'applying' || engine.busy === 'uploading') return;
    engine.reset();
    setParam(null);
    setResumedWithoutFile(false);
  }

  function invalidatePreview() {
    dropJob();
    previewSeq.current += 1;
    setPreviewing(false);
    setPreview(null);
    setExpanded(false);
    setRowsExpanded(false);
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
      form.append('kind', kind);
      const response = await api<{ data: TaxonomyInspectResult }>('/product-taxonomy/import/inspect', { method: 'POST', body: form });
      if (seq !== inspectSeq.current) return;
      setInspection(response.data);
      setMapping(suggestedTaxonomyMapping(response.data.columns));
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
    if (next.size > MAX_TAXONOMY_IMPORT_BYTES) {
      setFile(null);
      setError(t('file_too_large', { limit: Math.round(MAX_TAXONOMY_IMPORT_BYTES / (1024 * 1024)) }));
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

  async function runPreview() {
    if (!file) return;
    dropJob();
    const seq = ++previewSeq.current;
    setPreviewing(true);
    setError(null);
    try {
      const response = await api<{ data: TaxonomyImportPreview }>('/product-taxonomy/import/preview', {
        method: 'POST',
        body: taxonomyImportFormData(file, currentOptions()),
      });
      if (seq !== previewSeq.current) return;
      setPreview(response.data);
      setStep(1);
    } catch (err) {
      if (seq !== previewSeq.current) return;
      setPreview(null);
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      if (seq === previewSeq.current) setPreviewing(false);
    }
  }

  function applyOptionsPayload(): ApplyOptions {
    return { ...taxonomyJobOptions(currentOptions()) } as ApplyOptions;
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
      if ((await downloadFile(`/product-taxonomy/import/template?kind=${kind}`, `nebrax-${kind}-import-template.csv`)) === 'demo-unavailable') {
        toast({ title: t('demo_unavailable'), variant: 'info' });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    }
  }

  function downloadErrors(current: TaxonomyImportPreview) {
    downloadCsv(
      `nebrax-${kind}-import-errors`,
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

  // `apply_result` يحمل قطعة التنفيذ الأخيرة وحدها؛ الإجمالي التراكمي للصفوف المنجزة هو `processed_rows`.
  const applyResult = engine.job?.apply_result as { created?: number; updated?: number; skipped?: number } | null | undefined;
  const processedTotal = engine.job?.processed_rows ?? 0;
  const visibleRows = preview ? (rowsExpanded ? preview.rows : preview.rows.slice(0, ROWS_COLLAPSED)) : [];
  const gapSeparator = locale.startsWith('ar') ? '، ' : ', ';

  return (
    <div className="space-y-4 pb-24 lg:pb-0">
      <header className="flex flex-wrap items-start gap-3">
        <Button asChild variant="ghost" size="icon" aria-label={t('back')}>
          <Link href={backHref}>
            <ArrowRight className="h-4 w-4 rtl:rotate-0 ltr:rotate-180" strokeWidth={1.7} />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold text-text">{t(kind === 'category' ? 'title_category' : 'title_brand')}</h1>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">{t(kind === 'category' ? 'subtitle_category' : 'subtitle_brand')}</p>
        </div>
        <Button type="button" variant="outline" onClick={() => void downloadTemplate()}>
          <Download className="h-4 w-4" strokeWidth={1.7} />
          {t('download_template')}
        </Button>
      </header>

      <Stepper steps={steps} current={step} onSelect={(index) => index <= step && engine.busy !== 'applying' && engine.busy !== 'uploading' && setStep(index)} label={t('step_label')} />

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
              {wrongDomainJob ? <p role="alert" className="text-sm text-negative">{t('resumed_wrong_domain')}</p> : null}
              <FormActions
                primary={
                  <Button disabled={!engine.job.preview_bound || wrongDomainJob} onClick={() => void confirmAndApply()}>
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
                  <p className="mt-1 text-xs text-muted">{t('file_hint', { rows: TAXONOMY_IMPORT_ROW_LIMIT })}</p>
                  <div className="mt-3">
                    <Label htmlFor="taxonomy-import-file" className="sr-only">{t('step_file')}</Label>
                    <Input
                      id="taxonomy-import-file"
                      ref={fileInput}
                      type="file"
                      accept={ACCEPTED_TAXONOMY_IMPORT_TYPES}
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
                <p className="text-xs leading-relaxed text-muted">{t(kind === 'category' ? 'rules_note_category' : 'rules_note_brand')}</p>
                <div className={cn('grid grid-cols-1 gap-4', kind === 'category' ? 'lg:grid-cols-3' : 'lg:grid-cols-2')}>
                  <div className="space-y-1.5">
                    <Label htmlFor="ti-mode">{t('mode')}</Label>
                    <Select id="ti-mode" value={mode} onChange={(event) => { setMode(event.target.value as TaxonomyMode); invalidatePreview(); }}>
                      {TAXONOMY_MODES.map((value) => (
                        <option key={value} value={value}>{t(`mode_${value}`)}</option>
                      ))}
                    </Select>
                    <p className="text-xs leading-relaxed text-muted">{t(`mode_${mode}_hint`)}</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ti-blank">{t('blank_policy')}</Label>
                    <Select id="ti-blank" value={blankPolicy} disabled={mode === 'create'} onChange={(event) => { setBlankPolicy(event.target.value as TaxonomyBlankPolicy); invalidatePreview(); }}>
                      <option value="ignore">{t('blank_ignore')}</option>
                      <option value="clear">{t('blank_clear')}</option>
                    </Select>
                    <p className="text-xs leading-relaxed text-muted">{t(`blank_${blankPolicy}_hint`)}</p>
                  </div>
                  {kind === 'category' ? (
                    <div className="space-y-1.5">
                      <Label htmlFor="ti-parent">{t('parent_policy')}</Label>
                      <Select id="ti-parent" value={parentPolicy} onChange={(event) => { setParentPolicy(event.target.value as TaxonomyParentPolicy); invalidatePreview(); }}>
                        <option value="error">{t('parent_error')}</option>
                        <option value="create_missing">{t('parent_create_missing')}</option>
                      </Select>
                      <p className="text-xs leading-relaxed text-muted">{t(`parent_${parentPolicy}_hint`)}</p>
                    </div>
                  ) : null}
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
                      onClick={() => { setMapping(suggestedTaxonomyMapping(inspection.columns)); invalidatePreview(); }}
                    >
                      {t('mapping_reset')}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {gaps.missingName ? (
                    <p role="alert" className="rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-sm text-negative">{t('mapping_missing_name')}</p>
                  ) : null}
                  {gaps.missingIdentifier ? (
                    <p role="alert" className="rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-sm text-negative">{t('mapping_missing_identifier')}</p>
                  ) : null}
                  {gaps.duplicate ? (
                    <p role="alert" className="rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-sm text-negative">{t('mapping_duplicate')}</p>
                  ) : null}
                  <p className="text-xs leading-relaxed text-muted">{t(kind === 'category' ? 'mapping_note_category' : 'mapping_note_brand')}</p>
                  <div className="overflow-x-auto rounded-md border border-border">
                    <table className="w-full min-w-[40rem] text-sm">
                      <thead className="bg-background text-muted">
                        <tr>
                          <th scope="col" className="px-3 py-2 text-start font-medium">{t('mapping_source')}</th>
                          <th scope="col" className="px-3 py-2 text-start font-medium">{t('mapping_sample')}</th>
                          <th scope="col" className="px-3 py-2 text-start font-medium">{t('mapping_target')}</th>
                          <th scope="col" className="px-3 py-2 text-start font-medium">{t('mapping_state')}</th>
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
                                <Label htmlFor={`ti-map-${column.index}`} className="sr-only">{column.header || t('mapping_column', { n: column.index + 1 })}</Label>
                                <Select id={`ti-map-${column.index}`} value={selected} onChange={(event) => updateMapping(column.index, event.target.value)} className="min-w-44">
                                  <option value="">{t('mapping_ignore')}</option>
                                  {writableFields.map((item) => (
                                    <option key={item.key} value={item.key}>{taxonomyFieldLabel(item, locale)}</option>
                                  ))}
                                </Select>
                              </td>
                              <td className="px-3 py-2">
                                <span className="flex flex-wrap gap-1">
                                  <Badge tone={selected ? 'positive' : 'muted'}>{selected ? t('mapping_mapped') : t('mapping_unmapped')}</Badge>
                                  {field?.required ? <Badge tone="muted">{t('mapping_required')}</Badge> : null}
                                  {field && !field.writable ? <Badge tone="muted">{t('mapping_identifier')}</Badge> : null}
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
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {(
                [
                  ['create', preview.create_rows],
                  ['update', preview.update_rows],
                  ['skip', preview.skipped_rows],
                  ['warning', preview.warning_rows],
                  ['error', preview.error_rows],
                ] as const
              ).map(([key, value]) => (
                <div key={key} className="rounded-md border border-border bg-background px-3 py-2">
                  <dt className="text-xs text-muted">{t(`count_${key}`)}</dt>
                  <dd className={cn('num mt-0.5 text-lg font-semibold', key === 'error' && value > 0 ? 'text-negative' : 'text-text')}>{value}</dd>
                </div>
              ))}
            </dl>
            <p className="text-xs leading-relaxed text-muted">{t('preview_note')}</p>
            {preview.implicit_parents > 0 ? (
              <p role="status" className="text-xs leading-relaxed text-text">{t('implicit_parents', { count: preview.implicit_parents })}</p>
            ) : null}

            {preview.rows.length > 0 ? (
              <>
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full min-w-[32rem] text-sm">
                    <thead className="bg-background text-muted">
                      <tr>
                        <th scope="col" className="px-3 py-2 text-start font-medium">{t('col_row')}</th>
                        <th scope="col" className="px-3 py-2 text-start font-medium">{t(kind === 'category' ? 'col_path' : 'col_name')}</th>
                        <th scope="col" className="px-3 py-2 text-start font-medium">{t('col_action')}</th>
                        <th scope="col" className="px-3 py-2 text-start font-medium">{t('col_status')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRows.map((row) => (
                        <tr key={row.row} className="border-t border-border align-top">
                          <td className="num px-3 py-2 text-muted">{row.row}</td>
                          <td className="px-3 py-2 text-text" dir="auto">
                            {row.path ?? row.name ?? '—'}
                            {row.creates_parents.length > 0 ? (
                              <span className="mt-0.5 block text-xs text-muted" dir="auto">{t('creates_parents', { parents: row.creates_parents.join(gapSeparator) })}</span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2"><Badge tone={row.action === 'error' ? 'negative' : row.action === 'skip' ? 'muted' : 'positive'}>{t(`action_${row.action}`)}</Badge></td>
                          <td className="px-3 py-2">
                            {row.messages.length > 0 ? <p className="text-xs leading-relaxed text-negative">{row.messages.join(' — ')}</p> : null}
                            {row.warnings.length > 0 ? <p className="text-xs leading-relaxed text-warning">{row.warnings.join(' — ')}</p> : null}
                            {row.messages.length === 0 && row.warnings.length === 0 ? <span className="text-xs text-muted">{t('status_ok')}</span> : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {preview.rows.length > ROWS_COLLAPSED ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setRowsExpanded((value) => !value)}>
                    {rowsExpanded ? t('rows_show_less') : t('rows_show_more', { count: preview.rows.length })}
                  </Button>
                ) : null}
              </>
            ) : null}
            {preview.rows_truncated ? <p className="text-xs text-muted">{t('rows_truncated', { shown: preview.rows_shown, total: preview.total_rows })}</p> : null}

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

            {preview.error_rows > 0 ? (
              <p role="alert" className="rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-sm text-negative">{t('fix_errors')}</p>
            ) : null}
            {jobTerminal ? <p role="status" className="text-xs leading-relaxed text-muted">{t('preview_used')}</p> : null}

            <FormActions
              secondary={<Button type="button" variant="outline" onClick={() => setStep(0)}>{t('back_to_setup')}</Button>}
              primary={
                <Button disabled={preview.error_rows > 0 || !preview.binding || previewing || jobTerminal} onClick={() => void confirmAndApply()}>
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
            {engine.job.status === 'processing' && engine.busy === null && engine.job.preview_bound ? (
              <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-background px-3 py-2">
                <p className="text-sm text-muted">{t('continue_hint')}</p>
                <Button type="button" onClick={() => void engine.applyLoop(engine.job!.id, {})}>
                  <Upload className="h-4 w-4" strokeWidth={1.7} />
                  {t('continue_apply')}
                </Button>
              </div>
            ) : null}
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
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-md border border-border bg-background px-3 py-2">
                <dt className="text-xs text-muted">{t('result_processed')}</dt>
                <dd className="num mt-0.5 text-lg font-semibold text-text">{processedTotal}</dd>
              </div>
              {(['created', 'updated', 'skipped'] as const).map((key) => (
                <div key={key} className="rounded-md border border-border bg-background px-3 py-2">
                  <dt className="text-xs text-muted">{t(`result_${key}`)}</dt>
                  <dd className="num mt-0.5 text-lg font-semibold text-text">{applyResult?.[key] ?? 0}</dd>
                </div>
              ))}
            </dl>
            <p className="text-xs leading-relaxed text-muted">{t('result_last_chunk_hint')}</p>
            <FormActions
              secondary={<Button variant="outline" onClick={reset}>{t('start_another')}</Button>}
              primary={
                <Button asChild variant="primary">
                  <Link href={backHref}>{t(kind === 'category' ? 'back_to_categories' : 'back_to_brands')}</Link>
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
