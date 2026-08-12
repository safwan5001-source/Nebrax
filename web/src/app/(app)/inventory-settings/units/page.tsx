'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { SettingsHeader } from '@/components/inventory-settings/settings-header';
import { api, ApiError } from '@/lib/api';

interface Unit { name: string; factor: number }
interface Template {
  id: string;
  name: string;
  base_unit: string;
  units: Unit[];
  products_count?: number;
}

/** سطر تحرير: المعامل نصّ ليقبل الحقل الفراغ أثناء الكتابة. */
interface DraftUnit { key: string; name: string; factor: string }
let seq = 0;
const newUnit = (): DraftUnit => ({ key: `u${++seq}`, name: '', factor: '' });

/**
 * قوالب الوحدات — وحدة أساس ووحدات بديلة بمعاملات صحيحة.
 *
 * **وحدة الأساس هي وحدة المخزون**: كل كمية في الدفتر بها. والمعامل يضرب
 * الكمية الداخلة، فتغييره لاحقاً **لا يمسّ مستنداً مرحَّلاً** — السطر نسخ
 * معامله وقت الإنشاء.
 */
export default function UnitTemplatesPage() {
  const t = useTranslations('inventorySettings');
  const tc = useTranslations('common');
  const { success } = useToast();

  const [rows, setRows] = useState<Template[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState('');
  const [baseUnit, setBaseUnit] = useState('');
  const [units, setUnits] = useState<DraftUnit[]>([newUnit()]);
  const [editing, setEditing] = useState<Template | null>(null);

  const load = useCallback(() => {
    api<{ data: Template[] }>('/unit-templates')
      .then((r) => setRows(r.data))
      .catch(() => setRows([]));
  }, []);

  useEffect(() => load(), [load]);

  function reset() {
    setEditing(null);
    setName('');
    setBaseUnit('');
    setUnits([newUnit()]);
  }

  function edit(row: Template) {
    setEditing(row);
    setName(row.name);
    setBaseUnit(row.base_unit);
    setUnits(row.units.length
      ? row.units.map((u) => ({ key: `u${++seq}`, name: u.name, factor: String(u.factor) }))
      : [newUnit()]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !baseUnit.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const body = {
        name: name.trim(),
        base_unit: baseUnit.trim(),
        // السطور الفارغة تُهمَل — لا يُرسَل معاملٌ بلا اسم فيُرفض الطلب كلّه.
        units: units
          .filter((u) => u.name.trim() && Number(u.factor) > 0)
          .map((u) => ({ name: u.name.trim(), factor: Number(u.factor) })),
      };
      if (editing) {
        await api(`/unit-templates/${editing.id}`, { method: 'PUT', body });
      } else {
        await api('/unit-templates', { method: 'POST', body });
      }
      success(tc('updated'));
      reset();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: Template) {
    setError(null);
    try {
      await api(`/unit-templates/${row.id}`, { method: 'DELETE' });
      success(tc('updated'));
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    }
  }

  const setUnit = (key: string, patch: Partial<DraftUnit>) =>
    setUnits((us) => us.map((u) => (u.key === key ? { ...u, ...patch } : u)));

  return (
    <div className="space-y-5">
      <SettingsHeader title={t('c_units_t')} subtitle={t('c_units_d')} />

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>{editing ? t('unit_edit') : t('unit_new')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="tpl-name">{t('unit_template_name')}</Label>
                <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={255} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tpl-base">{t('unit_base')}</Label>
                <Input id="tpl-base" value={baseUnit} onChange={(e) => setBaseUnit(e.target.value)} maxLength={255} />
                <p className="text-xs text-muted">{t('unit_base_hint')}</p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{t('unit_alternatives')}</Label>
                <Button type="button" variant="ghost" size="sm" onClick={() => setUnits((us) => [...us, newUnit()])}>
                  <Plus className="h-4 w-4" strokeWidth={1.7} />
                  {t('unit_add_row')}
                </Button>
              </div>

              {units.map((u) => (
                <div key={u.key} className="grid grid-cols-12 items-center gap-2">
                  <Input
                    className="col-span-6"
                    placeholder={t('unit_row_name')}
                    value={u.name}
                    onChange={(e) => setUnit(u.key, { name: e.target.value })}
                  />
                  <Input
                    className="num col-span-5 text-end"
                    type="number"
                    min={2}
                    placeholder={t('unit_row_factor')}
                    value={u.factor}
                    onChange={(e) => setUnit(u.key, { factor: e.target.value })}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="col-span-1"
                    aria-label={t('delete')}
                    onClick={() => setUnits((us) => (us.length > 1 ? us.filter((x) => x.key !== u.key) : [newUnit()]))}
                  >
                    <Trash2 className="h-4 w-4" strokeWidth={1.7} />
                  </Button>
                </div>
              ))}

              <p className="text-xs leading-relaxed text-muted">
                {t('unit_factor_hint', { base: baseUnit.trim() || t('unit_base_placeholder') })}
              </p>
            </div>

            {error && <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}

            <div className="flex justify-end gap-2">
              {editing && (
                <Button type="button" variant="outline" onClick={reset}>
                  <X className="h-4 w-4" strokeWidth={1.7} />
                  {t('cancel')}
                </Button>
              )}
              <Button type="submit" disabled={busy || !name.trim() || !baseUnit.trim()}>
                {editing ? <Check className="h-4 w-4" strokeWidth={1.7} /> : <Plus className="h-4 w-4" strokeWidth={1.7} />}
                {editing ? t('unit_save') : t('unit_create')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="max-w-3xl">
        <CardHeader><CardTitle>{t('unit_list')}</CardTitle></CardHeader>
        <CardContent>
          {!rows ? (
            <Skeleton className="h-32 w-full" />
          ) : rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">{t('unit_empty')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((row) => (
                <li key={row.id} className="flex items-start gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-text">{row.name}</span>
                      <Badge tone="neutral">{row.base_unit}</Badge>
                      {!!row.products_count && (
                        <Badge tone="muted">{t('cat_products', { count: row.products_count })}</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      {row.units.length === 0
                        ? t('unit_none')
                        : row.units.map((u) => `${u.name} = ${u.factor} ${row.base_unit}`).join(' · ')}
                    </p>
                  </div>
                  <Button variant="ghost" size="icon" aria-label={t('unit_edit')} onClick={() => edit(row)}>
                    <Pencil className="h-4 w-4" strokeWidth={1.7} />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label={t('delete')} onClick={() => remove(row)}>
                    <Trash2 className="h-4 w-4" strokeWidth={1.7} />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
