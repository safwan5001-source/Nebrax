'use client';

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowRight, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload } from 'lucide-react';
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
import { DocumentCenterEntryLink } from '@/modules/import-jobs/DocumentCenterEntryLink';
import { ImportJobStatusPanel } from '@/modules/import-jobs/ImportJobStatusPanel';
import { hasFrozenOptions, type ApplyOptions } from '@/modules/import-jobs/client';
import { useImportJobEngine, useImportJobUrlParam, useResumeFromUrl } from '@/modules/import-jobs/useImportJobEngine';
import { MappingPresetBar } from '@/modules/import-jobs/MappingPresetBar';
import {
  ACCEPTED_PURCHASE_IMPORT_TYPES,
  MAX_PURCHASE_IMPORT_BYTES,
  PURCHASE_IMPORT_ROW_LIMIT,
  PURCHASE_PAYMENT_TYPES,
  parseOptionalTaxRate,
  purchaseFieldLabel,
  purchaseImportFormData,
  purchaseJobOptions,
  purchaseMappingGaps,
  spreadsheetSafe,
  suggestedPurchaseMapping,
  type PurchaseColumnMapping,
  type PurchaseImportOptions,
  type PurchaseImportPreview,
  type PurchaseInspectResult,
  type PurchasePaymentType,
  type TriState,
} from './contract';

const STEP_KEYS = ['setup', 'preview', 'apply', 'result'] as const;
const ERRORS_COLLAPSED = 5;
const UNITS_COLLAPSED = 10;

interface SupplierOption {
  id: string;
  name: string;
  code?: string | null;
  is_active?: boolean;
}

interface WarehouseOption {
  id: string;
  name: string;
  code?: string | null;
  is_active?: boolean;
}

/**
 * معالج استيراد فواتير المشتريات مسوداتٍ (IMP-H5-S4b). الخطوات: ملف وقواعد ومطابقة ← معاينة (بلا كتابة) بوحدة الفاتورة ← تشغيلة دائمة مربوطة بالمعاينة ← نتيجة.
 * الخادم مصدر الحقيقة؛ لا ترحيل ولا قيد ولا حركة مخزون من هنا (الترحيل فعلٌ منفصل لكل فاتورة)، والإجماليات يشتقّها الخادم. التكرار (مورّد ‖ رقم فاتورته) يُرفض ولا تأكيد له.
 */
