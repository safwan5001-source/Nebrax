'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';

interface Series {
  key: string;
  prefix: string | null;
  next_number: string;
}

interface NumberingEntity {
  key: string;
  scope: 'branch' | 'company';
  resets_yearly: boolean;
  format: string;
  padding: number;
  editable_prefix: boolean;
  prefix: string | null;
  series: Series[];
}

/**
 * ═══════════════════════════════════════════════════════════════
 *  إعدادات الترقيم المتسلسل
 * ═══════════════════════════════════════════════════════════════
 *  موضعٌ واحد يُرى منه ترقيم المستندات السبعة عشر.
 *
 *  **تعرض ما تفعله الطبقة، ولا تَعِد بما لا تملكه.** التنسيق وعدد الأرقام
 *  ثابتان في طبقة الترقيم لا إعدادان، والنطاق يقرّره تصنيف النموذج — فتُعرَض
 *  الثلاثة للاطّلاع. والبادئة تُحرَّر حيث تقرؤها الخدمة فعلاً وحدها؛ وحيث لا
 *  تقرؤها يُعطَّل الحقل بنصٍّ يشرح السبب بدل قبولٍ صامتٍ بلا أثر.
 */
export default function NumberingSettingsPage() {
  const t = useTranslations('numberingSettings');
  const tc = useTranslations('common');
  const { success } = useToast();

  const [entities, setEntities] = useState<NumberingEntity[] | null>(null);
  const [selected, setSelected] = useState<string>('invoice');
  const [prefix, setPrefix] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // تبديل النوع يعيد قراءة الحمولة، فيظهر هيكل التحميل بدل قيم النوع السابق.
  const [switching, setSwitching] = useState(false);

  const current = useMemo(
    () => entities?.find((e) => e.key === selected) ?? null,
    [entities, selected]
  );

  async function load(showSwitching = false) {
    if (showSwitching) setSwitching(true);
    try {
      const r = await api<{ data: NumberingEntity[] }>('/numbering-settings');
      setEntities(r.data);
      return r.data;
    } finally {
      setSwitching(false);
    }
  }

  useEffect(() => {
    load().catch(() => {});
  }, []);

  // البادئة المعروضة تتبع النوع المختار.
  useEffect(() => {
    if (current) setPrefix(current.prefix ?? '');
  }, [current]);

  async function onSelect(key: string) {
    setSelected(key);
    setError(null);
    await load(true).catch(() => {});
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!current?.editable_prefix) return;
    setSaving(true);
    setError(null);
    try {
      await api('/numbering-settings', {
        method: 'PUT',
        body: { entity: current.key, prefix: prefix || null },
      });
      await load();
      success(tc('updated'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  const options = (entities ?? []).map((e) => ({
    value: e.key,
    label: t(`entity_${e.key}`),
    sub: e.series.map((s) => s.next_number).join(' · '),
  }));

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold text-text">{t('title')}</h1>

      <Card className="max-w-2xl">
        <CardHeader><CardTitle>{t('picker_title')}</CardTitle></CardHeader>
        <CardContent>
          {!entities ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="entity">{t('document_type')}</Label>
              <Combobox
                id="entity"
                value={selected}
                onChange={onSelect}
                options={options}
                placeholder={t('pick_type')}
                searchPlaceholder={t('search_type')}
                emptyText={t('no_type')}
                aria-label={t('document_type')}
              />
              {/* الالتباس المتوقَّع يُقطع هنا لا في التوثيق. */}
              <p className="text-xs leading-relaxed text-muted">
                {t('excludes_icv')}{' '}
                <Link href="/sales-settings/invoices" className="text-primary hover:underline">
                  {t('excludes_icv_link')}
                </Link>
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {entities && (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>{switching ? t('loading_type') : t(`entity_${selected}`)}</CardTitle>
          </CardHeader>
          <CardContent>
            {switching || !current ? (
              <Skeleton className="h-56 w-full" />
            ) : (
              <form onSubmit={submit} className="space-y-4">
                {/* ═══ السلاسل وأرقامها التالية ═══ */}
                <div className="space-y-1.5">
                  <Label>{t('next_number')}</Label>
                  <div className="divide-y divide-border rounded border border-border">
                    {current.series.map((s) => (
                      <div key={s.key} className="flex items-center justify-between px-3 py-2">
                        <span className="text-sm text-muted">
                          {current.series.length > 1 ? t(`series_${current.key}_${s.key}`) : t('series_default')}
                        </span>
                        <span className="num text-sm font-medium text-text" dir="ltr">{s.next_number}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs leading-relaxed text-muted">{t('next_number_hint')}</p>
                </div>

                {/* ═══ البادئة — الحقل الوحيد القابل للتحرير ═══ */}
                <div className="space-y-1.5">
                  <Label htmlFor="prefix">{t('prefix')}</Label>
                  <Input
                    id="prefix"
                    dir="ltr"
                    maxLength={10}
                    value={prefix}
                    disabled={!current.editable_prefix}
                    onChange={(e) => setPrefix(e.target.value)}
                  />
                  <p className="text-xs leading-relaxed text-muted">
                    {current.editable_prefix ? t('prefix_hint') : t('prefix_fixed')}
                  </p>
                </div>

                {/* ═══ معلومات للاطّلاع — ليست إعدادات ═══ */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="space-y-1">
                    <Label>{t('format')}</Label>
                    <p className="text-sm text-text">{t('format_numeric')}</p>
                  </div>
                  <div className="space-y-1">
                    <Label>{t('padding')}</Label>
                    <p className="num text-sm text-text">{current.padding}</p>
                  </div>
                  <div className="space-y-1">
                    <Label>{t('scope')}</Label>
                    <div>
                      <Badge tone={current.scope === 'branch' ? 'neutral' : 'muted'}>
                        {current.scope === 'branch' ? t('scope_branch') : t('scope_company')}
                      </Badge>
                    </div>
                  </div>
                </div>
                <p className="text-xs leading-relaxed text-muted">
                  {t('readonly_hint')}
                  {current.resets_yearly ? ` ${t('resets_yearly')}` : ` ${t('never_resets')}`}
                </p>

                {error && <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}

                {current.editable_prefix && (
                  <div className="flex justify-end pt-1">
                    <Button type="submit" disabled={saving}>{tc('save')}</Button>
                  </div>
                )}
              </form>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
