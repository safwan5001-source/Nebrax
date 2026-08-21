'use client';

import { ChangeEvent, useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowRight, Download, FileSearch, FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { api, ApiError, downloadFile } from '@/lib/api';

type Mode = 'create' | 'update';
type PreviewRow = { row: number; valid: boolean; action: 'create' | 'update'; sku: string | null; name: string | null; type: string; barcode: string | null };
type PreviewError = { row: number; messages: string[] };
type ImportPreview = { mode: Mode; total_rows: number; valid_rows: number; invalid_rows: number; rows: PreviewRow[]; errors: PreviewError[] };
type ImportResult = { mode: Mode; created: number; updated: number; total_rows: number };

export default function ProductImportPage() {
  const t = useTranslations('products');
  const tc = useTranslations('common');
  const { success } = useToast();
  const [mode, setMode] = useState<Mode>('create');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canApply = useMemo(
    () => preview !== null && preview.total_rows > 0 && preview.invalid_rows === 0 && !applying,
    [preview, applying]
  );

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
    setPreview(null);
    setError(null);
  }

  async function buildFormData(): Promise<FormData | null> {
    if (!file) {
      setError(t('import_file_required'));
      return null;
    }
    const formData = new FormData();
    formData.append('file', file);
    formData.append('mode', mode);
    return formData;
  }

  async function previewImport() {
    const formData = await buildFormData();
    if (!formData) return;
    setLoading(true);
    setError(null);
    try {
      const response = await api<{ data: ImportPreview }>('/products/import/preview', { method: 'POST', body: formData });
      setPreview(response.data);
    } catch (err) {
      setPreview(null);
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setLoading(false);
    }
  }

  async function applyImport() {
    const formData = await buildFormData();
    if (!formData || !canApply) return;
    setApplying(true);
    setError(null);
    try {
      const response = await api<{ data: ImportResult }>('/products/import/apply', { method: 'POST', body: formData });
      success(t('import_success', { created: response.data.created, updated: response.data.updated }));
      setPreview(null);
      setFile(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/products">
          <Button variant="ghost" size="icon" aria-label={t('back')}>
            <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
          </Button>
        </Link>
        <div>
          <h1 className="text-xl font-semibold text-text">{t('import_title')}</h1>
          <p className="mt-1 text-sm text-muted">{t('import_subtitle')}</p>
        </div>
        <div className="ms-auto">
          <Button variant="outline" onClick={() => downloadFile('/products/import/template', 'nebrax-products-import-template.csv')}>
            <Download className="h-4 w-4" strokeWidth={1.7} />
            {t('import_template')}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Upload className="h-4 w-4 text-primary" strokeWidth={1.7} />{t('import_upload_title')}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="import-mode">{t('import_mode')}</Label>
                <Select id="import-mode" value={mode} onChange={(event) => { setMode(event.target.value as Mode); setPreview(null); }}>
                  <option value="create">{t('import_mode_create')}</option>
                  <option value="update">{t('import_mode_update')}</option>
                </Select>
                <p className="text-xs text-muted">{t(mode === 'create' ? 'import_mode_create_hint' : 'import_mode_update_hint')}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="import-file">{t('import_file')}</Label>
                <Input id="import-file" type="file" accept=".csv,text/csv" onChange={onFileChange} />
                <p className="text-xs text-muted">{t('import_file_hint')}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
              <Button disabled={loading || !file} onClick={previewImport}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.7} /> : <FileSearch className="h-4 w-4" strokeWidth={1.7} />}
                {t('import_preview')}
              </Button>
              {file && <span className="max-w-full truncate text-xs text-muted" dir="ltr">{file.name}</span>}
            </div>
            {error && <p role="alert" className="rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-sm text-negative">{error}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><FileSpreadsheet className="h-4 w-4 text-muted" strokeWidth={1.7} />{t('import_help_title')}</CardTitle></CardHeader>
          <CardContent>
            <ol className="space-y-3 text-sm text-muted">
              <li><span className="font-medium text-text">1. </span>{t('import_help_1')}</li>
              <li><span className="font-medium text-text">2. </span>{t('import_help_2')}</li>
              <li><span className="font-medium text-text">3. </span>{t('import_help_3')}</li>
              <li><span className="font-medium text-text">4. </span>{t('import_help_4')}</li>
            </ol>
          </CardContent>
        </Card>
      </div>

      {preview && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-3">
              <CardTitle>{t('import_preview_title')}</CardTitle>
              <div className="ms-auto flex flex-wrap gap-2 text-xs text-muted">
                <span className="rounded-md bg-primary-soft px-2 py-1">{t('import_total', { count: preview.total_rows })}</span>
                <span className="rounded-md bg-primary-soft px-2 py-1">{t('import_valid', { count: preview.valid_rows })}</span>
                <span className="rounded-md bg-primary-soft px-2 py-1">{t('import_invalid', { count: preview.invalid_rows })}</span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {preview.errors.length > 0 && (
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full min-w-[36rem] text-sm">
                  <thead className="bg-background text-muted"><tr><th className="px-3 py-2 text-start font-medium">{t('import_row')}</th><th className="px-3 py-2 text-start font-medium">{t('import_errors')}</th></tr></thead>
                  <tbody>{preview.errors.map((item) => <tr key={item.row} className="border-t border-border align-top"><td className="num px-3 py-2 text-text">{item.row}</td><td className="px-3 py-2 text-negative">{item.messages.join(' — ')}</td></tr>)}</tbody>
                </table>
              </div>
            )}

            {preview.rows.length > 0 && (
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full min-w-[42rem] text-sm">
                  <thead className="bg-background text-muted"><tr><th className="px-3 py-2 text-start font-medium">{t('import_row')}</th><th className="px-3 py-2 text-start font-medium">{t('sku')}</th><th className="px-3 py-2 text-start font-medium">{t('name')}</th><th className="px-3 py-2 text-start font-medium">{t('type')}</th><th className="px-3 py-2 text-start font-medium">{t('import_action')}</th></tr></thead>
                  <tbody>{preview.rows.map((row) => <tr key={row.row} className="border-t border-border"><td className="num px-3 py-2">{row.row}</td><td className="num px-3 py-2 text-muted">{row.sku ?? '—'}</td><td className="px-3 py-2 text-text">{row.name ?? '—'}</td><td className="px-3 py-2">{t(row.type === 'service' ? 'service' : 'good')}</td><td className="px-3 py-2 text-muted">{t(row.action === 'update' ? 'import_update_action' : 'import_create_action')}</td></tr>)}</tbody>
                </table>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <p className="text-sm text-muted">{preview.invalid_rows > 0 ? t('import_fix_errors') : t('import_ready')}</p>
              <Button disabled={!canApply} onClick={applyImport}>
                {applying ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.7} /> : <Upload className="h-4 w-4" strokeWidth={1.7} />}
                {t('import_apply')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
