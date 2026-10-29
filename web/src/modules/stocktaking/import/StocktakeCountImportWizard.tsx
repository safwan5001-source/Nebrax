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
import type { ApplyOptions } from '@/modules/import-jobs/client';
import { useImportJobEngine, useImportJobUrlParam, useResumeFromUrl } from '@/modules/import-jobs/useImportJobEngine';
import { MappingPresetBar } from '@/modules/import-jobs/MappingPresetBar';
import {
  ACCEPTED_STOCKTAKE_IMPORT_TYPES,
  MAX_STOCKTAKE_IMPORT_BYTES,
  STOCKTAKE_IMPORT_ROW_LIMIT,
  spreadsheetSafe,
  stocktakeFieldLabel,
  stocktakeImportFormData,
  stocktakeJobOptions,
  stocktakeMappingGaps,
  suggestedStocktakeMapping,
  type ExistingCountPolicy,
  type StocktakeColumnMapping,
  type StocktakeImportOptions,
  type StocktakeImportPreview,
  type StocktakeInspectResult,
} from './contract';

const STEP_KEYS = ['setup', 'preview', 'apply', 'result'] as const;
const ERRORS_COLLAPSED = 5;
const POLICIES: ExistingCountPolicy[] = ['error', 'overwrite', 'skip'];

/**
 * معالج استيراد أعداد ورقة جرد (IMP-H7-S1c). الجرد المستهدف من مسار الصفحة. الخطوات: ملف وسياسة العدّ القائم ومطابقة ← معاينة (بلا كتابة) ← تشغيلة دائمة
 * مربوطة بالمعاينة (ورقة كاملة في معاملة واحدة أو لا شيء) ← نتيجة. **يكتب العدّ فقط**: الترحيل (حركات المخزون والقيد) فعلٌ منفصل من صفحة الجرد.
 */
