'use client';

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { FormActions } from '@/components/nebrax';
import { api, ApiError, downloadFile } from '@/lib/api';
import { downloadCsv, toCsv } from '@/lib/export';
import { Stepper } from '@/modules/products/import/stepper';
import {
  ACCEPTED_IMPORT_TYPES,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  type BlankPolicy,
  type ColumnMapping,
  type ImportField,
  type ImportMode,
  type ImportPreview,
  type InspectResult,
  type MasterDataPolicy,
  type PreviewRow,
  fieldLabel,
  importFormData,
  mappingGaps,
  reportRows,
  suggestedMapping,
} from '@/modules/products/import/contract';
import { ImportJobStatusPanel } from '@/modules/import-jobs/ImportJobStatusPanel';
import { useImportJobEngine, useImportJobUrlParam, useResumeFromUrl } from '@/modules/import-jobs/useImportJobEngine';
import type { ApplyOptions } from '@/modules/import-jobs/client';
import { cn } from '@/lib/utils';

// المسار الدائم (PR-DUR-1..2) استبدل حلقة `/products/import/apply` المملوكة
// للمتصفح: الرفع يحدث مرّة واحدة (`POST /import-jobs`)، ثم كل قطعة لاحقة
// تخاطب هوية التشغيلة فقط — لا إعادة رفع، والمؤشّر (`processed_rows`) ملكٌ
// للخادم وحده. سبع خطوات V1 (ملف·وضع·مطابقة·قواعد·معاينة·تطبيق·نتيجة) دُمجت
// إلى أربع: الثلاث الأولى (ملف/وضع/مطابقة/قواعد) قراراتٌ سابقة للالتزام لا
// تستحق شاشةً مستقلة لكل منها؛ المعاينة والتطبيق والنتيجة تبقى منفصلة لأنها
// لحظات فعلية مختلفة (بلا كتابة → كتابة تدريجية دائمة → نتيجة نهائية).
const STEP_KEYS = ['setup', 'preview', 'apply', 'result'] as const;