export function PurchaseImportWizard() {
  const t = useTranslations('purchaseImport');
  const tc = useTranslations('common');
  const locale = useLocale();
  const { success, toast } = useToast();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const { setParam } = useImportJobUrlParam();

  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [defaultSupplierId, setDefaultSupplierId] = useState('');
  const [defaultPayment, setDefaultPayment] = useState<PurchasePaymentType | ''>('');
  const [defaultTax, setDefaultTax] = useState('');
  const [taxInclusive, setTaxInclusive] = useState<TriState>('');
  const [warehouseId, setWarehouseId] = useState('');
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [inspection, setInspection] = useState<PurchaseInspectResult | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [mapping, setMapping] = useState<PurchaseColumnMapping>({});
  const [preview, setPreview] = useState<PurchaseImportPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [unitsExpanded, setUnitsExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resumedWithoutFile, setResumedWithoutFile] = useState(false);
  // يمنع ردّاً متأخراً لملفٍ/مدخلاتٍ سابقة من الكتابة فوق الأحدث (الفحص والمعاينة).
  const inspectSeq = useRef(0);
  const previewSeq = useRef(0);

  const engine = useImportJobEngine('purchase_import');
  useResumeFromUrl((jobId) => {
    setResumedWithoutFile(true);
    void engine.resume(jobId);
  });

  useEffect(() => {
    api<{ data: SupplierOption[] }>('/partners?type=supplier')
      .then((response) => setSuppliers(response.data.filter((supplier) => supplier.is_active !== false)))
      .catch(() => setSuppliers([]));
    api<{ data: WarehouseOption[] }>('/warehouses')
      .then((response) => setWarehouses(response.data.filter((warehouse) => warehouse.is_active !== false)))
      .catch(() => setWarehouses([]));
  }, []);

  useEffect(() => {
    if (engine.job) {
      setParam(engine.job.id);
      if (step < 2 && engine.job.status !== 'ready') setStep(2);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine.job?.id]);

  const parsedTax = parseOptionalTaxRate(defaultTax);
  const taxValid = parsedTax !== undefined;
  const fields = inspection?.fields ?? [];
  const gaps = useMemo(() => purchaseMappingGaps(mapping, fields, { defaultSupplierId }), [mapping, fields, defaultSupplierId]);
  const activeMapping = inspection && inspection.columns.length > 0 ? mapping : undefined;
  const mappingReady = !activeMapping || (gaps.missingRequired.length === 0 && !gaps.missingSupplier && !gaps.missingProduct && !gaps.duplicate);
  // بلا فحص ناجح لا مطابقة ولا حقول: المعاينة ستفشل بالسبب نفسه، فلا تُتاح.
  const canPreview = Boolean(file) && inspection !== null && !inspecting && !previewing && mappingReady && taxValid;
  const steps = STEP_KEYS.map((key) => ({ key, label: t(`step_${key}`) }));

  function currentOptions(): PurchaseImportOptions {
    return { defaultSupplierId, defaultPaymentType: defaultPayment, defaultTaxRate: parsedTax ?? null, taxInclusive, warehouseId, mapping: activeMapping };
  }

  /** تشغيلةٌ سابقة مجمَّدة الملف والخيارات: أي تغيير في الملف/القواعد/المطابقة يُسقطها كي لا يُنفَّذ ما لم يُعايَن (تبقى على الخادم وتُستأنف برابطها). */
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
    setUnitsExpanded(false);
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
      const response = await api<{ data: PurchaseInspectResult }>('/purchases/import/inspect', { method: 'POST', body: form });
      if (seq !== inspectSeq.current) return;
      setInspection(response.data);
      setMapping(suggestedPurchaseMapping(response.data.columns));
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
    if (next.size > MAX_PURCHASE_IMPORT_BYTES) {
      setFile(null);
      setError(t('file_too_large', { limit: Math.round(MAX_PURCHASE_IMPORT_BYTES / (1024 * 1024)) }));
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
      const response = await api<{ data: PurchaseImportPreview }>('/purchases/import/preview', {
        method: 'POST',
        body: purchaseImportFormData(file, currentOptions()),
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
    return { ...purchaseJobOptions(currentOptions()) } as ApplyOptions;
  }

  async function confirmAndApply() {
    if (wrongDomainJob) return;
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
      await engine.applyLoop(job.id, hasFrozenOptions(job) ? {} : applyOptionsPayload());
      return;
    }
    await engine.applyLoop(engine.job.id, hasFrozenOptions(engine.job) ? {} : applyOptionsPayload());
  }

  async function downloadTemplate() {
    try {
      if ((await downloadFile('/purchases/import/template', 'nebrax-purchases-import-template.csv')) === 'demo-unavailable') {
        toast({ title: t('demo_unavailable'), variant: 'info' });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    }
  }

  function downloadErrors(current: PurchaseImportPreview) {
    downloadCsv(
      'nebrax-purchases-import-errors',
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

  // الوحدة فاتورة: `processed_rows` بعد الاكتمال = الفواتير المنجزة تراكمياً (`apply_result` يحمل قطعة التنفيذ الأخيرة وحدها).
  const createdCount = engine.job?.processed_rows ?? (engine.job?.apply_result as { created?: number } | null | undefined)?.created ?? 0;
  // معاينةٌ استُهلك ربطها (تشغيلة انتهت): لا تنفيذ ثانٍ منها — تُعاد المعاينة لتشغيلة جديدة.
  const jobTerminal = engine.job !== null && ['failed', 'completed', 'cancelled'].includes(engine.job.status);
  // تشغيلة من مجالٍ آخر (رابط ?job= يدوي) لا تُعرَض ولا تُنفَّذ من هذه الشاشة في أي خطوة: المحرّك المشترك ينفّذ المعرّف الممرَّر دون فحص مجاله.
  const wrongDomainJob = engine.job !== null && engine.job.domain !== 'purchase_import';
  const view = wrongDomainJob ? -1 : step;
  const failedAfterPartial = engine.job?.status === 'failed' && (engine.job.processed_rows ?? 0) > 0;
  const visibleUnits = preview ? (unitsExpanded ? preview.units : preview.units.slice(0, UNITS_COLLAPSED)) : [];

  return (
    <div className="space-y-4 pb-24 lg:pb-0">
      <header className="flex flex-wrap items-start gap-3">
        <Button asChild variant="ghost" size="icon" aria-label={t('back')}>
          <Link href="/purchases">
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
            <DocumentCenterEntryLink kind="purchase" />
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
                  <p className="mt-1 text-xs text-muted">{t('file_hint', { rows: PURCHASE_IMPORT_ROW_LIMIT })}</p>
                  <div className="mt-3">
                    <Label htmlFor="purchase-import-file" className="sr-only">{t('step_file')}</Label>
                    <Input
                      id="purchase-import-file"
                      ref={fileInput}
                      type="file"
                      accept={ACCEPTED_PURCHASE_IMPORT_TYPES}
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
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="pi-supplier">{t('default_supplier')}</Label>
                    <Select id="pi-supplier" value={defaultSupplierId} onChange={(event) => { setDefaultSupplierId(event.target.value); invalidatePreview(); }}>
                      <option value="">{t('default_supplier_none')}</option>
                      {suppliers.map((supplier) => (
                        <option key={supplier.id} value={supplier.id}>{supplier.code ? `${supplier.code} — ${supplier.name}` : supplier.name}</option>
                      ))}
                    </Select>
                    <p className="text-xs leading-relaxed text-muted">{t('default_supplier_hint')}</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pi-payment">{t('default_payment')}</Label>
                    <Select id="pi-payment" value={defaultPayment} onChange={(event) => { setDefaultPayment(event.target.value as PurchasePaymentType | ''); invalidatePreview(); }}>
                      <option value="">{t('tenant_default')}</option>
                      {PURCHASE_PAYMENT_TYPES.map((type) => (
                        <option key={type} value={type}>{t(`payment_${type}`)}</option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pi-warehouse">{t('warehouse')}</Label>
                    <Select id="pi-warehouse" value={warehouseId} onChange={(event) => { setWarehouseId(event.target.value); invalidatePreview(); }}>
                      <option value="">{t('warehouse_none')}</option>
                      {warehouses.map((warehouse) => (
                        <option key={warehouse.id} value={warehouse.id}>{warehouse.code ? `${warehouse.code} — ${warehouse.name}` : warehouse.name}</option>
                      ))}
                    </Select>
                    <p className="text-xs leading-relaxed text-muted">{t('warehouse_hint')}</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pi-tax">{t('default_tax')}</Label>
                    <Input
                      id="pi-tax"
                      inputMode="numeric"
                      value={defaultTax}
                      placeholder={t('tenant_default')}
                      aria-invalid={!taxValid}
                      aria-describedby={taxValid ? undefined : 'pi-tax-error'}
                      onChange={(event: ChangeEvent<HTMLInputElement>) => { setDefaultTax(event.target.value); invalidatePreview(); }}
                      className="num"
                    />
                    {!taxValid ? <p id="pi-tax-error" role="alert" className="text-xs text-negative">{t('default_tax_invalid')}</p> : <p className="text-xs leading-relaxed text-muted">{t('default_tax_hint')}</p>}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pi-inclusive">{t('tax_inclusive')}</Label>
                    <Select id="pi-inclusive" value={taxInclusive} onChange={(event) => { setTaxInclusive(event.target.value as TriState); invalidatePreview(); }}>
                      <option value="">{t('tenant_default')}</option>
                      <option value="no">{t('inclusive_no')}</option>
                      <option value="yes">{t('inclusive_yes')}</option>
                    </Select>
                    <p className="text-xs leading-relaxed text-muted">{t('tax_inclusive_hint')}</p>
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
                      onClick={() => { setMapping(suggestedPurchaseMapping(inspection.columns)); invalidatePreview(); }}
                    >
                      {t('mapping_reset')}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {gaps.missingRequired.length > 0 ? (
                    <p role="alert" className="rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-sm text-negative">
                      {t('mapping_missing_required', { fields: gaps.missingRequired.map((field) => purchaseFieldLabel(field, locale)).join(locale.startsWith('ar') ? '، ' : ', ') })}
                    </p>
                  ) : null}
                  {gaps.missingSupplier ? (
                    <p role="alert" className="rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-sm text-negative">{t('mapping_missing_supplier')}</p>
                  ) : null}
                  {gaps.missingProduct ? (
                    <p role="alert" className="rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-sm text-negative">{t('mapping_missing_product')}</p>
                  ) : null}
                  {gaps.duplicate ? (
                    <p role="alert" className="rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-sm text-negative">{t('mapping_duplicate')}</p>
                  ) : null}
                  <p className="text-xs leading-relaxed text-muted">{t('mapping_note')}</p>
                  <MappingPresetBar domain="purchase_import" columns={inspection.columns} mapping={mapping} fieldKeys={fields.map((item) => item.key)} onApply={(next) => { setMapping(next); invalidatePreview(); }} />
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
                                <Label htmlFor={`pi-map-${column.index}`} className="sr-only">{column.header || t('mapping_column', { n: column.index + 1 })}</Label>
                                <Select id={`pi-map-${column.index}`} value={selected} onChange={(event) => updateMapping(column.index, event.target.value)} className="min-w-44">
                                  <option value="">{t('mapping_ignore')}</option>
                                  {fields.map((item) => (
                                    <option key={item.key} value={item.key}>{purchaseFieldLabel(item, locale)}</option>
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
            <CardTitle>{t('step_preview')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(
                [
                  ['create', String(preview.create_units)],
                  ['total', formatMinorRiyal(preview.create_total_minor)],
                  ['warning', String(preview.warning_units)],
                  ['error', String(preview.error_units)],
                ] as const
              ).map(([key, value]) => (
                <div key={key} className="rounded-md border border-border bg-background px-3 py-2">
                  <dt className="text-xs text-muted">{t(`count_${key}`)}</dt>
                  <dd className={cn('num mt-0.5 text-lg font-semibold', key === 'error' && preview.error_units > 0 ? 'text-negative' : 'text-text')}>{value}</dd>
                </div>
              ))}
            </dl>
            <p className="text-xs leading-relaxed text-muted">{t('preview_drafts_note', { rows: preview.total_rows, invoices: preview.total_units })}</p>
            {preview.default_tax_rate != null || preview.tax_inclusive != null || preview.default_payment_type ? (
              <p className="rounded-md border border-border bg-background px-3 py-2 text-xs leading-relaxed text-text" data-testid="applied-settings">
                {t('applied_settings', {
                  tax: preview.default_tax_rate ?? '—',
                  prices: preview.tax_inclusive == null ? '—' : t(preview.tax_inclusive ? 'inclusive_yes' : 'inclusive_no'),
                  payment: preview.default_payment_type ? t(`payment_${preview.default_payment_type}`) : '—',
                })}
              </p>
            ) : null}

            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="bg-background text-muted">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-start font-medium">{t('col_invoice')}</th>
                    <th scope="col" className="px-3 py-2 text-start font-medium">{t('col_supplier')}</th>
                    <th scope="col" className="px-3 py-2 text-start font-medium">{t('col_date')}</th>
                    <th scope="col" className="px-3 py-2 text-start font-medium">{t('col_lines')}</th>
                    <th scope="col" className="px-3 py-2 text-start font-medium">{t('col_total')}</th>
                    <th scope="col" className="px-3 py-2 text-start font-medium">{t('col_status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleUnits.map((unit) => (
                    <tr key={unit.row} className="border-t border-border align-top">
                      <td className="px-3 py-2 font-medium text-text" dir="auto">{unit.supplier_invoice_ref ?? '—'}</td>
                      <td className="px-3 py-2 text-muted" dir="auto">{unit.supplier_code ?? '—'}</td>
                      <td className="num px-3 py-2 text-muted">{unit.date ?? '—'}</td>
                      <td className="num px-3 py-2 text-muted">{unit.lines}</td>
                      <td className="num px-3 py-2 text-text">{formatMinorRiyal(unit.total_minor)}</td>
                      <td className="px-3 py-2">
                        <Badge tone={unit.status === 'ok' ? 'positive' : unit.status === 'warning' ? 'warning' : 'negative'}>{t(`status_${unit.status}`)}</Badge>
                        {unit.messages.length > 0 ? <p className="mt-1 text-xs leading-relaxed text-negative">{unit.messages.join(' — ')}</p> : null}
                        {unit.warnings.length > 0 ? <p className="mt-1 text-xs leading-relaxed text-warning">{unit.warnings.join(' — ')}</p> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.units.length > UNITS_COLLAPSED ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => setUnitsExpanded((value) => !value)}>
                {unitsExpanded ? t('units_show_less') : t('units_show_more', { count: preview.units.length })}
              </Button>
            ) : null}
            {preview.units_truncated ? <p className="text-xs text-muted">{t('units_truncated', { shown: preview.units_shown, total: preview.total_units })}</p> : null}

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

            {preview.error_units > 0 ? (
              <p role="alert" className="rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-sm text-negative">{t('fix_errors')}</p>
            ) : null}
            {jobTerminal ? <p role="status" className="text-xs leading-relaxed text-muted">{t('preview_used')}</p> : null}

            <FormActions
              secondary={<Button type="button" variant="outline" onClick={() => setStep(0)}>{t('back_to_setup')}</Button>}
              primary={
                <Button disabled={preview.error_units > 0 || !preview.binding || previewing || jobTerminal} onClick={() => void confirmAndApply()}>
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
              atomic={false}
              networkUncertain={engine.networkUncertain}
              cancelling={engine.busy === 'cancelling'}
              onCancel={engine.job ? () => void engine.cancel(engine.job!.id) : undefined}
              onOpenParent={(parentId) => void engine.resume(parentId)}
            />
            {failedAfterPartial ? (
              <p role="status" className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs leading-relaxed text-text">
                {t('partial_failure_note', { count: engine.job?.processed_rows ?? 0 })}
              </p>
            ) : null}
            {engine.job.status === 'failed' ? (
              <FormActions primary={<Button variant="outline" onClick={reset}>{t('start_another')}</Button>} />
            ) : null}
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
                  <Link href="/purchases">{t('back_to_purchases')}</Link>
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
