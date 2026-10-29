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
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { FormActions } from '@/components/nebrax';
import { api, ApiError, downloadFile } from '@/lib/api';
import { downloadCsv, toCsv } from '@/lib/export';
import { formatRiyal, minorToRiyal } from '@/lib/money';
import { cn } from '@/lib/utils';
import { Stepper } from '@/modules/products/import/stepper';
import { ImportJobStatusPanel } from '@/modules/import-jobs/ImportJobStatusPanel';
import { hasFrozenOptions, type ApplyOptions } from '@/modules/import-jobs/client';
import { useImportJobEngine, useImportJobUrlParam, useResumeFromUrl } from '@/modules/import-jobs/useImportJobEngine';
import { spreadsheetSafe } from '@/modules/stocktaking/import/contract';
import {
  ACCEPTED_STOCK_PERMIT_IMPORT_TYPES,
  EMPTY_STOCK_PERMIT_HEADER,
  MAX_STOCK_PERMIT_IMPORT_BYTES,
  STOCK_PERMIT_IMPORT_ROW_LIMIT,
  STOCK_PERMIT_TYPES,
  mappingForPermitType,
  stockPermitFieldLabel,
  stockPermitHeaderGaps,
  stockPermitHeaderReady,
  stockPermitInspectFormData,
  stockPermitJobOptions,
  stockPermitMappingGaps,
  stockPermitPreviewFormData,
  suggestedStockPermitMapping,
  type StockPermitColumnMapping,
  type StockPermitHeader,
  type StockPermitImportPreview,
  type StockPermitInspectResult,
  type StockPermitType,
} from './contract';

const STEP_KEYS = ['setup', 'preview', 'apply', 'result'] as const;
const ERRORS_COLLAPSED = 5;
const ROWS_COLLAPSED = 10;
const BACK_HREF = '/stock-permits';

interface WarehouseOption {
  id: string;
  name: string;
  code?: string | null;
  is_active?: boolean;
}

/**
 * معالج استيراد بنود إذنٍ مخزني (IMP-H7-S3b). **الملف = إذن مسودة واحد**: رأس الإذن (النوع · المخزن · الوجهة للتحويل · التاريخ · السبب · الملاحظات · سياسة التكلفة الصفرية)
 * خياراتٌ مجمَّدة للتشغيلة، والصفوف بنود. الخطوات: رأس وملف ومطابقة ← معاينة (بلا كتابة) ← تشغيلة دائمة مربوطة بالمعاينة (ذرّية: إذنٌ كامل أو لا شيء) ← نتيجة.
 * **ينشئ مسودة فقط**: لا حركة مخزون ولا قيد؛ الترحيل فعلٌ منفصل من صفحة الإذن.
 */
