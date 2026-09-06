'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { SettingsHeader } from '@/components/inventory-settings/settings-header';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

interface InventorySettings {
  allow_negative_stock: boolean;
  detailed_tracking_enabled: boolean;
  show_stock_quantities: boolean;
  restock_sales_returns: boolean;
  low_stock_notifications_enabled: boolean;
  out_of_stock_notifications_enabled: boolean;
}

/**
 * إعدادات المخزون والمنتجات — سياسة تشغيلية بأثر محاسبي مباشر، لا تفضيل شكلي.
 *
 * **الخياران في «المخزون السالب» يمثّلان حقلاً ثنائياً واحداً** لا ثلاثياً:
 * `allow_negative_stock`. عرضُهما خيارين هو الصياغة المفهومة للمستخدم، ودلالة
 * «السماح للمتابَع كمّياً» تكتمل تلقائياً حين يُبنى التتبع التفصيلي — انظر
 * التعليق في `App\Support\Settings`.
 */
export default function InventorySettingsPage() {
  const t = useTranslations('inventorySettings');
  const tc = useTranslations('common');
  const { success } = useToast();

  const [form, setForm] = useState<InventorySettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<{ data: InventorySettings }>('/inventory-settings')
      .then((r) => setForm(r.data))
      .catch(() => {});
  }, []);

  const set = <K extends keyof InventorySettings>(key: K, value: InventorySettings[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));

  async function submit() {
    if (!form) return;
    setSaving(true);
    setError(null);
    try {
      // `detailed_tracking_enabled` لا يُرسَل: الخادم يرفض تفعيله، والتوگل معطّل.
      await api('/inventory-settings', {
        method: 'PUT',
        body: {
          allow_negative_stock: form.allow_negative_stock,
          show_stock_quantities: form.show_stock_quantities,
          restock_sales_returns: form.restock_sales_returns,
          low_stock_notifications_enabled: form.low_stock_notifications_enabled,
          out_of_stock_notifications_enabled: form.out_of_stock_notifications_enabled,
        },
      });
      success(tc('updated'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  if (!form) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full max-w-3xl" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <SettingsHeader title={t('c_products_t')} subtitle={t('c_products_d')} />

      {/* ═══ تتبع المنتجات — معطّل حتى تُبنى القدرة ═══ */}
      <Card className="max-w-3xl">
        <CardHeader><CardTitle>{t('tracking')}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-muted">{t('detailed_tracking')}</span>
                <Badge tone="muted">{t('soon')}</Badge>
              </div>
              <p className="text-xs leading-relaxed text-muted">{t('detailed_tracking_hint')}</p>
            </div>
            <Switch
              checked={form.detailed_tracking_enabled}
              onCheckedChange={() => {}}
              disabled
              aria-label={t('detailed_tracking')}
            />
          </div>
        </CardContent>
      </Card>

      {/* ═══ المخزون السالب — الحقل الوحيد ذو الأثر المحاسبي ═══ */}
      <Card className="max-w-3xl">
        <CardHeader><CardTitle>{t('negative_stock')}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div role="radiogroup" aria-label={t('negative_stock')} className="space-y-2.5">
            <PolicyOption
              selected={!form.allow_negative_stock}
              onSelect={() => set('allow_negative_stock', false)}
              title={t('policy_block_all')}
              hint={t('policy_block_all_hint')}
            />
            <PolicyOption
              selected={form.allow_negative_stock}
              onSelect={() => set('allow_negative_stock', true)}
              title={t('policy_allow_quantity')}
              hint={t('policy_allow_quantity_hint')}
            />
          </div>

          <p className="text-xs leading-relaxed text-muted">{t('negative_stock_hint')}</p>

          {form.allow_negative_stock && (
            <p className="rounded border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning">
              {t('allow_warning')}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ═══ عرض الكميات ═══ */}
      <Card className="max-w-3xl">
        <CardHeader><CardTitle>{t('quantities')}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <span className="text-sm font-medium text-text">{t('show_stock_quantities')}</span>
              <p className="text-xs leading-relaxed text-muted">{t('show_stock_quantities_hint')}</p>
            </div>
            <Switch
              checked={form.show_stock_quantities}
              onCheckedChange={(v) => set('show_stock_quantities', v)}
              aria-label={t('show_stock_quantities')}
            />
          </div>

          {/* آلية التحقق عند البيع: معطّلة — لا مفهوم «محجوز» في النظام بعد. */}
          <div className="rounded border border-border p-3 opacity-60">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-muted">{t('total_in_stock')}</span>
              <Badge tone="muted">{t('soon')}</Badge>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted">{t('total_in_stock_hint')}</p>
          </div>
        </CardContent>
      </Card>


      {/* ═══ مردود المبيعات ═══ */}
      {/* **سياسة عمل لا قاعدة محاسبية.** وإعادةُ التالف تُفسد المتوسط المتحرك
          فتخرج كل تكلفة بضاعة مباعة لاحقة خاطئة — أثرٌ يتعدّى المستند. */}
      <Card className="max-w-3xl">
        <CardHeader><CardTitle>{t('returns')}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <span className="text-sm font-medium text-text">{t('restock_sales_returns')}</span>
              <p className="text-xs leading-relaxed text-muted">{t('restock_sales_returns_hint')}</p>
            </div>
            <Switch
              checked={form.restock_sales_returns}
              onCheckedChange={(v) => set('restock_sales_returns', v)}
              aria-label={t('restock_sales_returns')}
            />
          </div>

          {!form.restock_sales_returns && (
            <p className="rounded border border-border bg-background p-3 text-xs leading-relaxed text-muted">
              {t('restock_off_note')}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ═══ إشعارات المخزون (PR-NOTIF-3) ═══ */}
      {/* تعيد استخدام `products.reorder_level` القائم حصراً — لا عتبة جديدة هنا. */}
      <Card className="max-w-3xl">
        <CardHeader><CardTitle>{t('stock_notifications')}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <span className="text-sm font-medium text-text">{t('low_stock_notifications')}</span>
              <p className="text-xs leading-relaxed text-muted">{t('low_stock_notifications_hint')}</p>
            </div>
            <Switch
              checked={form.low_stock_notifications_enabled}
              onCheckedChange={(v) => set('low_stock_notifications_enabled', v)}
              aria-label={t('low_stock_notifications')}
            />
          </div>

          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <span className="text-sm font-medium text-text">{t('out_of_stock_notifications')}</span>
              <p className="text-xs leading-relaxed text-muted">{t('out_of_stock_notifications_hint')}</p>
            </div>
            <Switch
              checked={form.out_of_stock_notifications_enabled}
              onCheckedChange={(v) => set('out_of_stock_notifications_enabled', v)}
              aria-label={t('out_of_stock_notifications')}
            />
          </div>
        </CardContent>
      </Card>

      {error && (
        <p className="max-w-3xl rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>
      )}

      <div className="flex max-w-3xl justify-end">
        <Button onClick={submit} disabled={saving}>{t('save')}</Button>
      </div>
    </div>
  );
}

/** خيار سياسة: بطاقة قابلة للنقر بدور `radio` — تعمل بلوحة المفاتيح أيضاً. */
function PolicyOption({
  selected, onSelect, title, hint,
}: { selected: boolean; onSelect: () => void; title: string; hint: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'flex w-full items-start gap-3 rounded border p-3 text-start transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        selected ? 'border-primary bg-primary-soft' : 'border-border hover:border-muted'
      )}
    >
      <span
        aria-hidden
        className={cn(
          'mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border',
          selected ? 'border-primary' : 'border-border'
        )}
      >
        {selected && <span className="h-2 w-2 rounded-full bg-primary" />}
      </span>
      <span className="space-y-1">
        <span className={cn('block text-sm font-medium', selected ? 'text-primary' : 'text-text')}>{title}</span>
        <span className="block text-xs leading-relaxed text-muted">{hint}</span>
      </span>
    </button>
  );
}
