'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, CheckCircle2, Save } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { formatRiyal } from '@/lib/money';

interface Line {
  id: string;
  product_id: string;
  product_name: string | null;
  system_quantity: number;
  counted_quantity: number | null;
  difference: number | null;
  difference_value: string;
}
interface Stocktake {
  id: string; number: string; warehouse_name: string | null; stocktake_date: string;
  status: string; notes: string | null; difference_value: string;
  journal_entry_id: string | null; lines: Line[];
}

/**
 * ورقة العدّ.
 *
 * الفارق يُحسب حيّاً أثناء الإدخال فيرى العادّ أثر رقمه فوراً — لكن **لا شيء
 * يتحرّك حتى الترحيل**. والحقل الفارغ يعني «لم يُعدّ» لا «صفر»: الأول
 * يُتجاهَل والثاني يشطب الرصيد، والخلط بينهما يمحو بضاعة موجودة.
 */
export default function StocktakeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations('stocktaking');
  const tc = useTranslations('common');
  const { success, error: errorToast } = useToast();

  const [sheet, setSheet] = useState<Stocktake | null>(null);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api<{ data: Stocktake }>(`/stocktakes/${id}`)
      .then((r) => {
        setSheet(r.data);
        setCounts(Object.fromEntries(
          r.data.lines.map((l) => [l.product_id, l.counted_quantity === null ? '' : String(l.counted_quantity)])
        ));
      })
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => load(), [load]);

  async function saveCounts() {
    if (!sheet) return;
    setBusy(true);
    try {
      await api(`/stocktakes/${id}/count`, {
        method: 'POST',
        body: {
          counts: sheet.lines.map((l) => ({
            product_id: l.product_id,
            // الفراغ يبقى null — «لم يُعدّ» لا «صفر»
            counted_quantity: counts[l.product_id] === '' ? null : Number(counts[l.product_id]),
          })),
        },
      });
      success(tc('updated'));
      load();
    } catch (e) {
      errorToast(e instanceof ApiError ? e.message : tc('saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function post() {
    setBusy(true);
    try {
      await api(`/stocktakes/${id}/post`, { method: 'POST' });
      success(tc('updated'));
      load();
    } catch (e) {
      errorToast(e instanceof ApiError ? e.message : tc('saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div className="space-y-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-40 w-full" /></div>;
  }
  if (!sheet) return <div className="text-muted">{t('not_found')}</div>;

  const isDraft = sheet.status === 'draft';

  /** فارق حيّ أثناء الإدخال — قبل أي حفظ. */
  const liveDiff = (l: Line): number | null => {
    const raw = counts[l.product_id];
    if (raw === undefined || raw === '') return null;
    return Number(raw) - l.system_quantity;
  };

  const countedLines = sheet.lines.filter((l) => liveDiff(l) !== null).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push('/stocktaking')} aria-label={t('back')}>
          <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
        </Button>
        <h1 className="num text-xl font-semibold text-text">{sheet.number}</h1>
        <Badge tone={isDraft ? 'muted' : 'positive'}>{t(sheet.status)}</Badge>

        {isDraft && (
          <div className="ms-auto flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={busy} onClick={saveCounts}>
              <Save className="h-4 w-4" strokeWidth={1.7} />
              {t('save_counts')}
            </Button>
            <Button size="sm" disabled={busy} onClick={post}>
              <CheckCircle2 className="h-4 w-4" strokeWidth={1.7} />
              {t('post')}
            </Button>
          </div>
        )}
      </div>

      <Card>
        <CardHeader><CardTitle>{t('details')}</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-0.5">
              <dt className="text-xs text-muted">{t('warehouse')}</dt>
              <dd className="text-sm text-text">{sheet.warehouse_name ?? '—'}</dd>
            </div>
            <div className="space-y-0.5">
              <dt className="text-xs text-muted">{t('date')}</dt>
              <dd className="num text-sm text-text">{sheet.stocktake_date}</dd>
            </div>
            <div className="space-y-0.5">
              <dt className="text-xs text-muted">{t('counted_lines')}</dt>
              <dd className="num text-sm text-text">{countedLines} / {sheet.lines.length}</dd>
            </div>
            <div className="space-y-0.5">
              <dt className="text-xs text-muted">{t('difference')}</dt>
              <dd className="num text-sm font-semibold text-text">{formatRiyal(sheet.difference_value)}</dd>
            </div>
          </dl>

          <p className="mt-3 border-t border-border pt-3 text-xs text-muted">
            {isDraft ? t('draft_hint') : sheet.journal_entry_id ? t('entry_posted') : t('no_difference')}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t('sheet')}</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-xs text-muted">
              <tr>
                <th className="p-3 text-start font-normal">{t('product')}</th>
                <th className="p-3 text-end font-normal">{t('system_qty')}</th>
                <th className="p-3 text-end font-normal">{t('counted_qty')}</th>
                <th className="p-3 text-end font-normal">{t('qty_difference')}</th>
                <th className="p-3 text-end font-normal">{t('value')}</th>
              </tr>
            </thead>
            <tbody>
              {sheet.lines.map((l) => {
                const diff = isDraft ? liveDiff(l) : l.difference;
                return (
                  <tr key={l.id} className="border-b border-border last:border-0">
                    <td className="p-3 text-text">{l.product_name ?? '—'}</td>
                    <td className="num p-3 text-end text-muted">{l.system_quantity}</td>
                    <td className="p-3 text-end">
                      {isDraft ? (
                        <Input
                          className="num ms-auto w-24 text-end"
                          type="number"
                          min={0}
                          placeholder={t('not_counted')}
                          value={counts[l.product_id] ?? ''}
                          onChange={(e) => setCounts((c) => ({ ...c, [l.product_id]: e.target.value }))}
                        />
                      ) : (
                        <span className="num">{l.counted_quantity ?? '—'}</span>
                      )}
                    </td>
                    <td className={`num p-3 text-end ${
                      diff === null ? 'text-muted' : diff < 0 ? 'text-negative' : diff > 0 ? 'text-positive' : 'text-muted'
                    }`}>
                      {diff === null ? '—' : diff > 0 ? `+${diff}` : diff}
                    </td>
                    <td className="num p-3 text-end text-muted">
                      {sheet.status === 'posted' ? formatRiyal(l.difference_value) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
