'use client';

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { FormActions } from '@/components/nebrax';
import { api, ApiError, downloadFile } from '@/lib/api';
import { downloadCsv, toCsv } from '@/lib/export';
import { formatRiyal } from '@/lib/money';
import { cn } from '@/lib/utils';
import { Stepper } from '@/modules/products/import/stepper';
import {
  ACCEPTED_IMPORT_TYPES,
  COUNTER_KEYS,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  type ColumnMapping,
  type InspectResult,
  type OpeningField,
  type PreviewResult,
  type PreviewRow,
  fieldLabel,
  importFormData,
  issueReportRows,
  mappingGaps,
  mappingReady as isMappingReady,
  suggestedMapping,
} from '@/modules/inventory-openings/contract';
import { ImportJobStatusPanel } from '@/modules/import-jobs/ImportJobStatusPanel';
import { useImportJobEngine, useImportJobUrlParam, useResumeFromUrl } from '@/modules/import-jobs/useImportJobEngine';
import type { ApplyOptions } from '@/modules/import-jobs/client';

// دُمجت خمس خطوات V1 (ملف·مطابقة·معاينة·تأكيد·نتيجة) إلى أربع: الملف
// وإعدادات المستند ومطابقة الأعمدة قراراتٌ سابقة للالتزام تُعرض معاً؛
// المعاينة والتطبيق والنتيجة منفصلة لأنها لحظات فعلية مختلفة. الرفع يحدث
// مرّة واحدة عند التأكيد (`POST /import-jobs`)، والتطبيق ذرّيٌّ (PR-DUR-4):
// **مسودة فقط، لا ترحيل** — لا فرقٌ في ذلك عن V1، والتذكير هنا صريحٌ كسابقه.
const STEP_KEYS = ['setup', 'preview', 'apply', 'result'] as const;

