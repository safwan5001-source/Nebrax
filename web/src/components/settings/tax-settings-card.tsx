'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';

/** صيغة التخزين (API): النسبة رقم. */
interface Tax { name: string; rate: number; inclusive: boolean }
/** صيغة التحرير المحلّية: النسبة نصّ لتسهيل الإدخال. */
interface Row { name: string; rate: string; inclusive: boolean }

/**
 * إعدادات الضرائب — تعريف الضرائب (الاسم، النسبة %، متضمَّن في السعر أم لا).
 * تُخزَّن كتفضيل غير محاسبي عبر `sales-config/taxes` (لا تمسّ محرّك القيود).
 */
export function TaxSettingsCard({ canManage }: { canManage: boolean }) {
  const t = useTranslations('taxSettings');
  const { success, error: errorToast } = useToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<{ data: Tax[] }>('/sales-config/taxes')
      .then((r) => setRows(r.data.map((x) => ({ name: x.name, rate: String(x.rate), inclusive: !!x.inclusive }))))
      .catch(() => setRows([]));
  }, []);

  const patch = (i: number, p: Partial<Row>) =>
    setRows((rs) => rs!.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const add = () => setRows((rs) => [...(rs ?? []), { name: '', rate: '0', inclusive: false }]);
  const remove = (i: number) => setRows((rs) => rs!.filter((_, j) => j !== i));

  async function save() {
    if (!rows) return;
    // تطبيع: اسم غير فارغ، ونسبة صحيحة ضمن 0..100 (بلا كسور).
    const clean: Tax[] = rows
      .map((r) => ({
        name: r.name.trim(),
        rate: Math.max(0, Math.min(100, Math.round(Number(r.rate) || 0))),
        inclusive: !!r.inclusive,
      }))
      .filter((r) => r.name !== '');
    setSaving(true);
    try {
      await api('/sales-config/taxes', { method: 'PUT', body: { data: clean } });
      setRows(clean.map((x) => ({ name: x.name, rate: String(x.rate), inclusive: x.inclusive })));
      success(t('saved'));
    } catch {
      errorToast(t('save_failed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{t('title')}</CardTitle>
        {canManage && rows && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={add}>
              <Plus className="h-4 w-4" strokeWidth={1.8} />
              {t('add')}
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? t('saving') : t('save')}
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-muted">{t('hint')}</p>
        {!rows ? (
          <Skeleton className="h-24 w-full" />
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">{t('empty')}</p>
        ) : (
          <div className="space-y-2">
            <div className="hidden grid-cols-[1fr_96px_150px_40px] gap-2 px-1 text-xs font-medium text-muted sm:grid">
              <div>{t('name')}</div>
              <div className="text-end">{t('rate')}</div>
              <div>{t('inclusive_col')}</div>
              <div />
            </div>
            {rows.map((row, i) => (
              <div
                key={i}
                className="grid grid-cols-2 items-center gap-2 rounded-lg border border-border p-2 sm:grid-cols-[1fr_96px_150px_40px] sm:border-0 sm:p-0"
              >
                <Input
                  value={row.name}
                  disabled={!canManage}
                  onChange={(e) => patch(i, { name: e.target.value })}
                  placeholder={t('name')}
                />
                <div className="relative">
                  <Input
                    className="num pe-7 text-end"
                    type="number"
                    min={0}
                    max={100}
                    disabled={!canManage}
                    value={row.rate}
                    onChange={(e) => patch(i, { rate: e.target.value })}
                  />
                  <span className="pointer-events-none absolute inset-y-0 end-2 flex items-center text-xs text-muted">%</span>
                </div>
                <Select
                  value={row.inclusive ? '1' : '0'}
                  disabled={!canManage}
                  onChange={(e) => patch(i, { inclusive: e.target.value === '1' })}
                >
                  <option value="0">{t('exclusive')}</option>
                  <option value="1">{t('inclusive')}</option>
                </Select>
                {canManage ? (
                  <Button variant="ghost" size="icon" aria-label={t('remove')} onClick={() => remove(i)}>
                    <Trash2 className="h-4 w-4 text-negative" strokeWidth={1.7} />
                  </Button>
                ) : (
                  <div />
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
