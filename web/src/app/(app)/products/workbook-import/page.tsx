'use client';

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, ArrowRight, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload } from 'lucide-react';
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
import { cn } from '@/lib/utils';
import { Stepper } from '@/modules/products/import/stepper';
import {
  fieldLabel,
  mappingGaps,
  suggestedMapping,
  type BlankPolicy,
  type ColumnMapping,
  type ImportMode,
  type MasterDataPolicy,
} from '@/modules/products/import/contract';
import {
  ACCEPTED_WORKBOOK_TYPES,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  WORKBOOK_SHEETS,
  effectiveMapping,
  readInspection,
  unrecognizedColumns,
  workbookFormData,
  type WorkbookInspection,
  type WorkbookPreview,
} from '@/modules/products/workbook/contract';
import { ImportJobStatusPanel } from '@/modules/import-jobs/ImportJobStatusPanel';
import { useImportJobEngine, useImportJobUrlParam, useResumeFromUrl } from '@/modules/import-jobs/useImportJobEngine';
import type { ApplyOptions } from '@/modules/import-jobs/client';

interface PriceListOption {
  id: string;
  name: string;
  is_active: boolean;
}

// لا شاشة جلسية سابقة لهذا المسار — أول واجهة له مبنيّة على المحرّك الدائم
// مباشرةً (PR-DUR-3). المصنّف ذرّيٌّ بطبيعته: لا `batch_offset`/`batch_size`
// في عقده أصلاً، فلا شريط تقدّمٍ مزيَّف هنا — قطعةٌ واحدة تُنجز الأوراق
// الثلاث معاً أو تفشلها معاً.
const STEP_KEYS = ['setup', 'preview', 'apply', 'result'] as const;

/** أخطاء كل ورقة تظهر مختصرةً ثم تتوسّع؛ التقرير الكامل في ملف CSV. */
const ERRORS_COLLAPSED = 5;
const ERRORS_EXPANDED = 50;
// رسائل الخادم قد تقتبس قيم خلايا؛ بادئة صيغة (= + - @) تُعطَّل كي لا تُنفَّذ إن فُتح التقرير في Excel (كتقرير الصفوف الفاشلة).
const spreadsheetSafe = (value: string) => (/^[=+\-@]/.test(value) ? `'${value}` : value);
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