export function StockPermitImportWizard() {
  const t = useTranslations('stockPermitImport');
  const tc = useTranslations('common');
  const locale = useLocale();
  const { success, toast } = useToast();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const { setParam } = useImportJobUrlParam();

  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [header, setHeader] = useState<StockPermitHeader>(EMPTY_STOCK_PERMIT_HEADER);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [inspection, setInspection] = useState<StockPermitInspectResult | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [mapping, setMapping] = useState<StockPermitColumnMapping>({});
  const [preview, setPreview] = useState<StockPermitImportPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [rowsExpanded, setRowsExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resumedWithoutFile, setResumedWithoutFile] = useState(false);
  // يمنع ردّاً متأخراً لملفٍ/مدخلاتٍ سابقة من الكتابة فوق الأحدث (الفحص والمعاينة).
  const inspectSeq = useRef(0);
  const previewSeq = useRef(0);

  const engine = useImportJobEngine('stock_permit_import');
  useResumeFromUrl((jobId) => {
    setResumedWithoutFile(true);
    void engine.resume(jobId);
  });

  useEffect(() => {
    let cancelled = false;
    api<{ data: WarehouseOption[] }>('/warehouses')
      .then((response) => {
        if (!cancelled) setWarehouses(response.data.filter((warehouse) => warehouse.is_active !== false));
      })
      .catch(() => {
        if (!cancelled) setWarehouses([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (engine.job) {
      setParam(engine.job.id);
      if (step < 2 && engine.job.status !== 'ready') setStep(2);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine.job?.id]);

  const fields = inspection?.fields ?? [];
  const headerGaps = stockPermitHeaderGaps(header);
  const headerReady = stockPermitHeaderReady(header);
  const gaps = useMemo(() => stockPermitMappingGaps(mapping, header), [mapping, header]);
  const activeMapping = inspection && inspection.columns.length > 0 ? mapping : undefined;
  const mappingReady = !activeMapping || (!gaps.missingIdentifier && !gaps.missingQuantity && !gaps.duplicate && !gaps.costOnNonReceipt && !gaps.missingCost);
  // بلا رأسٍ صالح لا فحص (الخادم يشترط النوع والمخزن حتى في الفحص) وبلا فحصٍ ناجح لا مطابقة: الخادم يرفضها بالسبب نفسه فلا تُتاح.
  const canPreview = Boolean(file) && headerReady && inspection !== null && !inspecting && !previewing && mappingReady;
  const steps = STEP_KEYS.map((key) => ({ key, label: t(`step_${key}`) }));
  // معاينةٌ استُهلك ربطها (تشغيلة انتهت): لا تنفيذ ثانٍ منها — تُعاد المعاينة لتشغيلة جديدة.
  const jobTerminal = engine.job !== null && ['failed', 'completed', 'cancelled'].includes(engine.job.status);
  // تشغيلة من مجالٍ آخر (رابط ?job= يدوي) لا تُعرَض ولا تُنفَّذ من هذه الشاشة في أي خطوة.
  const wrongDomainJob = engine.job !== null && engine.job.domain !== 'stock_permit_import';
  const view = wrongDomainJob ? -1 : step;
  const isReceipt = header.permitType === 'receipt';

  /** تشغيلةٌ سابقة مجمَّدة الملف والخيارات: أي تغيير يُسقطها كي لا يُنفَّذ ما لم يُعايَن (تبقى على الخادم وتُستأنف برابطها). */
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

  /** كل تغيير في الرأس يُسقط المعاينة والتشغيلة؛ تغيير النوع يُكيّف الإعدادات التابعة له (الوجهة والتكلفة الصفرية وعمود التكلفة). */
  function changeHeader(patch: Partial<StockPermitHeader>) {
    const next = { ...header, ...patch };
    if (patch.permitType !== undefined && patch.permitType !== header.permitType) {
      if (next.permitType !== 'transfer') next.targetWarehouseId = '';
      if (next.permitType !== 'receipt') next.allowZeroCost = false;
      setMapping((current) => mappingForPermitType(current, next.permitType));
    }
    setHeader(next);
    invalidatePreview();
  }

  async function inspectFile(next: File, seq: number) {
    setInspecting(true);
    try {
      const response = await api<{ data: StockPermitInspectResult }>('/stock-permits/import/inspect', { method: 'POST', body: stockPermitInspectFormData(next, header) });
      if (seq !== inspectSeq.current) return;
      setInspection(response.data);
      setMapping(suggestedStockPermitMapping(response.data.columns, header.permitType));
    } catch (err) {
      if (seq !== inspectSeq.current) return;
      setInspection(null);
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      if (seq === inspectSeq.current) setInspecting(false);
    }
  }

  function acceptFile(next: File | null) {
    // الخادم يشترط النوع والمخزن حتى في الفحص: لا ملف قبل اكتمال الرأس.
    if (next && !headerReady) {
      setError(t('header_first'));
      if (fileInput.current) fileInput.current.value = '';
      return;
    }
    setFile(next);
    setInspection(null);
    setMapping({});
    invalidatePreview();
    setError(null);
    const seq = ++inspectSeq.current;
    setInspecting(false);
    if (!next) return;
    if (next.size > MAX_STOCK_PERMIT_IMPORT_BYTES) {
      setFile(null);
      setError(t('file_too_large', { limit: Math.round(MAX_STOCK_PERMIT_IMPORT_BYTES / (1024 * 1024)) }));
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
    if (!file || !headerReady) return;
    dropJob();
    const seq = ++previewSeq.current;
    setPreviewing(true);
    setError(null);
    try {
      const response = await api<{ data: StockPermitImportPreview }>('/stock-permits/import/preview', {
        method: 'POST',
        body: stockPermitPreviewFormData(file, header, activeMapping),
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
    // التاريخ المحسوم في المعاينة (لا الحقل الفارغ) كي تتطابق بصمة الخيارات مع بصمتها.
    return { ...stockPermitJobOptions(header, preview?.permit_date ?? header.permitDate, activeMapping) } as ApplyOptions;
  }

  async function confirmAndApply() {
    if (wrongDomainJob) return;
    setStep(2);
    setError(null);
    if (!engine.job) {
      if (!file) return;
      // مفتاح ثباتٍ مشتق من المعاينة أحادية الاستعمال: إعادة المحاولة بعد انقطاع الشبكة تعيد التشغيلة نفسها بدل أن ترفضها المعاينة المستهلكة.
      const job = await engine.upload(file, preview?.binding ? `stock-permit-${preview.binding.id}` : undefined, null, preview?.binding ? { binding: preview.binding, options: applyOptionsPayload() } : null);
      if (!job) {
        // فشل الإنشاء (معاينة منتهية/خيار مرفوض/شبكة): لا صفحة فارغة — نعود إلى المعاينة والخطأ ظاهر.
        setStep(1);
        return;
      }
      // تشغيلةٌ مربوطةٌ بمعاينة تنفّذ خياراتها المجمَّدة عند الإنشاء: لا خيارات دلالية في طلب التطبيق.
      await engine.applyLoop(job.id, hasFrozenOptions(job) ? {} : applyOptionsPayload());
      return;
    }
    await engine.applyLoop(engine.job.id, hasFrozenOptions(engine.job) ? {} : applyOptionsPayload());
  }

  async function downloadTemplate() {
    try {
      if ((await downloadFile('/stock-permits/import/template', 'nebrax-stock-permit-import-template.csv')) === 'demo-unavailable') {
        toast({ title: t('demo_unavailable'), variant: 'info' });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    }
  }

  function downloadErrors(current: StockPermitImportPreview) {
    downloadCsv(
      'nebrax-stock-permit-import-errors',
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

  const applyResult = engine.job?.apply_result as { permit_id?: string; permit_number?: string; lines?: number } | null | undefined;
  const visibleRows = preview ? (rowsExpanded ? preview.rows : preview.rows.slice(0, ROWS_COLLAPSED)) : [];
  const money = (minor: number | null) => (minor === null ? '—' : formatRiyal(minorToRiyal(minor)));
  const warehouseLabel = (warehouse: WarehouseOption) => (warehouse.code ? `${warehouse.code} — ${warehouse.name}` : warehouse.name);

  return (
    <div className="space-y-4 pb-24 lg:pb-0">
      <header className="flex flex-wrap items-start gap-3">
        <Button asChild variant="ghost" size="icon" aria-label={t('back')}>
          <Link href={BACK_HREF}>
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

      <Stepper steps={steps} current={step} onSelect={(index) => index <= step && (index !== 1 || preview !== null) && engine.busy !== 'applying' && engine.busy !== 'uploading' && setStep(index)} label={t('step_label')} />

      {error || engine.error ? (
        <p role="alert" className="rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-sm text-negative">
          {error ?? engine.error}
        </p>
      ) : null}

      {wrongDomainJob ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('resumed_title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p role="alert" className="text-sm text-negative">{t('resumed_wrong_domain')}</p>
            <FormActions primary={<Button variant="outline" onClick={reset}>{t('start_another')}</Button>} />
          </CardContent>
        </Card>
      ) : null}

      {view === 0 ? (
        resumedWithoutFile && engine.job ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('resumed_title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm leading-relaxed text-muted">{t('resumed_hint', { name: engine.job.original_filename })}</p>
              {hasFrozenOptions(engine.job) ? null : <p role="alert" className="text-sm text-negative">{t('resumed_unbound')}</p>}
              <FormActions
                primary={
                  <Button disabled={!hasFrozenOptions(engine.job)} onClick={() => void confirmAndApply()}>
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
                <CardTitle>{t('step_header')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs leading-relaxed text-muted">{t('header_note')}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="spi-type">{t('permit_type')}</Label>
                    <Select id="spi-type" value={header.permitType} onChange={(event) => changeHeader({ permitType: event.target.value as StockPermitType | '' })}>
                      <option value="">{t('permit_type_choose')}</option>
                      {STOCK_PERMIT_TYPES.map((type) => (
                        <option key={type} value={type}>{t(`type_${type}`)}</option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="spi-warehouse">{header.permitType === 'transfer' ? t('from_warehouse') : t('warehouse')}</Label>
                    <Select id="spi-warehouse" value={header.warehouseId} onChange={(event) => changeHeader({ warehouseId: event.target.value })}>
                      <option value="">{t('warehouse_choose')}</option>
                      {warehouses.map((warehouse) => (
                        <option key={warehouse.id} value={warehouse.id}>{warehouseLabel(warehouse)}</option>
                      ))}
                    </Select>
                  </div>
                  {header.permitType === 'transfer' ? (
                    <div className="space-y-1.5">
                      <Label htmlFor="spi-target">{t('to_warehouse')}</Label>
                      <Select id="spi-target" value={header.targetWarehouseId} onChange={(event) => changeHeader({ targetWarehouseId: event.target.value })}>
                        <option value="">{t('warehouse_choose')}</option>
                        {warehouses.map((warehouse) => (
                          <option key={warehouse.id} value={warehouse.id}>{warehouseLabel(warehouse)}</option>
                        ))}
                      </Select>
                      {headerGaps.sameWarehouse ? <p role="alert" className="text-xs text-negative">{t('same_warehouse')}</p> : null}
                      {headerGaps.missingTarget ? <p className="text-xs text-muted">{t('target_required')}</p> : null}
                    </div>
                  ) : null}
                  <div className="space-y-1.5">
                    <Label htmlFor="spi-date">{t('permit_date')}</Label>
                    <Input id="spi-date" type="date" value={header.permitDate} onChange={(event: ChangeEvent<HTMLInputElement>) => changeHeader({ permitDate: event.target.value })} />
                    <p className="text-xs leading-relaxed text-muted">{t('permit_date_hint')}</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="spi-reason">{t('reason')}</Label>
                    <Input id="spi-reason" maxLength={255} value={header.reason} onChange={(event: ChangeEvent<HTMLInputElement>) => changeHeader({ reason: event.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="spi-notes">{t('notes')}</Label>
                    <Input id="spi-notes" maxLength={500} value={header.notes} onChange={(event: ChangeEvent<HTMLInputElement>) => changeHeader({ notes: event.target.value })} />
                  </div>
                </div>
                {isReceipt ? (
                  <div className="flex items-start gap-3 rounded-md border border-border bg-background px-3 py-2">
                    <Switch id="spi-zero-cost" checked={header.allowZeroCost} onCheckedChange={(checked) => changeHeader({ allowZeroCost: checked })} aria-labelledby="spi-zero-cost-label" />
                    <div className="space-y-0.5">
                      <Label id="spi-zero-cost-label" htmlFor="spi-zero-cost">{t('allow_zero_cost')}</Label>
                      <p className="text-xs leading-relaxed text-muted">{t('allow_zero_cost_hint')}</p>
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>

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
                  <p className="mt-2 text-sm text-muted">{headerReady ? t('drop_hint') : t('header_first')}</p>
                  <p className="mt-1 text-xs text-muted">{t('file_hint', { rows: STOCK_PERMIT_IMPORT_ROW_LIMIT })}</p>
                  <div className="mt-3">
                    <Label htmlFor="spi-file" className="sr-only">{t('step_file')}</Label>
                    <Input
                      id="spi-file"
                      ref={fileInput}
                      type="file"
                      disabled={!headerReady}
                      accept={ACCEPTED_STOCK_PERMIT_IMPORT_TYPES}
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
                      onClick={() => { setMapping(suggestedStockPermitMapping(inspection.columns, header.permitType)); invalidatePreview(); }}
                    >
                      {t('mapping_reset')}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(
                    [
                      [gaps.missingIdentifier, 'mapping_missing_identifier'],
                      [gaps.missingQuantity, 'mapping_missing_quantity'],
                      [gaps.duplicate, 'mapping_duplicate'],
                      [gaps.costOnNonReceipt, 'mapping_cost_receipt_only'],
                      [gaps.missingCost, 'mapping_missing_cost'],
                    ] as const
                  ).map(([show, key]) =>
                    show ? (
                      <p key={key} role="alert" className="rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-sm text-negative">{t(key)}</p>
                    ) : null
                  )}
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
                                <Label htmlFor={`spi-map-${column.index}`} className="sr-only">{column.header || t('mapping_column', { n: column.index + 1 })}</Label>
                                <Select id={`spi-map-${column.index}`} value={selected} onChange={(event) => updateMapping(column.index, event.target.value)} className="min-w-44">
                                  <option value="">{t('mapping_ignore')}</option>
                                  {fields.map((item) => (
                                    <option key={item.key} value={item.key}>{stockPermitFieldLabel(item, locale)}</option>
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

      {view === 1 && preview ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('step_preview')} — {t(`type_${preview.permit_type}`)}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <div className="rounded-md border border-border bg-background px-3 py-2">
                <dt className="text-xs text-muted">{preview.permit_type === 'transfer' ? t('from_warehouse') : t('warehouse')}</dt>
                <dd className="mt-0.5 text-sm font-medium text-text">{preview.warehouse_name ?? '—'}</dd>
              </div>
              {preview.permit_type === 'transfer' ? (
                <div className="rounded-md border border-border bg-background px-3 py-2">
                  <dt className="text-xs text-muted">{t('to_warehouse')}</dt>
                  <dd className="mt-0.5 text-sm font-medium text-text">{preview.target_warehouse_name ?? '—'}</dd>
                </div>
              ) : null}
              <div className="rounded-md border border-border bg-background px-3 py-2">
                <dt className="text-xs text-muted">{t('permit_date')}</dt>
                <dd className="num mt-0.5 text-sm font-medium text-text" dir="ltr">{preview.permit_date}</dd>
              </div>
            </dl>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(
                [
                  ['lines', preview.line_rows],
                  ['warnings', preview.warning_rows],
                  ['errors', preview.error_rows],
                ] as const
              ).map(([key, value]) => (
                <div key={key} className="rounded-md border border-border bg-background px-3 py-2">
                  <dt className="text-xs text-muted">{t(`count_${key}`)}</dt>
                  <dd className={cn('num mt-0.5 text-lg font-semibold', key === 'errors' && value > 0 ? 'text-negative' : 'text-text')}>{value}</dd>
                </div>
              ))}
              {preview.permit_type === 'receipt' ? (
                <div className="rounded-md border border-border bg-background px-3 py-2">
                  <dt className="text-xs text-muted">{t('count_total_cost')}</dt>
                  <dd className="num mt-0.5 text-lg font-semibold text-text">{money(preview.total_cost)}</dd>
                </div>
              ) : null}
            </dl>
            <p className="text-xs leading-relaxed text-muted">{t('preview_draft_note')}</p>

            {preview.rows.length > 0 ? (
              <div className="space-y-2">
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full min-w-[40rem] text-sm">
                    <thead className="bg-background text-muted">
                      <tr>
                        <th className="px-3 py-2 text-start font-medium">{t('col_row')}</th>
                        <th className="px-3 py-2 text-start font-medium">{t('col_product')}</th>
                        <th className="px-3 py-2 text-start font-medium">{t('col_quantity')}</th>
                        <th className="px-3 py-2 text-start font-medium">{t('col_unit')}</th>
                        {preview.permit_type === 'receipt' ? <th className="px-3 py-2 text-start font-medium">{t('col_unit_cost')}</th> : null}
                        {preview.permit_type === 'receipt' ? <th className="px-3 py-2 text-start font-medium">{t('col_line_cost')}</th> : null}
                        <th className="px-3 py-2 text-start font-medium">{t('col_status')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRows.map((row) => (
                        <tr key={row.row} className="border-t border-border align-top">
                          <td className="num px-3 py-2 text-muted">{row.row}</td>
                          <td className="max-w-56 px-3 py-2">
                            <span className="block truncate text-text" title={row.product_name ?? ''}>{row.product_name ?? '—'}</span>
                            <span className="block truncate text-xs text-muted" dir="ltr">{row.sku ?? row.barcode ?? ''}</span>
                          </td>
                          <td className="num px-3 py-2">{row.quantity ?? '—'}</td>
                          <td className="px-3 py-2">{row.unit ?? t('base_unit')}</td>
                          {preview.permit_type === 'receipt' ? <td className="num px-3 py-2">{money(row.unit_cost)}</td> : null}
                          {preview.permit_type === 'receipt' ? <td className="num px-3 py-2">{money(row.line_cost)}</td> : null}
                          <td className="px-3 py-2">
                            <Badge tone={!row.valid ? 'negative' : row.warnings.length > 0 ? 'warning' : 'positive'}>
                              {!row.valid ? t('status_error') : row.warnings.length > 0 ? t('status_warning') : t('status_ok')}
                            </Badge>
                            {[...row.messages, ...row.warnings].map((message) => (
                              <span key={message} className={cn('mt-1 block text-xs leading-relaxed', row.valid ? 'text-warning' : 'text-negative')}>{message}</span>
                            ))}
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
              </div>
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
                {t('warnings_note', { count: preview.warning_rows })}
              </p>
            ) : null}
            {preview.rows_truncated ? <p className="text-xs text-muted">{t('rows_truncated', { shown: preview.rows_shown, total: preview.total_rows })}</p> : null}

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

      {view === 2 && engine.job ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('step_apply')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {engine.job.status === 'processing' && engine.busy === null && hasFrozenOptions(engine.job) ? (
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

      {view === 3 && engine.job?.status === 'completed' ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-positive" strokeWidth={1.7} />
              {t('step_result')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <div className="rounded-md border border-border bg-background px-3 py-2">
                <dt className="text-xs text-muted">{t('result_permit')}</dt>
                <dd className="num mt-0.5 text-lg font-semibold text-text" dir="ltr">{applyResult?.permit_number ?? '—'}</dd>
              </div>
              <div className="rounded-md border border-border bg-background px-3 py-2">
                <dt className="text-xs text-muted">{t('result_lines')}</dt>
                <dd className="num mt-0.5 text-lg font-semibold text-text">{applyResult?.lines ?? 0}</dd>
              </div>
            </dl>
            <p className="text-xs leading-relaxed text-muted">{t('result_draft_hint')}</p>
            <FormActions
              secondary={<Button variant="outline" onClick={reset}>{t('start_another')}</Button>}
              primary={
                <Button asChild variant="primary">
                  <Link href={applyResult?.permit_id ? `/stock-permits/${applyResult.permit_id}` : BACK_HREF}>{t('open_permit')}</Link>
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
