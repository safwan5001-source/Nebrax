'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { ApiError, downloadFile } from '@/lib/api';
import type { ExportFormat, ExportScope, ExportTemplate } from '@/modules/products/import/contract';
import { cn } from '@/lib/utils';

/**
 * حوار تصدير المنتجات.
 *
 * **لا يُبنى الملف هنا.** الصفحة مقسَّمة خادمياً، فبناء CSV من صفوف الجدول
 * المحمَّلة كان يصدّر الصفحة الحالية ويسمّيها «كل النتائج». الحوار يمرّر
 * مرشّحات القائمة نفسها إلى `GET /products/export` بلا `page`/`per_page`.
 */
export function ProductExportDialog({
  open,
  onClose,
  filterQuery,
  selectedIds,
  filteredTotal,
}: {
  open: boolean;
  onClose: () => void;
  /** سلسلة استعلام تحمل مرشّحات القائمة وفرزها — بلا معاملات التقسيم. */
  filterQuery: string;
  selectedIds: string[];
  filteredTotal: number;
}) {
  const t = useTranslations('products');
  const { success, error } = useToast();
  const [scope, setScope] = useState<ExportScope>('filtered');
  const [template, setTemplate] = useState<ExportTemplate>('catalog');
  const [format, setFormat] = useState<ExportFormat>('xlsx');
  const [working, setWorking] = useState(false);

  const hasSelection = selectedIds.length > 0;

  useEffect(() => {
    // نطاق «المحدد» لا يُعرض خياراً صالحاً بلا تحديد فعلي.
    if (!hasSelection && scope === 'selected') setScope('filtered');
  }, [hasSelection, scope]);

  const scopes = useMemo(
    () =>
      (['selected', 'filtered', 'all'] as ExportScope[])
        .filter((value) => value !== 'selected' || hasSelection)
        .map((value) => ({
          value,
          label: t(`export_scope_${value}` as 'export_scope_all'),
          hint: t(`export_scope_${value}_hint` as 'export_scope_all_hint', {
            count: value === 'selected' ? selectedIds.length : filteredTotal,
          }),
        })),
    [filteredTotal, hasSelection, selectedIds.length, t]
  );

  async function run() {
    setWorking(true);
    try {
      const params = new URLSearchParams(scope === 'filtered' ? filterQuery : '');
      params.set('scope', scope);
      params.set('format', format);
      params.set('template', template);
      if (scope === 'selected') selectedIds.forEach((id) => params.append('ids[]', id));

      await downloadFile(`/products/export?${params.toString()}`, `nebrax-products.${format}`);
      success(t('export_success'));
      onClose();
    } catch (err) {
      error(err instanceof ApiError ? err.message : t('export_failed'));
    } finally {
      setWorking(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t('export_title')}>
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-muted">{t('export_subtitle')}</p>

        <fieldset className="space-y-2">
          <legend className="mb-1.5 text-sm font-medium text-text">{t('export_scope')}</legend>
          {scopes.map((option) => (
            <label
              key={option.value}
              className={cn(
                'flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors',
                scope === option.value ? 'border-primary bg-primary-soft' : 'border-border hover:bg-background'
              )}
            >
              {/* الاسم من `aria-label` والشرح من `aria-describedby` — انظر
                  العلّة نفسها في شاشة الاستيراد. */}
              <input
                type="radio"
                name="export-scope"
                value={option.value}
                checked={scope === option.value}
                aria-label={option.label}
                aria-describedby={`export-scope-${option.value}-hint`}
                onChange={() => setScope(option.value)}
                className="mt-0.5 h-4 w-4 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-text">{option.label}</span>
                <span id={`export-scope-${option.value}-hint`} className="mt-0.5 block text-xs leading-relaxed text-muted">
                  {option.hint}
                </span>
              </span>
            </label>
          ))}
          {!hasSelection ? <p className="text-xs text-muted">{t('export_no_selection')}</p> : null}
        </fieldset>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="export-template">{t('export_template')}</Label>
            <Select
              id="export-template"
              value={template}
              onChange={(event) => setTemplate(event.target.value as ExportTemplate)}
            >
              <option value="catalog">{t('export_template_catalog')}</option>
              <option value="round_trip">{t('export_template_round_trip')}</option>
            </Select>
            <p className="text-xs leading-relaxed text-muted">
              {t(template === 'round_trip' ? 'export_template_round_trip_hint' : 'export_template_catalog_hint')}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="export-format">{t('export_format')}</Label>
            <Select
              id="export-format"
              value={format}
              onChange={(event) => setFormat(event.target.value as ExportFormat)}
            >
              <option value="xlsx">{t('export_format_xlsx')}</option>
              <option value="csv">{t('export_format_csv')}</option>
            </Select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <Button onClick={() => void run()} disabled={working}>
            {working ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.7} />
            ) : (
              <Download className="h-4 w-4" strokeWidth={1.7} />
            )}
            {working ? t('export_working') : t('export_submit')}
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={working}>
            {t('cancel')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