export default function ProductWorkbookImportPage() {
  const t = useTranslations('productWorkbook');
  const tp = useTranslations('products');
  const tc = useTranslations('common');
  const locale = useLocale();
  const { success, toast } = useToast();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const { setParam } = useImportJobUrlParam();

  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [priceLists, setPriceLists] = useState<PriceListOption[] | null>(null);
  const [priceListId, setPriceListId] = useState('');
  const [mode, setMode] = useState<ImportMode>('create');
  const [blankPolicy, setBlankPolicy] = useState<BlankPolicy>('ignore');
  const [masterDataPolicy, setMasterDataPolicy] = useState<MasterDataPolicy>('match_or_text');
  const [preview, setPreview] = useState<WorkbookPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [inspection, setInspection] = useState<WorkbookInspection | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [expandedSheets, setExpandedSheets] = useState<Record<string, boolean>>({});
  // يمنع ردَّ فحصٍ متأخر لملفٍ سابق من الكتابة فوق ملفٍ اختير بعده.
  const inspectSeq = useRef(0);
  // نفس الحارس للمعاينة: ردٌّ متأخر لمدخلات سابقة (ملف/مطابقة تغيّرا أثناء الطلب) لا يُعرض.
  const previewSeq = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [resumedWithoutFile, setResumedWithoutFile] = useState(false);

  const engine = useImportJobEngine('product_workbook');
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

  useEffect(() => {
    api<{ data: PriceListOption[] }>('/price-lists')
      .then((response) => setPriceLists(response.data))
      .catch(() => setPriceLists([]));
  }, []);

  const activePriceLists = (priceLists ?? []).filter((list) => list.is_active);
  const steps = STEP_KEYS.map((key) => ({ key, label: t(`step_${key}` as 'step_setup') }));
  const fields = inspection?.fields.products ?? [];
  const writableFields = useMemo(() => fields.filter((field) => field.writable || field.key === 'nebrax_id'), [fields]);
  const activeMapping = effectiveMapping(inspection, mapping);
  const gaps = useMemo(() => mappingGaps(mapping, fields, mode), [mapping, fields, mode]);
  const mappingReady = !activeMapping || (gaps.missingRequired.length === 0 && !gaps.missingIdentifier && !gaps.duplicate);
  const canPreview = Boolean(file) && Boolean(priceListId) && !inspecting && !previewing && mappingReady;

  function reset() {
    setStep(0);
    setFile(null);
    setPreview(null);
    setInspection(null);
    setMapping({});
    setExpandedSheets({});
    inspectSeq.current += 1;
    previewSeq.current += 1;
    setInspecting(false);
    setPreviewing(false);
    setError(null);
    setResumedWithoutFile(false);
    setParam(null);
    engine.reset();
    if (fileInput.current) fileInput.current.value = '';
  }

  function acceptFile(next: File | null) {
    setFile(next);
    setPreview(null);
    setInspection(null);
    setMapping({});
    setExpandedSheets({});
    setError(null);
    const seq = ++inspectSeq.current;
    previewSeq.current += 1;
    setInspecting(false);
    setPreviewing(false);
    if (!next) return;
    if (next.size > MAX_IMPORT_BYTES) {
      setFile(null);
      setError(t('file_too_large', { limit: Math.round(MAX_IMPORT_BYTES / (1024 * 1024)) }));
      if (fileInput.current) fileInput.current.value = '';
      return;
    }
    void inspectFile(next, seq);
  }

  // الفحص استشاريّ (بلا تحقق ولا كتابة): فشله لا يمنع المعاينة، والخادم يطابق بالاسم تلقائياً كما كان.
  async function inspectFile(next: File, seq: number) {
    setInspecting(true);
    try {
      const form = new FormData();
      form.append('file', next);
      // طلب الفحص يشاركه FormRequest المصنّف فيشترط uuid لقائمة السعر، لكن الفحص نفسه لا يقرأها: معرّف صفري صالح الصياغة.
      form.append('price_list_id', priceListId || NIL_UUID);
      const response = await api<{ data: unknown }>('/products/workbook/inspect', { method: 'POST', body: form });
      if (seq !== inspectSeq.current) return;
      const result = readInspection(response.data);
      setInspection(result);
      setMapping(result ? suggestedMapping(result.sheets.products.columns.map((column) => ({ ...column, samples: [] }))) : {});
    } catch {
      if (seq === inspectSeq.current) setInspection(null);
    } finally {
      if (seq === inspectSeq.current) setInspecting(false);
    }
  }

  function updateMapping(index: number, value: string) {
    setMapping((current) => ({ ...current, [index]: value === '' ? null : value }));
    previewSeq.current += 1;
    setPreviewing(false);
    setPreview(null);
  }

  async function downloadTemplate() {
    try {
      const outcome = await downloadFile('/products/workbook/template', 'nebrax-products-workbook-template.xlsx');
      if (outcome === 'demo-unavailable') toast({ title: tp('export_demo_unavailable'), variant: 'info' });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    }
  }

  function downloadErrors(current: WorkbookPreview) {
    const rows = WORKBOOK_SHEETS.flatMap((sheet) =>
      current[sheet].errors.map((issue) => [t(`sheet_${sheet}` as 'sheet_products'), issue.row, spreadsheetSafe(issue.messages.join(' — '))])
    );
    downloadCsv('nebrax-workbook-errors.csv', toCsv([t('report_sheet'), t('report_row'), t('report_messages')], rows));
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    acceptFile(event.dataTransfer.files?.[0] ?? null);
  }

  async function runPreview() {
    if (!file || !priceListId) return;
    const seq = ++previewSeq.current;
    setPreviewing(true);
    setError(null);
    try {
      const response = await api<{ data: WorkbookPreview }>('/products/workbook/preview', {
        method: 'POST',
        body: workbookFormData(file, { priceListId, mode, blankPolicy, masterDataPolicy, mapping: activeMapping }),
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
    return {
      price_list_id: priceListId,
      mode,
      blank_policy: blankPolicy,
      master_data_policy: masterDataPolicy,
      ...(activeMapping ? { mapping: activeMapping } : {}),
    };
  }

  async function confirmAndApply() {
    setStep(2);
    setError(null);
    if (!engine.job) {
      if (!file) return;
      const job = await engine.upload(
        file,
        undefined,
        null,
        preview?.binding ? { binding: preview.binding, options: applyOptionsPayload() } : null
      );
      if (!job) return;
      // تشغيلةٌ مربوطةٌ بمعاينة تنفّذ خياراتها المجمَّدة عند الإنشاء: لا نرسل خيارات دلالية (الواجهة المستأنَفة لا تملك الأصلية).
      await engine.applyLoop(job.id, job.preview_bound ? {} : applyOptionsPayload());
      return;
    }
    await engine.applyLoop(engine.job.id, engine.job.preview_bound ? {} : applyOptionsPayload());
  }

  useEffect(() => {
    if (engine.job?.status === 'completed') {
      setStep(3);
      success(t('success'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine.job?.status]);

  const applyResult = engine.job?.apply_result as
    | {
        products?: { created: number; updated: number; skipped: number } | null;
        barcodes?: { created: number; skipped: number } | null;
        unit_prices?: { created: number; updated?: number } | null;
      }
    | null
    | undefined;

  return (
    <div className="space-y-4 pb-24 lg:pb-0">
      <header className="flex flex-wrap items-start gap-3">
        <Button asChild variant="ghost" size="icon" aria-label={tp('back')}>
          <Link href="/products">
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

      <p className="num text-xs text-muted md:hidden">{t('step_of', { current: step + 1, total: steps.length })}</p>
      <Stepper steps={steps} current={step} onSelect={(index) => index <= step && setStep(index)} label={t('title')} />

      {error ? (
        <p role="alert" className="rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-sm text-negative">
          {error}
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
              <PriceListSelect value={priceListId} onChange={setPriceListId} options={activePriceLists} t={t} />
              <FormActions
                primary={
                  <Button disabled={!priceListId} onClick={() => void confirmAndApply()}>
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
              <CardContent className="space-y-4">
                <div
                  onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={onDrop}
                  className={cn(
                    'rounded-md border border-dashed p-6 text-center transition-colors',
                    dragging ? 'border-primary bg-primary-soft' : 'border-border bg-background'
                  )}
                >
                  <FileSpreadsheet className="mx-auto h-6 w-6 text-muted" strokeWidth={1.6} />
                  <p className="mt-2 text-sm text-muted">{t('drop_hint')}</p>
                  <p className="mt-1 text-xs text-muted">{t('file_hint', { rows: MAX_IMPORT_ROWS })}</p>
                  <div className="mt-3">
                    <Label htmlFor="workbook-file" className="sr-only">{t('step_file')}</Label>
                    <Input
                      id="workbook-file"
                      ref={fileInput}
                      type="file"
                      accept={ACCEPTED_WORKBOOK_TYPES}
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
              </CardContent>
            </Card>

            {inspecting ? (
              <p className="flex items-center gap-2 text-sm text-muted" role="status">
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.7} />
                {t('inspecting')}
              </p>
            ) : null}

            {inspection ? (
              <Card>
                <CardHeader>
                  <CardTitle>{t('step_sheets')}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {WORKBOOK_SHEETS.map((sheet) => {
                    const detected = inspection.sheets[sheet];
                    const unknown = unrecognizedColumns(detected);
                    return (
                      <div key={sheet} className="rounded-md border border-border p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium text-text">{t(`sheet_${sheet}` as 'sheet_products')}</p>
                          <Badge tone={detected.present ? 'positive' : 'muted'}>
                            {detected.present ? t('sheet_present') : t('sheet_absent')}
                          </Badge>
                          {detected.present ? (
                            <span className="num text-xs text-muted">{t('sheet_data_rows', { rows: detected.total_rows })}</span>
                          ) : null}
                        </div>
                        {unknown.length > 0 && sheet !== 'products' ? (
                          <p role="status" className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-warning">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
                            {t('sheet_unrecognized', { columns: unknown.join('، ') })}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            ) : null}

            {activeMapping && inspection ? (
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle>{t('step_mapping')}</CardTitle>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="ms-auto"
                      onClick={() => {
                        setMapping(suggestedMapping(inspection.sheets.products.columns.map((column) => ({ ...column, samples: [] }))));
                        previewSeq.current += 1;
                        setPreviewing(false);
                        setPreview(null);
                      }}
                    >
                      {tp('import_mapping_reset')}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-xs leading-relaxed text-muted">{t('mapping_scope_note')}</p>
                  {gaps.missingRequired.length > 0 ? (
                    <p role="alert" className="rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-sm text-negative">
                      {tp('import_mapping_missing_required', {
                        fields: gaps.missingRequired.map((field) => fieldLabel(field, locale)).join('، '),
                      })}
                    </p>
                  ) : null}
                  {gaps.missingIdentifier ? (
                    <p role="alert" className="rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-sm text-negative">
                      {tp('import_mapping_missing_identifier')}
                    </p>
                  ) : null}
                  {gaps.duplicate ? (
                    <p role="alert" className="rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-sm text-negative">
                      {tp('import_mapping_duplicate')}
                    </p>
                  ) : null}
                  <div className="overflow-x-auto rounded-md border border-border">
                    <table className="w-full min-w-[32rem] text-sm">
                      <thead className="bg-background text-muted">
                        <tr>
                          <th className="px-3 py-2 text-start font-medium">{tp('import_mapping_source')}</th>
                          <th className="px-3 py-2 text-start font-medium">{tp('import_mapping_target')}</th>
                          <th className="px-3 py-2 text-start font-medium">{tp('import_mapping_state')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {inspection.sheets.products.columns.map((column) => {
                          const selected = mapping[column.index] ?? '';
                          const field = fields.find((item) => item.key === selected);
                          return (
                            <tr key={column.index} className="border-t border-border align-top">
                              <td className="max-w-48 px-3 py-2">
                                <span className="block truncate font-medium text-text" title={column.header}>
                                  {column.header || '—'}
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                <Label htmlFor={`wb-map-${column.index}`} className="sr-only">
                                  {column.header}
                                </Label>
                                <Select
                                  id={`wb-map-${column.index}`}
                                  value={selected}
                                  onChange={(event) => updateMapping(column.index, event.target.value)}
                                  className="min-w-44"
                                >
                                  <option value="">{tp('import_mapping_ignore')}</option>
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
                                    {selected ? tp('import_mapping_mapped') : tp('import_mapping_unmapped')}
                                  </Badge>
                                  {field?.required ? <Badge tone="muted">{tp('import_mapping_required')}</Badge> : null}
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

            <Card>
              <CardHeader>
                <CardTitle>{t('step_price_list')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <PriceListSelect value={priceListId} onChange={setPriceListId} options={activePriceLists} t={t} />
                <p className="text-xs leading-relaxed text-muted">{t('price_list_hint')}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('step_rules')}</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="wb-mode">{tp('import_mode')}</Label>
                  <Select id="wb-mode" value={mode} onChange={(event) => setMode(event.target.value as ImportMode)}>
                    <option value="create">{tp('import_mode_create')}</option>
                    <option value="update">{tp('import_mode_update')}</option>
                    <option value="upsert">{tp('import_mode_upsert')}</option>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wb-blank">{tp('import_blank_policy')}</Label>
                  <Select id="wb-blank" value={blankPolicy} disabled={mode === 'create'} onChange={(event) => setBlankPolicy(event.target.value as BlankPolicy)}>
                    <option value="ignore">{tp('import_blank_ignore')}</option>
                    <option value="clear">{tp('import_blank_clear')}</option>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wb-master">{tp('import_master_data_policy')}</Label>
                  <Select id="wb-master" value={masterDataPolicy} onChange={(event) => setMasterDataPolicy(event.target.value as MasterDataPolicy)}>
                    <option value="match_or_error">{tp('import_master_data_error')}</option>
                    <option value="match_or_text">{tp('import_master_data_text')}</option>
                    <option value="create_missing">{tp('import_master_data_create')}</option>
                  </Select>
                </div>
              </CardContent>
            </Card>

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
            {(['products', 'barcodes', 'unit_prices'] as const).map((sheet) => (
              <div key={sheet} className="rounded-md border border-border p-3">
                <p className="text-sm font-medium text-text">{t(`sheet_${sheet}` as 'sheet_products')}</p>
                <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <div>
                    <dt className="text-xs text-muted">{t('sheet_total_rows')}</dt>
                    <dd className="num text-sm text-text">{preview[sheet].total_rows}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">{t('sheet_error_rows')}</dt>
                    <dd className={cn('num text-sm', preview[sheet].error_rows > 0 ? 'text-negative' : 'text-text')}>
                      {preview[sheet].error_rows}
                    </dd>
                  </div>
                </dl>
                {preview[sheet].errors.length > 0 ? (
                  <div className="mt-2 space-y-2">
                    <ul className="space-y-1 text-xs leading-relaxed text-negative">
                      {preview[sheet].errors
                        .slice(0, expandedSheets[sheet] ? ERRORS_EXPANDED : ERRORS_COLLAPSED)
                        .map((issue) => (
                          <li key={issue.row}>
                            {t('sheet_row', { row: issue.row })}: {issue.messages.join(' — ')}
                          </li>
                        ))}
                    </ul>
                    {preview[sheet].errors.length > ERRORS_COLLAPSED ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setExpandedSheets((current) => ({ ...current, [sheet]: !current[sheet] }))}
                      >
                        {expandedSheets[sheet] ? t('errors_show_less') : t('errors_show_more', { count: Math.min(preview[sheet].errors.length, ERRORS_EXPANDED) })}
                      </Button>
                    ) : null}
                    {expandedSheets[sheet] && preview[sheet].errors.length > ERRORS_EXPANDED ? (
                      <p className="text-xs text-muted">{t('errors_truncated', { shown: ERRORS_EXPANDED, total: preview[sheet].errors.length })}</p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))}

            {WORKBOOK_SHEETS.some((sheet) => preview[sheet].errors.length > 0) ? (
              <Button type="button" variant="outline" size="sm" onClick={() => downloadErrors(preview)}>
                <Download className="h-4 w-4" strokeWidth={1.7} />
                {t('download_errors')}
              </Button>
            ) : null}

            {!preview.ready ? (
              <p role="alert" className="rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-sm text-negative">
                {tp('import_fix_errors')}
              </p>
            ) : null}

            <FormActions
              secondary={
                <Button type="button" variant="outline" onClick={() => setStep(0)}>
                  {tp('import_back')}
                </Button>
              }
              primary={
                <Button disabled={!preview.ready} onClick={() => void confirmAndApply()}>
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
            <ImportJobStatusPanel job={engine.job} atomic networkUncertain={engine.networkUncertain} />
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
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-md border border-border bg-background px-3 py-2">
                <dt className="text-xs text-muted">{t('sheet_products')}</dt>
                <dd className="num mt-0.5 text-sm text-text">
                  {t('result_products', {
                    created: applyResult?.products?.created ?? 0,
                    updated: applyResult?.products?.updated ?? 0,
                  })}
                </dd>
              </div>
              <div className="rounded-md border border-border bg-background px-3 py-2">
                <dt className="text-xs text-muted">{t('sheet_barcodes')}</dt>
                <dd className="num mt-0.5 text-sm text-text">{applyResult?.barcodes?.created ?? 0}</dd>
              </div>
              <div className="rounded-md border border-border bg-background px-3 py-2">
                <dt className="text-xs text-muted">{t('sheet_unit_prices')}</dt>
                <dd className="num mt-0.5 text-sm text-text">{applyResult?.unit_prices?.created ?? 0}</dd>
              </div>
            </dl>
            <FormActions
              secondary={
                <Button variant="outline" onClick={reset}>
                  {tp('import_start_another')}
                </Button>
              }
              primary={
                <Button asChild variant="primary">
                  <Link href="/products">{tp('import_back_to_products')}</Link>
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function PriceListSelect({
  value,
  onChange,
  options,
  t,
}: {
  value: string;
  onChange: (value: string) => void;
  options: PriceListOption[];
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="wb-price-list">{t('price_list')}</Label>
      <Select id="wb-price-list" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{t('price_list_placeholder')}</option>
        {options.map((list) => (
          <option key={list.id} value={list.id}>
            {list.name}
          </option>
        ))}
      </Select>
      {options.length === 0 ? (
        <p className="flex items-center gap-1.5 text-xs text-warning">
          <AlertTriangle className="h-3.5 w-3.5" strokeWidth={1.7} />
          {t('price_list_none')}
        </p>
      ) : null}
    </div>
  );
}
