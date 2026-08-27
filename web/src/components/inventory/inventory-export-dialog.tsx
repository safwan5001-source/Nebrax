'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { ApiError, downloadFile } from '@/lib/api';
import {
  inventoryExportQuery,
  type InventoryExportFormat,
  type InventoryExportScope,
  type InventoryExportState,
} from '@/modules/inventory/export-contract';
import { cn } from '@/lib/utils';

/**
 * حوار تصدير أرصدة المخزون.
 *
 * **لا يُبنى الملف هنا.** الشاشة تفلتر في المتصفح، فبناء الملف من صفوفها كان
 * يصدّر الصفحة المرئية ويسمّيها «كل النتائج». الحوار يمرّر مرشّحات الشاشة إلى
 * `GET /inventory/export` فيبنيها الخادم — مصدر الحقيقة الوحيد.
 */
export function InventoryExportDialog({
  open,
  onClose,
  state,
  filteredCount,
  totalCount,
}: {
  open: boolean;
  onClose: () => void;
  /** حالة المرشّحات الحالية للشاشة — مصدر «النتائج الحالية». */
  state: InventoryExportState;
  filteredCount: number;
  totalCount: number;
}) {
  const t = useTranslations('inventory');
  const locale = useLocale();
  const { toast, success, error } = useToast();
  const [scope, setScope] = useState<InventoryExportScope>('filtered');
  const [format, setFormat] = useState<InventoryExportFormat>('xlsx');
  const [includeZero, setIncludeZero] = useState(true);
  const [working, setWorking] = useState(false);

  const scopes: { value: InventoryExportScope; label: string; hint: string }[] = [
    { value: 'filtered', label: t('export_scope_filtered'), hint: t('export_scope_filtered_hint', { count: filteredCount }) },
    { value: 'all', label: t('export_scope_all'), hint: t('export_scope_all_hint', { count: totalCount }) },
  ];

  async function run() {
    setWorking(true);
    try {
      const query = inventoryExportQuery(state, { scope, format, includeZero, locale });
      const outcome = await downloadFile(`/inventory/export?${query}`, `nebrax-inventory-balances.${format}`);

      // وضع المعاينة لا يتصل بخادم فلا ملف يُنزَّل. إعلان النجاح هنا كذبٌ صريح.
      if (outcome === 'demo-unavailable') {
        toast({ title: t('export_demo_unavailable'), variant: 'info' });
        return;
      }

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
              <input
                type="radio"
                name="inventory-export-scope"
                value={option.value}
                checked={scope === option.value}
                aria-label={option.label}
                aria-describedby={`inv-export-scope-${option.value}-hint`}
                onChange={() => setScope(option.value)}
                className="mt-0.5 h-4 w-4 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-text">{option.label}</span>
                <span id={`inv-export-scope-${option.value}-hint`} className="mt-0.5 block text-xs leading-relaxed text-muted">
                  {option.hint}
                </span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="space-y-1.5">
          <Label htmlFor="inventory-export-format">{t('export_format')}</Label>
          <Select
            id="inventory-export-format"
            value={format}
            onChange={(event) => setFormat(event.target.value as InventoryExportFormat)}
          >
            <option value="xlsx">{t('export_format_xlsx')}</option>
            <option value="csv">{t('export_format_csv')}</option>
          </Select>
        </div>

        <div className="flex items-start justify-between gap-3 rounded-md border border-border p-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-text">{t('export_include_zero')}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">{t('export_include_zero_hint')}</p>
          </div>
          <Switch checked={includeZero} onCheckedChange={setIncludeZero} aria-label={t('export_include_zero')} />
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
