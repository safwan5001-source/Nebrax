'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { formatRiyal } from '@/lib/money';

interface Line { id: string; product_name: string | null; quantity: number; unit_cost: string; line_cost: string }
interface Permit {
  id: string; type: 'receipt' | 'issue' | 'transfer'; number: string;
  warehouse_name: string | null; target_warehouse_name: string | null;
  permit_date: string; status: string; reason: string | null; notes: string | null;
  total_cost: string; journal_entry_id: string | null; lines: Line[];
}

export default function StockPermitDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations('stockPermits');
  const tc = useTranslations('common');
  const { success, error: errorToast } = useToast();

  const [permit, setPermit] = useState<Permit | null>(null);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api<{ data: Permit }>(`/stock-permits/${id}`)
      .then((r) => setPermit(r.data))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => load(), [load]);

  async function post() {
    setPosting(true);
    try {
      await api(`/stock-permits/${id}/post`, { method: 'POST' });
      success(tc('updated'));
      load();
    } catch (e) {
      errorToast(e instanceof ApiError ? e.message : tc('saveFailed'));
    } finally {
      setPosting(false);
    }
  }

  if (loading) {
    return <div className="space-y-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-40 w-full" /></div>;
  }
  if (!permit) return <div className="text-muted">{t('not_found')}</div>;

  const info: [string, React.ReactNode][] = [
    [t('type'), t(`type_${permit.type}`)],
    [permit.type === 'transfer' ? t('from_warehouse') : t('warehouse'), permit.warehouse_name ?? '—'],
    ...(permit.target_warehouse_name
      ? [[t('to_warehouse'), permit.target_warehouse_name] as [string, React.ReactNode]] : []),
    [t('date'), <span key="d" className="num">{permit.permit_date}</span>],
    ...(permit.reason ? [[t('reason'), permit.reason] as [string, React.ReactNode]] : []),
    [t('total_cost'), <span key="c" className="num font-semibold">{formatRiyal(permit.total_cost)}</span>],
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push('/stock-permits')} aria-label={t('back')}>
          <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
        </Button>
        <h1 className="num text-xl font-semibold text-text">{permit.number}</h1>
        <Badge tone={permit.status === 'posted' ? 'positive' : 'muted'}>{t(permit.status)}</Badge>

        {permit.status === 'draft' && (
          <Button className="ms-auto" size="sm" disabled={posting} onClick={post}>
            <CheckCircle2 className="h-4 w-4" strokeWidth={1.7} />
            {t('post')}
          </Button>
        )}
      </div>

      <Card>
        <CardHeader><CardTitle>{t('details')}</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {info.map(([label, value]) => (
              <div key={label} className="space-y-0.5">
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="text-sm text-text">{value}</dd>
              </div>
            ))}
          </dl>
          {permit.notes && <p className="mt-3 text-sm text-muted">{permit.notes}</p>}

          {/* التحويل الداخلي لا قيد له — يُقال صراحةً بدل أن يبدو نقصاً. */}
          <p className="mt-3 border-t border-border pt-3 text-xs text-muted">
            {permit.status !== 'posted'
              ? t('draft_hint')
              : permit.journal_entry_id
                ? t('entry_posted')
                : t('no_entry_internal')}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t('lines')}</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-xs text-muted">
              <tr>
                <th className="p-3 text-start font-normal">{t('product')}</th>
                <th className="p-3 text-end font-normal">{t('qty')}</th>
                <th className="p-3 text-end font-normal">{t('unit_cost')}</th>
                <th className="p-3 text-end font-normal">{t('line_cost')}</th>
              </tr>
            </thead>
            <tbody>
              {permit.lines.map((l) => (
                <tr key={l.id} className="border-b border-border last:border-0">
                  <td className="p-3 text-text">{l.product_name ?? '—'}</td>
                  <td className="num p-3 text-end">{l.quantity}</td>
                  <td className="num p-3 text-end">{formatRiyal(l.unit_cost)}</td>
                  <td className="num p-3 text-end">{formatRiyal(l.line_cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