export default function ProductImportPage() {
  const t = useTranslations('products');
  const tc = useTranslations('common');
  const locale = useLocale();
  const { success, toast } = useToast();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const { setParam } = useImportJobUrlParam();

  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [inspection, setInspection] = useState<InspectResult | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [mode, setMode] = useState<ImportMode>('create');
  const [blankPolicy, setBlankPolicy] = useState<BlankPolicy>('ignore');
  const [masterDataPolicy, setMasterDataPolicy] = useState<MasterDataPolicy>('match_or_error');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resumedWithoutFile, setResumedWithoutFile] = useState(false);

  const engine = useImportJobEngine('product_catalog');
  useResumeFromUrl((jobId) => {
    setResumedWithoutFile(true);
    void engine.resume(jobId);
  });

  // بمجرد وجود هوية تشغيلة (رفعٌ جديد أو استئنافٌ من الرابط) تُحفظ في الرابط
  // فوراً — تحديث الصفحة يستعيدها بلا إعادة رفع.
  useEffect(() => {
    if (engine.job) {
      setParam(engine.job.id);
      if (step < 2 && engine.job.status !== 'ready') setStep(2);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine.job?.id]);

  const steps = STEP_KEYS.map((key) => ({
    key,
    label: t(`import_step_${key}` as 'import_step_setup'),
  }));

  const fields = inspection?.fields ?? [];
  const writableFields = useMemo(() => fields.filter((field) => field.writable || field.key === 'nebrax_id'), [fields]);
  const gaps = useMemo(() => mappingGaps(mapping, fields, mode), [mapping, fields, mode]);
  const mappingReady = !inspection || (gaps.missingRequired.length === 0 && !gaps.missingIdentifier && !gaps.duplicate);
  const canPreview = Boolean(file) && mappingReady;
  const canApplyPreview = Boolean(preview && preview.total_rows > 0 && preview.error_rows === 0);

  function reset() {
    setStep(0);
    setFile(null);
    setInspection(null);
    setMapping({});
    setPreview(null);
    setError(null);
    setResumedWithoutFile(false);
    setParam(null);
    engine.reset();
    if (fileInput.current) fileInput.current.value = '';
  }

  async function acceptFile(next: File | null) {
    setFile(next);
    setInspection(null);
    setMapping({});
    setPreview(null);
    setError(null);
    if (!next) return;

    // فحصٌ محلي قبل الرفع: ملفٌ ضخم لا يستحق رحلةً كاملة إلى الخادم لتعود
    // برفضٍ كان يمكن قوله فوراً. الخادم يبقى هو الحارس.
    if (next.size > MAX_IMPORT_BYTES) {
      setFile(null);
      setError(t('import_file_too_large', { limit: Math.round(MAX_IMPORT_BYTES / (1024 * 1024)) }));
      if (fileInput.current) fileInput.current.value = '';
      return;
    }

    try {
      const response = await api<{ data: InspectResult }>('/products/import/inspect', {
        method: 'POST',
        body: importFormData(next, { forDurable: true }),
      });
      setInspection(response.data);
      setMapping(suggestedMapping(response.data.columns));
    } catch (err) {
      setInspection(null);
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    void acceptFile(event.target.files?.[0] ?? null);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void acceptFile(event.dataTransfer.files?.[0] ?? null);
  }

  async function runPreview() {
    if (!file) return;
    setPreviewing(true);
    setError(null);
    try {
      const response = await api<{ data: ImportPreview }>('/products/import/preview', {
        method: 'POST',
        body: importFormData(file, { mode, blankPolicy, masterDataPolicy, mapping, forDurable: true }),
      });
      setPreview(response.data);
      setStep(1);
    } catch (err) {
      setPreview(null);
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setPreviewing(false);
    }
  }

  function applyOptionsPayload(): ApplyOptions {
    return {
      mode,
      blank_policy: blankPolicy,
      master_data_policy: masterDataPolicy,
      // ملفٌ استُؤنف بلا نسخةٍ محلية منه لا يملك مطابقةً مُختارة — تُترَك
      // فارغة فيطابق الخادم الأعمدة تلقائياً بالاسم (سلوك V1 الافتراضي نفسه).
      ...(file ? { mapping } : {}),
    };
  }

  async function confirmAndApply() {
    setStep(2);
    setError(null);
    if (!engine.job) {
      if (!file) return; // مستأنفٌ بلا ملف يجب أن يملك تشغيلة أصلاً
      const job = await engine.upload(file);
      if (!job) return;
      await engine.applyLoop(job.id, applyOptionsPayload());
      return;
    }
    await engine.applyLoop(engine.job.id, applyOptionsPayload());
  }

  useEffect(() => {
    if (engine.job?.status === 'completed') {
      setStep(3);
      const created = (engine.job.apply_result?.created as number | undefined) ?? 0;
      const updated = (engine.job.apply_result?.updated as number | undefined) ?? 0;
      success(t('import_success', { created, updated }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine.job?.status]);

  async function downloadTemplate() {
    const outcome = await downloadFile('/products/import/template', 'nebrax-products-import-template.csv');
    if (outcome === 'demo-unavailable') {
      toast({ title: t('export_demo_unavailable'), variant: 'info' });
    }
  }

  function downloadReport(rows: PreviewRow[], name: string) {
    downloadCsv(
      name,
      toCsv(
        [t('import_row'), t('sku'), t('name'), t('import_action'), t('import_status'), t('import_messages')],
        reportRows(rows)
      )
    );
  }

  function updateMapping(index: number, value: string) {
    setMapping((current) => ({ ...current, [index]: value === '' ? null : value }));
    setPreview(null);
  }

  const applyResult = engine.job?.apply_result as
    | { created?: number; updated?: number; skipped?: number; results?: PreviewRow[] }
    | null
    | undefined;

  return (
    <div className="space-y-4 pb-24 lg:pb-0">
      <header className="flex flex-wrap items-start gap-3">
        <Button asChild variant="ghost" size="icon" aria-label={t('back')}>
          <Link href="/products">
            <ArrowRight className="h-4 w-4 rtl:rotate-0 ltr:rotate-180" strokeWidth={1.7} />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold text-text">{t('import_title')}</h1>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">{t('import_subtitle')}</p>
        </div>
        <Button variant="outline" onClick={() => void downloadTemplate()}>
          <Download className="h-4 w-4" strokeWidth={1.7} />
          {t('import_template')}
        </Button>
      </header>

      <p className="num text-xs text-muted md:hidden">
        {t('import_step', { current: step + 1, total: steps.length })}
      </p>

      <Stepper steps={steps} current={step} onSelect={(index) => index <= step && setStep(index)} label={t('import_title')} />

      {error ? (
        <p role="alert" className="rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-sm text-negative">
          {error}
        </p>
      ) : null}

      {step === 0 ? (
        resumedWithoutFile && engine.job ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('import_resumed_title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm leading-relaxed text-muted">
                {t('import_resumed_hint', { name: engine.job.original_filename })}
              </p>
              <RulesFields
                mode={mode}
                setMode={(value) => { setMode(value); }}
                blankPolicy={blankPolicy}
                setBlankPolicy={setBlankPolicy}
                masterDataPolicy={masterDataPolicy}
                setMasterDataPolicy={setMasterDataPolicy}
                t={t}
              />
              <p className="text-xs leading-relaxed text-muted">{t('import_resumed_automap_hint')}</p>
              <FormActions
                primary={
                  <Button onClick={() => void confirmAndApply()}>
                    <Upload className="h-4 w-4" strokeWidth={1.7} />
                    {t('import_apply')}
                  </Button>
                }
              />
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Upload className="h-4 w-4 text-primary" strokeWidth={1.7} />
                  {t('import_step_file')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={onDrop}
                  className={cn(
                    'rounded-md border border-dashed p-6 text-center transition-colors',
                    dragging ? 'border-primary bg-primary-soft' : 'border-border bg-background'
                  )}
                >
                  <FileSpreadsheet className="mx-auto h-6 w-6 text-muted" strokeWidth={1.6} />
                  <p className="mt-2 text-sm text-muted">{t('import_drop_hint')}</p>
                  <p className="mt-1 text-xs text-muted">{t('import_step_file_hint', { rows: MAX_IMPORT_ROWS })}</p>
                  <div className="mt-3">
                    <Label htmlFor="import-file" className="sr-only">
                      {t('import_file')}
                    </Label>
                    <Input
                      id="import-file"
                      ref={fileInput}
                      type="file"
                      accept={ACCEPTED_IMPORT_TYPES}
                      onChange={onFileChange}
                      className="mx-auto max-w-sm"
                    />
                  </div>
                </div>

                {file ? (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-background px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate text-text" dir="ltr" title={file.name}>
                      {file.name}
                    </span>
                    <span className="num shrink-0 text-xs text-muted">
                      {t('import_file_size', { size: Math.max(1, Math.round(file.size / 1024)) })}
                    </span>
                    {!inspection ? (
                      <span className="flex shrink-0 items-center gap-1 text-xs text-muted">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.7} />
                        {t('import_inspecting')}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </CardContent>
            </Card>

            {inspection ? (
              <Card>
                <CardHeader>
                  <CardTitle>{t('import_step_mode')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <RulesFields
                    mode={mode}
                    setMode={(value) => { setMode(value); setPreview(null); }}
                    blankPolicy={blankPolicy}
                    setBlankPolicy={(value) => { setBlankPolicy(value); setPreview(null); }}
                    masterDataPolicy={masterDataPolicy}
                    setMasterDataPolicy={(value) => { setMasterDataPolicy(value); setPreview(null); }}
                    t={t}
                  />
                </CardContent>
              </Card>
            ) : null}

            {inspection ? (
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle>{t('import_step_mapping')}</CardTitle>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="ms-auto"
                      onClick={() => setMapping(suggestedMapping(inspection.columns))}
                    >
                      {t('import_mapping_reset')}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {gaps.missingRequired.length > 0 ? (
                    <p role="alert" className="rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-sm text-negative">
                      {t('import_mapping_missing_required', {
                        fields: gaps.missingRequired.map((field) => fieldLabel(field, locale)).join('، '),
                      })}
                    </p>
                  ) : null}
                  {gaps.missingIdentifier ? (
                    <p role="alert" className="rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-sm text-negative">
                      {t('import_mapping_missing_identifier')}
                    </p>
                  ) : null}
                  {gaps.duplicate ? (
                    <p role="alert" className="rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-sm text-negative">
                      {t('import_mapping_duplicate')}
                    </p>
                  ) : null}

                  <div className="overflow-x-auto rounded-md border border-border">
                    <table className="w-full min-w-[40rem] text-sm">
                      <thead className="bg-background text-muted">
                        <tr>
                          <th className="px-3 py-2 text-start font-medium">{t('import_mapping_source')}</th>
                          <th className="px-3 py-2 text-start font-medium">{t('import_mapping_sample')}</th>
                          <th className="px-3 py-2 text-start font-medium">{t('import_mapping_target')}</th>
                          <th className="px-3 py-2 text-start font-medium">{t('import_mapping_state')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {inspection.columns.map((column) => {
                          const selected = mapping[column.index] ?? '';
                          const field = fields.find((item) => item.key === selected);
                          return (
                            <tr key={column.index} className="border-t border-border align-top">
                              <td className="max-w-48 px-3 py-2">
                                <span className="block truncate font-medium text-text" title={column.header}>
                                  {column.header || '—'}
                                </span>
                              </td>
                              <td className="max-w-48 px-3 py-2">
                                <span className="block truncate text-xs text-muted" title={column.samples.join(' · ')}>
                                  {column.samples.filter(Boolean).slice(0, 2).join(' · ') || '—'}
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                <Label htmlFor={`map-${column.index}`} className="sr-only">
                                  {column.header}
                                </Label>
                                <Select
                                  id={`map-${column.index}`}
                                  value={selected}
                                  onChange={(event) => updateMapping(column.index, event.target.value)}
                                  className="min-w-44"
                                >
                                  <option value="">{t('import_mapping_ignore')}</option>
                                  {writableFields.map((item) => (
                                    <option key={item.key} value={item.key}>
                                      {fieldLabel(item, locale)}
                                    </option>
                                  ))}
                                </Select>
                              </td>
                              <td className="px-3 py-2">
                                <span className="flex flex-wrap gap-1">
                                  <Badge tone={selected ? 'positive' : 'muted'}>
                                    {selected ? t('import_mapping_mapped') : t('import_mapping_unmapped')}
                                  </Badge>
                                  {field?.required ? <Badge tone="muted">{t('import_mapping_required')}</Badge> : null}
                                  {field?.update_locked && field.writable ? (
                                    <Badge tone="muted">{t('import_mapping_locked')}</Badge>
                                  ) : null}
                                  {field && !field.writable ? (
                                    <Badge tone="muted">{t('import_mapping_identifier')}</Badge>
                                  ) : null}
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

            <ol className="space-y-2 rounded-md border border-border bg-surface p-4 text-sm text-muted">
              {[1, 2, 3, 4, 5].map((index) => (
                <li key={index}>
                  <span className="num font-medium text-text">{index}. </span>
                  {t(`import_help_${index}` as 'import_help_1')}
                </li>
              ))}
            </ol>

            <FormActions
              primary={
                <Button disabled={!canPreview} onClick={() => void runPreview()}>
                  {previewing ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.7} /> : <CheckCircle2 className="h-4 w-4" strokeWidth={1.7} />}
                  {t('import_run_preview')}
                </Button>
              }
            />
          </div>
        )
      ) : null}

      {step === 1 && preview ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('import_step_preview')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {(
                [
                  ['total', preview.total_rows, 'text-text'],
                  ['create', preview.create_rows, 'text-text'],
                  ['update', preview.update_rows, 'text-text'],
                  ['skip', preview.skipped_rows, 'text-muted'],
                  ['warning', preview.warning_rows, 'text-warning'],
                  ['error', preview.error_rows, 'text-negative'],
                ] as const
              ).map(([key, value, tone]) => (
                <div key={key} className="rounded-md border border-border bg-background px-3 py-2">
                  <dt className="text-xs text-muted">{t(`import_kpi_${key}` as 'import_kpi_total')}</dt>
                  <dd className={cn('num mt-0.5 text-lg font-semibold', tone)}>{value}</dd>
                </div>
              ))}
            </dl>

            {preview.errors.length > 0 ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  downloadReport(preview.rows.filter((row) => row.status === 'error'), 'nebrax-products-import-errors')
                }
              >
                <Download className="h-3.5 w-3.5" strokeWidth={1.7} />
                {t('import_download_errors')}
              </Button>
            ) : null}

            {preview.rows_truncated ? (
              <p className="rounded-md border border-border bg-background px-3 py-2 text-xs text-muted">
                {t('import_rows_truncated', { shown: preview.rows_shown, total: preview.total_rows })}
              </p>
            ) : null}

            {preview.total_rows === 0 ? (
              <p className="text-sm text-muted">{t('import_no_rows')}</p>
            ) : (
              <PreviewTable rows={preview.rows} />
            )}

            {!canApplyPreview ? (
              <p role="alert" className="rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-sm text-negative">
                {t('import_fix_errors')}
              </p>
            ) : null}

            <p className="text-xs leading-relaxed text-muted">{t('import_confirm_revalidate')}</p>

            <FormActions
              secondary={
                <Button type="button" variant="outline" onClick={() => setStep(0)}>
                  {t('import_back')}
                </Button>
              }
              primary={
                <Button disabled={!canApplyPreview} onClick={() => void confirmAndApply()}>
                  <Upload className="h-4 w-4" strokeWidth={1.7} />
                  {t('import_apply')}
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : null}

      {step === 2 && engine.job ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('import_step_apply')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ImportJobStatusPanel
              job={engine.job}
              atomic={false}
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
              {t('import_result_title')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid grid-cols-3 gap-2">
              {(
                [
                  ['created', applyResult?.created ?? 0],
                  ['updated', applyResult?.updated ?? 0],
                  ['skipped', applyResult?.skipped ?? 0],
                ] as const
              ).map(([key, value]) => (
                <div key={key} className="rounded-md border border-border bg-background px-3 py-2">
                  <dt className="text-xs text-muted">{t(`import_result_${key}` as 'import_result_created')}</dt>
                  <dd className="num mt-0.5 text-lg font-semibold text-text">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="text-xs leading-relaxed text-muted">{t('import_result_last_chunk_hint')}</p>

            <FormActions
              secondary={
                <>
                  <Button variant="outline" onClick={reset}>
                    {t('import_start_another')}
                  </Button>
                  {applyResult?.results ? (
                    <Button variant="ghost" onClick={() => downloadReport(applyResult.results ?? [], 'nebrax-products-import-result')}>
                      <Download className="h-4 w-4" strokeWidth={1.7} />
                      {t('import_download_result')}
                    </Button>
                  ) : null}
                </>
              }
              primary={
                <Button asChild variant="primary">
                  <Link href="/products">{t('import_back_to_products')}</Link>
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function RulesFields({
  mode,
  setMode,
  blankPolicy,
  setBlankPolicy,
  masterDataPolicy,
  setMasterDataPolicy,
  t,
}: {
  mode: ImportMode;
  setMode: (value: ImportMode) => void;
  blankPolicy: BlankPolicy;
  setBlankPolicy: (value: BlankPolicy) => void;
  masterDataPolicy: MasterDataPolicy;
  setMasterDataPolicy: (value: MasterDataPolicy) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium text-text">{t('import_mode')}</legend>
        {(['create', 'update', 'upsert'] as ImportMode[]).map((value) => (
          <label
            key={value}
            className={cn(
              'flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors',
              mode === value ? 'border-primary bg-primary-soft' : 'border-border hover:bg-background'
            )}
          >
            <input
              type="radio"
              name="import-mode"
              value={value}
              checked={mode === value}
              aria-label={t(`import_mode_${value}` as 'import_mode_create')}
              aria-describedby={`import-mode-${value}-hint`}
              onChange={() => setMode(value)}
              className="mt-0.5 h-4 w-4 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-text">{t(`import_mode_${value}` as 'import_mode_create')}</span>
              <span id={`import-mode-${value}-hint`} className="mt-0.5 block text-xs leading-relaxed text-muted">
                {t(`import_mode_${value}_hint` as 'import_mode_create_hint')}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="blank-policy">{t('import_blank_policy')}</Label>
          <Select
            id="blank-policy"
            value={blankPolicy}
            disabled={mode === 'create'}
            onChange={(event) => setBlankPolicy(event.target.value as BlankPolicy)}
          >
            <option value="ignore">{t('import_blank_ignore')}</option>
            <option value="clear">{t('import_blank_clear')}</option>
          </Select>
          <p className="text-xs leading-relaxed text-muted">
            {t(blankPolicy === 'clear' ? 'import_blank_clear_hint' : 'import_blank_ignore_hint')}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="master-data-policy">{t('import_master_data_policy')}</Label>
          <Select
            id="master-data-policy"
            value={masterDataPolicy}
            onChange={(event) => setMasterDataPolicy(event.target.value as MasterDataPolicy)}
          >
            <option value="match_or_error">{t('import_master_data_error')}</option>
            <option value="match_or_text">{t('import_master_data_text')}</option>
            <option value="create_missing">{t('import_master_data_create')}</option>
          </Select>
          <p className="text-xs leading-relaxed text-muted">
            {t(`import_master_data_${masterDataPolicy === 'match_or_error' ? 'error' : masterDataPolicy === 'match_or_text' ? 'text' : 'create'}_hint` as 'import_master_data_error_hint')}
          </p>
        </div>
      </div>
    </div>
  );
}

function PreviewTable({ rows }: { rows: PreviewRow[] }) {
  const t = useTranslations('products');

  const actionLabel = (row: PreviewRow): string =>
    row.action === 'update'
      ? t('import_update_action')
      : row.action === 'skip'
        ? t('import_skip_action')
        : row.action === 'error'
          ? t('import_status_error')
          : t('import_create_action');

  return (
    <>
      <div className="hidden overflow-x-auto rounded-md border border-border md:block">
        <table className="w-full min-w-[44rem] text-sm">
          <thead className="bg-background text-muted">
            <tr>
              <th className="px-3 py-2 text-start font-medium">{t('import_row')}</th>
              <th className="px-3 py-2 text-start font-medium">{t('sku')}</th>
              <th className="px-3 py-2 text-start font-medium">{t('name')}</th>
              <th className="px-3 py-2 text-start font-medium">{t('import_action')}</th>
              <th className="px-3 py-2 text-start font-medium">{t('import_status')}</th>
              <th className="px-3 py-2 text-start font-medium">{t('import_messages')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.row} className="border-t border-border align-top">
                <td className="num px-3 py-2 text-muted">{row.row}</td>
                <td className="num px-3 py-2 text-muted" dir="ltr">{row.sku ?? '—'}</td>
                <td className="max-w-56 truncate px-3 py-2 text-text" title={row.name ?? undefined}>
                  {row.name ?? '—'}
                </td>
                <td className="px-3 py-2 text-muted">{actionLabel(row)}</td>
                <td className="px-3 py-2">
                  <StatusBadge status={row.status} />
                </td>
                <td className={cn('px-3 py-2', row.status === 'error' ? 'text-negative' : 'text-muted')}>
                  {row.messages.join(' — ') || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-border rounded-md border border-border md:hidden">
        {rows.map((row) => (
          <li key={row.row} className="space-y-1 p-3">
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">{row.name ?? '—'}</span>
              <StatusBadge status={row.status} />
            </div>
            <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted">
              <span className="num">
                {t('import_row')} {row.row}
              </span>
              <span className="num" dir="ltr">{row.sku ?? '—'}</span>
              <span>{actionLabel(row)}</span>
            </div>
            {row.messages.length > 0 ? (
              <p className={cn('text-xs leading-relaxed', row.status === 'error' ? 'text-negative' : 'text-muted')}>
                {row.messages.join(' — ')}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}

function StatusBadge({ status }: { status: PreviewRow['status'] }) {
  const t = useTranslations('products');

  if (status === 'error') {
    return (
      <Badge tone="negative">
        <AlertTriangle className="h-3 w-3" strokeWidth={1.8} />
        {t('import_status_error')}
      </Badge>
    );
  }
  if (status === 'warning') {
    return (
      <Badge tone="warning">
        <AlertTriangle className="h-3 w-3" strokeWidth={1.8} />
        {t('import_status_warning')}
      </Badge>
    );
  }

  return <Badge tone="positive">{t('import_status_ok')}</Badge>;
}