/** اليوم بصيغة YYYY-MM-DD بلا انزلاق منطقة زمنية. */
function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export default function InventoryOpeningImportPage() {
  const t = useTranslations('inventoryOpenings');
  const tc = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const { setParam } = useImportJobUrlParam();

  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [openingDate, setOpeningDate] = useState(today());
  const [allowZeroCost, setAllowZeroCost] = useState(false);
  const [notes, setNotes] = useState('');
  const [inspection, setInspection] = useState<InspectResult | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resumedWithoutFile, setResumedWithoutFile] = useState(false);

  const engine = useImportJobEngine('inventory_opening');
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

  const steps = STEP_KEYS.map((key) => ({ key, label: t(`step_${key}` as 'step_setup') }));
  const fields: OpeningField[] = inspection?.fields ?? [];
  const gaps = useMemo(() => mappingGaps(mapping, fields), [mapping, fields]);
  const mappingReady = !inspection || isMappingReady(mapping, fields);
  const canPreview = Boolean(file) && Boolean(openingDate) && mappingReady;
  const canApplyPreview = Boolean(preview && preview.counters.total_rows > 0 && preview.counters.error_rows === 0);

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

    if (next.size > MAX_IMPORT_BYTES) {
      setFile(null);
      setError(t('file_too_large', { limit: Math.round(MAX_IMPORT_BYTES / (1024 * 1024)) }));
      if (fileInput.current) fileInput.current.value = '';
      return;
    }

    try {
      const response = await api<{ data: InspectResult }>('/inventory-openings/import/inspect', {
        method: 'POST',
        body: importFormData(next),
      });
      setInspection(response.data);
      setMapping(suggestedMapping(response.data.columns));
    } catch (err) {
      setInspection(null);
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    }
  }

  async function runPreview() {
    if (!file) return;
    setPreviewing(true);
    setError(null);
    try {
      const response = await api<{ data: PreviewResult }>('/inventory-openings/import/preview', {
        method: 'POST',
        body: importFormData(file, { openingDate, allowZeroCost, notes, mapping }),
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
      opening_date: openingDate,
      allow_zero_cost: allowZeroCost,
      notes: notes || undefined,
      ...(file ? { mapping } : {}),
    };
  }

  async function confirmAndApply() {
    setStep(2);
    setError(null);
    if (!engine.job) {
      if (!file) return;
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
    }
  }, [engine.job?.status]);

  async function downloadTemplate() {
    const outcome = await downloadFile('/inventory-openings/import/template', 'nebrax-inventory-opening-template.csv');
    if (outcome === 'demo-unavailable') {
      toast({ title: t('export_demo_unavailable'), variant: 'info' });
    }
  }

  function downloadIssues(rows: PreviewRow[]) {
    downloadCsv(
      'inventory-opening-issues',
      toCsv(
        [t('col_row'), t('col_sku'), t('col_warehouse'), t('issue_code'), t('issue_field'), t('issue_reason')],
        issueReportRows(rows)
      )
    );
  }

  function updateMapping(index: number, value: string) {
    setMapping((current) => ({ ...current, [index]: value === '' ? null : value }));
    setPreview(null);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void acceptFile(event.dataTransfer.files?.[0] ?? null);
  }

  const applyResult = engine.job?.apply_result as
    | { inventory_opening_id?: string; number?: string; total_quantity?: number; total_value?: number; lines_count?: number }
    | null
    | undefined;

  return (
    <div className="space-y-4 pb-24 lg:pb-0">
      <header className="flex flex-wrap items-start gap-3">
        <Button asChild variant="ghost" size="icon" aria-label={t('back')}>
          <Link href="/inventory-openings">
            <ArrowRight className="h-4 w-4 rtl:rotate-0 ltr:rotate-180" strokeWidth={1.7} />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold text-text">{t('import_title')}</h1>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">{t('import_subtitle')}</p>
        </div>
        <Button variant="outline" onClick={() => void downloadTemplate()}>
          <Download className="h-4 w-4" strokeWidth={1.7} />
          {t('download_template')}
        </Button>
      </header>

      <p className="num text-xs text-muted md:hidden">
        {t('step_of', { current: step + 1, total: steps.length })}
      </p>
      <Stepper steps={steps} current={step} onSelect={(index) => index <= step && setStep(index)} label={t('steps_label')} />

      {error ? (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-negative/40 bg-negative/5 p-3 text-sm text-negative">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.7} />
          <span className="leading-relaxed">{error}</span>
        </div>
      ) : null}

      {step === 0 ? (
        resumedWithoutFile && engine.job ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('resumed_title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm leading-relaxed text-muted">
                {t('resumed_hint', { name: engine.job.original_filename })}
              </p>
              <DocumentSettingsFields
                openingDate={openingDate}
                setOpeningDate={setOpeningDate}
                notes={notes}
                setNotes={setNotes}
                allowZeroCost={allowZeroCost}
                setAllowZeroCost={setAllowZeroCost}
                t={t}
              />
              <p className="text-xs leading-relaxed text-muted">{t('resumed_automap_hint')}</p>
              <FormActions
                primary={
                  <Button disabled={!openingDate} onClick={() => void confirmAndApply()}>
                    <Upload className="h-4 w-4" strokeWidth={1.7} />
                    {t('create_draft')}
                  </Button>
                }
              />
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>{t('step_file')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={onDrop}
                  className={cn(
                    'flex flex-col items-center gap-2 rounded-md border border-dashed p-6 text-center transition-colors',
                    dragging ? 'border-primary bg-primary-soft' : 'border-border'
                  )}
                >
                  <Upload className="h-5 w-5 text-muted" strokeWidth={1.7} />
                  <p className="text-sm text-text">{t('drop_hint')}</p>
                  <p className="text-xs leading-relaxed text-muted">
                    {t('file_limits', { rows: MAX_IMPORT_ROWS, mb: Math.round(MAX_IMPORT_BYTES / (1024 * 1024)) })}
                  </p>
                  <input
                    ref={fileInput}
                    id="opening-file"
                    type="file"
                    accept={ACCEPTED_IMPORT_TYPES}
                    aria-label={t('choose_file')}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => void acceptFile(event.target.files?.[0] ?? null)}
                    className="block w-full text-sm text-muted file:me-3 file:rounded file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-sm file:text-text"
                  />
                </div>

                {file && !inspection ? (
                  <p className="flex items-center gap-2 text-sm text-muted">
                    <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.7} />
                    {t('inspecting')}
                  </p>
                ) : null}

                {file && inspection ? (
                  <p className="flex items-center gap-2 text-sm text-text">
                    <FileSpreadsheet className="h-4 w-4 text-primary" strokeWidth={1.7} />
                    <span className="truncate">{file.name}</span>
                    <span className="num text-muted">{t('rows_found', { count: inspection.total_rows })}</span>
                  </p>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('document_settings')}</CardTitle>
              </CardHeader>
              <CardContent>
                <DocumentSettingsFields
                  openingDate={openingDate}
                  setOpeningDate={(value) => { setOpeningDate(value); setPreview(null); }}
                  notes={notes}
                  setNotes={setNotes}
                  allowZeroCost={allowZeroCost}
                  setAllowZeroCost={(value) => { setAllowZeroCost(value); setPreview(null); }}
                  t={t}
                />
              </CardContent>
            </Card>

            {inspection ? (
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>{t('step_mapping')}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm leading-relaxed text-muted">{t('mapping_hint')}</p>

                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[36rem] border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-border text-start text-xs text-muted">
                          <th className="p-2 text-start font-medium">{t('mapping_source')}</th>
                          <th className="p-2 text-start font-medium">{t('mapping_samples')}</th>
                          <th className="p-2 text-start font-medium">{t('mapping_target')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {inspection.columns.map((column) => (
                          <tr key={column.index} className="border-b border-border/60">
                            <td className="p-2 align-top text-text">{column.header || '—'}</td>
                            <td className="p-2 align-top text-xs text-muted">
                              {column.samples.length ? column.samples.slice(0, 3).join(' · ') : '—'}
                            </td>
                            <td className="p-2 align-top">
                              <Select
                                value={mapping[column.index] ?? ''}
                                aria-label={t('mapping_target_for', { column: column.header || String(column.index + 1) })}
                                onChange={(event) => updateMapping(column.index, event.target.value)}
                              >
                                <option value="">{t('mapping_ignore')}</option>
                                {fields.map((field) => (
                                  <option key={field.key} value={field.key}>
                                    {fieldLabel(field, locale)}
                                    {field.required ? ' *' : ''}
                                  </option>
                                ))}
                              </Select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {!mappingReady ? (
                    <ul className="space-y-1 text-sm text-negative">
                      {gaps.duplicate ? <li>{t('mapping_duplicate')}</li> : null}
                      {gaps.missingProduct ? <li>{t('mapping_missing_product')}</li> : null}
                      {gaps.missingWarehouse ? <li>{t('mapping_missing_warehouse')}</li> : null}
                      {gaps.missingRequired.map((field) => (
                        <li key={field.key}>{t('mapping_missing_required', { field: fieldLabel(field, locale) })}</li>
                      ))}
                    </ul>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}

            <div className="lg:col-span-2">
              <FormActions
                primary={
                  <Button disabled={!canPreview} onClick={() => void runPreview()}>
                    {previewing ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.7} /> : null}
                    {t('run_preview')}
                  </Button>
                }
              />
            </div>
          </div>
        )
      ) : null}

      {step === 1 && preview ? (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t('step_preview')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {COUNTER_KEYS.map((key) => (
                  <div key={key} className="rounded-md border border-border p-3">
                    <dt className="text-xs leading-relaxed text-muted">{t(`counter_${key}` as 'counter_valid_rows')}</dt>
                    <dd
                      className={cn(
                        'num mt-1 text-lg font-semibold',
                        key === 'valid_rows' ? 'text-positive' : preview.counters[key] > 0 ? 'text-negative' : 'text-text'
                      )}
                    >
                      {preview.counters[key]}
                    </dd>
                  </div>
                ))}
              </dl>

              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-md border border-border p-3">
                  <dt className="text-xs text-muted">{t('counter_total_quantity')}</dt>
                  <dd className="num mt-1 text-lg font-semibold text-text">{preview.counters.total_quantity}</dd>
                </div>
                <div className="rounded-md border border-border p-3">
                  <dt className="text-xs text-muted">{t('counter_total_value')}</dt>
                  <dd className="num mt-1 text-lg font-semibold text-text">{formatRiyal(preview.counters.total_value)}</dd>
                </div>
              </dl>

              {preview.counters.error_rows > 0 ? (
                <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-negative/40 bg-negative/5 p-3 text-sm text-negative">
                  <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={1.7} />
                  <span className="leading-relaxed">{t('blocking_errors', { count: preview.counters.error_rows })}</span>
                  <Button variant="outline" size="sm" onClick={() => downloadIssues(preview.rows)}>
                    <Download className="h-4 w-4" strokeWidth={1.7} />
                    {t('download_issues')}
                  </Button>
                </div>
              ) : (
                <p className="flex items-center gap-2 text-sm text-positive">
                  <CheckCircle2 className="h-4 w-4" strokeWidth={1.7} />
                  {t('no_blocking_errors')}
                </p>
              )}

              {preview.rows_truncated ? (
                <p className="text-xs text-muted">{t('rows_truncated', { shown: preview.rows_shown })}</p>
              ) : null}
            </CardContent>
          </Card>

          <div className="hidden overflow-x-auto rounded border border-border md:block">
            <table className="w-full min-w-[52rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-background text-xs text-muted">
                  <th className="p-2 text-start font-medium">{t('col_row')}</th>
                  <th className="p-2 text-start font-medium">{t('col_status')}</th>
                  <th className="p-2 text-start font-medium">{t('col_sku')}</th>
                  <th className="p-2 text-start font-medium">{t('col_product')}</th>
                  <th className="p-2 text-start font-medium">{t('col_warehouse')}</th>
                  <th className="p-2 text-end font-medium">{t('col_quantity')}</th>
                  <th className="p-2 text-end font-medium">{t('col_unit_cost')}</th>
                  <th className="p-2 text-end font-medium">{t('col_total')}</th>
                  <th className="p-2 text-start font-medium">{t('col_reason')}</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.row} className="border-b border-border/60 align-top">
                    <td className="num p-2 text-muted">{row.row}</td>
                    <td className="p-2">
                      <Badge tone={row.status === 'valid' ? 'positive' : 'negative'}>{t(row.status)}</Badge>
                    </td>
                    <td className="num p-2 text-text">{row.sku ?? '—'}</td>
                    <td className="p-2 text-text">{row.product_name ?? '—'}</td>
                    <td className="p-2 text-text">{row.warehouse ?? '—'}</td>
                    <td className="num p-2 text-end text-text">{row.quantity ?? '—'}</td>
                    <td className="num p-2 text-end text-text">{row.unit_cost ? formatRiyal(row.unit_cost) : '—'}</td>
                    <td className="num p-2 text-end text-text">{row.total_cost ? formatRiyal(row.total_cost) : '—'}</td>
                    <td className="p-2 text-xs leading-relaxed text-negative">
                      {row.issues.map((issue) => issue.message).join(' — ') || ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="space-y-2 md:hidden">
            {preview.rows.map((row) => (
              <li key={row.row} className="rounded border border-border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="num text-xs text-muted">{t('col_row')} {row.row}</p>
                    <p className="truncate text-sm font-medium text-text">{row.product_name ?? row.sku ?? '—'}</p>
                    <p className="truncate text-xs text-muted">{row.warehouse ?? '—'}</p>
                  </div>
                  <Badge tone={row.status === 'valid' ? 'positive' : 'negative'}>{t(row.status)}</Badge>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <dt className="text-muted">{t('col_quantity')}</dt>
                    <dd className="num text-text">{row.quantity ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">{t('col_total')}</dt>
                    <dd className="num text-text">{row.total_cost ? formatRiyal(row.total_cost) : '—'}</dd>
                  </div>
                </dl>
                {row.issues.length ? (
                  <p className="mt-2 text-xs leading-relaxed text-negative">
                    {row.issues.map((issue) => issue.message).join(' — ')}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>

          {!canApplyPreview ? <p className="text-sm text-negative">{t('confirm_blocked')}</p> : null}

          <FormActions
            secondary={
              <Button variant="outline" onClick={() => setStep(0)}>
                {t('previous')}
              </Button>
            }
            primary={
              <Button disabled={!canApplyPreview} onClick={() => void confirmAndApply()}>
                <Upload className="h-4 w-4" strokeWidth={1.7} />
                {t('create_draft')}
              </Button>
            }
          />
        </div>
      ) : null}

      {step === 2 && engine.job ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('step_apply')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* ذرّيٌّ (PR-DUR-4): لا شريط تقدّم مزيَّف — قطعةٌ واحدة تُنجز المستند
                كله أو تفشله كله. */}
            <ImportJobStatusPanel job={engine.job} atomic networkUncertain={engine.networkUncertain} />
            <p className="text-xs leading-relaxed text-muted">{t('draft_only_reminder')}</p>
          </CardContent>
        </Card>
      ) : null}

      {step === 3 && engine.job?.status === 'completed' ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('step_result')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="flex items-center gap-2 text-sm text-positive">
              <CheckCircle2 className="h-4 w-4" strokeWidth={1.7} />
              {t('draft_created', { number: applyResult?.number ?? '' })}
            </p>
            <p className="text-sm leading-relaxed text-muted">{t('draft_next_step')}</p>
            <FormActions
              secondary={
                <Button variant="outline" onClick={reset}>
                  {t('import_another')}
                </Button>
              }
              primary={
                <Button
                  disabled={!applyResult?.inventory_opening_id}
                  onClick={() => applyResult?.inventory_opening_id && router.push(`/inventory-openings/${applyResult.inventory_opening_id}`)}
                >
                  {t('open_draft')}
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function DocumentSettingsFields({
  openingDate,
  setOpeningDate,
  notes,
  setNotes,
  allowZeroCost,
  setAllowZeroCost,
  t,
}: {
  openingDate: string;
  setOpeningDate: (value: string) => void;
  notes: string;
  setNotes: (value: string) => void;
  allowZeroCost: boolean;
  setAllowZeroCost: (value: boolean) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="opening-date">{t('opening_date')}</Label>
        <Input
          id="opening-date"
          type="date"
          value={openingDate}
          onChange={(event) => setOpeningDate(event.target.value)}
        />
        <p className="text-xs leading-relaxed text-muted">{t('opening_date_hint')}</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="opening-notes">{t('notes')}</Label>
        <Textarea id="opening-notes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={500} />
      </div>

      <div className="flex items-start justify-between gap-3 rounded-md border border-border p-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text">{t('allow_zero_cost')}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">{t('allow_zero_cost_hint')}</p>
        </div>
        <Switch checked={allowZeroCost} onCheckedChange={setAllowZeroCost} aria-label={t('allow_zero_cost')} />
      </div>
    </div>
  );
}
