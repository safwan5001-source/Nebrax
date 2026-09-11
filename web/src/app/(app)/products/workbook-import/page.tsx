'use client';

import { ChangeEvent, DragEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AlertTriangle, ArrowRight, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { FormActions } from '@/components/nebrax';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Stepper } from '@/modules/products/import/stepper';
import type { BlankPolicy, ImportMode, MasterDataPolicy } from '@/modules/products/import/contract';
import {
  ACCEPTED_WORKBOOK_TYPES,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  workbookFormData,
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

export default function ProductWorkbookImportPage() {
  const t = useTranslations('productWorkbook');
  const tp = useTranslations('products');
  const tc = useTranslations('common');
  const { success } = useToast();
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
  const canPreview = Boolean(file) && Boolean(priceListId);

  function reset() {
    setStep(0);
    setFile(null);
    setPreview(null);
    setError(null);
    setResumedWithoutFile(false);
    setParam(null);
    engine.reset();
    if (fileInput.current) fileInput.current.value = '';
  }

  function acceptFile(next: File | null) {
    setFile(next);
    setPreview(null);
    setError(null);
    if (!next) return;
    if (next.size > MAX_IMPORT_BYTES) {
      setFile(null);
      setError(t('file_too_large', { limit: Math.round(MAX_IMPORT_BYTES / (1024 * 1024)) }));
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    acceptFile(event.dataTransfer.files?.[0] ?? null);
  }

  async function runPreview() {
    if (!file || !priceListId) return;
    setPreviewing(true);
    setError(null);
    try {
      const response = await api<{ data: WorkbookPreview }>('/products/workbook/preview', {
        method: 'POST',
        body: workbookFormData(file, { priceListId, mode, blankPolicy, masterDataPolicy }),
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
    return { price_list_id: priceListId, mode, blank_policy: blankPolicy, master_data_policy: masterDataPolicy };
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
                  <ul className="mt-2 space-y-1 text-xs leading-relaxed text-negative">
                    {preview[sheet].errors.slice(0, 5).map((issue) => (
                      <li key={issue.row}>
                        {t('sheet_row', { row: issue.row })}: {issue.messages.join(' — ')}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}

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