export function StocktakeCountImportWizard({ stocktakeId }: { stocktakeId: string }) {
  const t = useTranslations('stocktakeImport');
  const tc = useTranslations('common');
  const locale = useLocale();
  const { success, toast } = useToast();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const { setParam } = useImportJobUrlParam();
  const backHref = `/stocktaking/${stocktakeId}`;

  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [policy, setPolicy] = useState<ExistingCountPolicy>('error');
  const [inspection, setInspection] = useState<StocktakeInspectResult | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [mapping, setMapping] = useState<StocktakeColumnMapping>({});
  const [preview, setPreview] = useState<StocktakeImportPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resumedWithoutFile, setResumedWithoutFile] = useState(false);
  // يمنع ردّاً متأخراً لملفٍ/مدخلاتٍ سابقة من الكتابة فوق الأحدث (الفحص والمعاينة).
  const inspectSeq = useRef(0);
  const previewSeq = useRef(0);

  const engine = useImportJobEngine('stocktake_count');
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

  // تشغيلةٌ مستأنفةٌ من الرابط تُطبَّق فقط إن كانت من مجال الجرد ومجمَّدةَ الهدف على هذا الجرد نفسه (الخادم يكشف الهدف لهذا المجال).
  const resumeMismatch = Boolean(resumedWithoutFile && engine.job && (engine.job.domain !== 'stocktake_count' || engine.job.target_id !== stocktakeId));
  const fields = inspection?.fields ?? [];
  const gaps = useMemo(() => stocktakeMappingGaps(mapping), [mapping]);
  const activeMapping = inspection && inspection.columns.length > 0 ? mapping : undefined;
  const mappingReady = !activeMapping || (!gaps.missingIdentifier && !gaps.missingQuantity && !gaps.duplicate);
  const canPreview = Boolean(file) && !inspecting && !previewing && mappingReady;
  const steps = STEP_KEYS.map((key) => ({ key, label: t(`step_${key}`) }));

  function currentOptions(): StocktakeImportOptions {
    return { stocktakeId, existingCountPolicy: policy, mapping: activeMapping };
  }

  /** تشغيلةٌ سابقة مجمَّدة الملف والخيارات: أي تغيير في الملف/السياسة/المطابقة أو معاينةٌ جديدة يُسقطها كي لا يُنفَّذ ما لم يُعايَن (تبقى على الخادم وتُستأنف برابطها). */
  function dropJob() {
    // أثناء الرفع/التنفيذ لا تُسقَط التشغيلة: حلقة التنفيذ ستعيدها وتتناقض الشاشة مع ما يُكتب فعلاً.
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
      form.append('stocktake_id', stocktakeId);
      const response = await api<{ data: StocktakeInspectResult }>('/stocktakes/count-import/inspect', { method: 'POST', body: form });
      if (seq !== inspectSeq.current) return;
      setInspection(response.data);
      setMapping(suggestedStocktakeMapping(response.data.columns));
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
    if (next.size > MAX_STOCKTAKE_IMPORT_BYTES) {
      setFile(null);
      setError(t('file_too_large', { limit: Math.round(MAX_STOCKTAKE_IMPORT_BYTES / (1024 * 1024)) }));
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
      const response = await api<{ data: StocktakeImportPreview }>('/stocktakes/count-import/preview', {
        method: 'POST',
        body: stocktakeImportFormData(file, currentOptions()),
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
    return { ...stocktakeJobOptions(currentOptions()) } as ApplyOptions;
  }

  async function confirmAndApply() {
    setStep(2);
    setError(null);
    if (!engine.job) {
      if (!file) return;
      // مفتاح ثباتٍ مشتق من المعاينة أحادية الاستعمال: إعادة المحاولة بعد انقطاع الشبكة تعيد التشغيلة نفسها بدل أن ترفضها المعاينة المستهلكة.
      const job = await engine.upload(file, preview?.binding ? `stocktake-count-${preview.binding.id}` : undefined, null, preview?.binding ? { binding: preview.binding, options: applyOptionsPayload() } : null);
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

  async function downloadTemplate() {
    try {
      if ((await downloadFile(`/stocktakes/${stocktakeId}/count-import/template`, 'nebrax-stocktake-count-template.csv')) === 'demo-unavailable') {
        toast({ title: t('demo_unavailable'), variant: 'info' });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    }
  }

  function downloadErrors(current: StocktakeImportPreview) {
    downloadCsv(
      'nebrax-stocktake-count-errors',
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

  const applyResult = engine.job?.apply_result as { written?: number; overwritten?: number; unchanged?: number; skipped?: number; uncounted_after?: number } | null | undefined;

  return (
    <div className="space-y-4 pb-24 lg:pb-0">
      <header className="flex flex-wrap items-start gap-3">
        <Button asChild variant="ghost" size="icon" aria-label={t('back')}>
          <Link href={backHref}>
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
              {resumeMismatch ? <p role="alert" className="text-sm text-negative">{t('resumed_other_target')}</p> : null}
              <FormActions
                primary={
                  <Button disabled={!engine.job.preview_bound || resumeMismatch} onClick={() => void confirmAndApply()}>
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
                  <p className="mt-1 text-xs text-muted">{t('file_hint', { rows: STOCKTAKE_IMPORT_ROW_LIMIT })}</p>
                  <div className="mt-3">
                    <Label htmlFor="stocktake-import-file" className="sr-only">{t('step_file')}</Label>
                    <Input
                      id="stocktake-import-file"
                      ref={fileInput}
                      type="file"
                      accept={ACCEPTED_STOCKTAKE_IMPORT_TYPES}
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
                <p className="text-xs leading-relaxed text-muted">{t('rules_counts_only_note')}</p>
                <div className="max-w-md space-y-1.5">
                  <Label htmlFor="si-policy">{t('existing_policy')}</Label>
                  <Select id="si-policy" value={policy} onChange={(event) => { setPolicy(event.target.value as ExistingCountPolicy); invalidatePreview(); }}>
                    {POLICIES.map((value) => (
                      <option key={value} value={value}>{t(`policy_${value}`)}</option>
                    ))}
                  </Select>
                  <p className="text-xs leading-relaxed text-muted">{t(`policy_${policy}_hint`)}</p>
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
                      onClick={() => { setMapping(suggestedStocktakeMapping(inspection.columns)); invalidatePreview(); }}
                    >
                      {t('mapping_reset')}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {gaps.missingIdentifier ? (
                    <p role="alert" className="rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-sm text-negative">{t('mapping_missing_identifier')}</p>
                  ) : null}
                  {gaps.missingQuantity ? (
                    <p role="alert" className="rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-sm text-negative">{t('mapping_missing_quantity')}</p>
                  ) : null}
                  {gaps.duplicate ? (
                    <p role="alert" className="rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-sm text-negative">{t('mapping_duplicate')}</p>
                  ) : null}
                  <MappingPresetBar domain="stocktake_count" columns={inspection.columns} mapping={mapping} fieldKeys={fields.map((item) => item.key)} onApply={(next) => { setMapping(next); invalidatePreview(); }} />
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
                                <Label htmlFor={`si-map-${column.index}`} className="sr-only">{column.header || t('mapping_column', { n: column.index + 1 })}</Label>
                                <Select id={`si-map-${column.index}`} value={selected} onChange={(event) => updateMapping(column.index, event.target.value)} className="min-w-44">
                                  <option value="">{t('mapping_ignore')}</option>
                                  {fields.map((item) => (
                                    <option key={item.key} value={item.key}>{stocktakeFieldLabel(item, locale)}</option>
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
            <CardTitle>{t('step_preview')} — <span className="num" dir="ltr">{preview.stocktake_number}</span></CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {(
                [
                  ['write', preview.to_write],
                  ['overwrite', preview.overwrite_rows],
                  ['unchanged', preview.unchanged_rows],
                  ['skip', preview.skipped_rows],
                  ['error', preview.error_rows],
                  ['uncounted', preview.uncounted_after],
                ] as const
              ).map(([key, value]) => (
                <div key={key} className="rounded-md border border-border bg-background px-3 py-2">
                  <dt className="text-xs text-muted">{t(`count_${key}`)}</dt>
                  <dd className={cn('num mt-0.5 text-lg font-semibold', key === 'error' && value > 0 ? 'text-negative' : 'text-text')}>{value}</dd>
                </div>
              ))}
            </dl>
            <p className="text-xs leading-relaxed text-muted">{t('preview_counts_only_note')}</p>

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

            {preview.uncounted_after > 0 ? (
              <p role="status" className="flex items-start gap-1.5 text-xs leading-relaxed text-warning">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
                {t('uncounted_note', { count: preview.uncounted_after })}
              </p>
            ) : null}
            {preview.rows_truncated ? <p className="text-xs text-muted">{t('rows_truncated', { shown: preview.rows_shown, total: preview.total_rows })}</p> : null}

            {preview.error_rows > 0 ? (
              <p role="alert" className="rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-sm text-negative">{t('fix_errors')}</p>
            ) : null}

            <FormActions
              secondary={<Button type="button" variant="outline" onClick={() => setStep(0)}>{t('back_to_setup')}</Button>}
              primary={
                <Button disabled={preview.error_rows > 0 || !preview.binding} onClick={() => void confirmAndApply()}>
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
            {engine.job.status === 'processing' && engine.busy === null && engine.job.preview_bound && !resumeMismatch ? (
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
              atomic
              networkUncertain={engine.networkUncertain}
              cancelling={engine.busy === 'cancelling'}
              onCancel={engine.job ? () => void engine.cancel(engine.job!.id) : undefined}
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
              {(['written', 'overwritten', 'unchanged', 'skipped'] as const).map((key) => (
                <div key={key} className="rounded-md border border-border bg-background px-3 py-2">
                  <dt className="text-xs text-muted">{t(`result_${key}`)}</dt>
                  <dd className="num mt-0.5 text-lg font-semibold text-text">{applyResult?.[key] ?? 0}</dd>
                </div>
              ))}
            </dl>
            <p className="text-xs leading-relaxed text-muted">{t('result_not_posted_hint')}</p>
            <FormActions
              secondary={<Button variant="outline" onClick={reset}>{t('start_another')}</Button>}
              primary={
                <Button asChild variant="primary">
                  <Link href={backHref}>{t('back_to_stocktake')}</Link>
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
