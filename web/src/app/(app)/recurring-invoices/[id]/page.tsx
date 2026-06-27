'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, Repeat } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { formatRiyal } from '@/lib/money';

interface Line { id: string; description: string | null; quantity: number; unit_price: string; line_tax: string; line_total: string }
interface Recurring {
  id: string; title: string | null; partner_id: string; frequency: string;
  start_date: string; next_run_date: string; end_date: string | null; active: boolean;
  generated_count: number; subtotal: string; tax_amount: string; total: string; lines: Line[];
}
interface Party { id: string; name: string }

export default function RecurringDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations('recurring');
  const tf = useTranslations('invoiceForm');
  const tc = useTranslations('common');
  const { success } = useToast();

  const [rec, setRec] = useState<Recurring | null>(null);
  const [partner, setPartner] = useState<Party | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  function load() {
    setLoading(true);
    api<{ data: Recurring }>(`/recurring-invoices/${id}`)
      .then(async (r) => {
        setRec(r.data);
        const p = await api<{ data: Party }>(`/partners/${r.data.partner_id}`).catch(() => null);
        if (p) setPartner(p.data);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [id]);

  async function generate() {
    setGenerating(true);
    try {
      const inv = await api<{ data: { id: string } }>(`/recurring-invoices/${id}/generate`, { method: 'POST' });
      success(tc('created'));
      router.push(`/invoices/${inv.data.id}`);
    } catch (e) {
      setGenerating(false);
      alert(e instanceof ApiError ? e.message : tc('saveFailed'));
    }
  }

  if (loading) {
    return <div className="space-y-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-40 w-full" /></div>;
  }
  if (!rec) return <div className="text-muted">{t('not_found')}</div>;

  const info: [string, React.ReactNode][] = [
    [t('partner'), partner?.name ?? '—'],
    [t('frequency'), t(rec.frequency)],
    [t('next_run'), <span key="n" className="num">{rec.next_run_date}</span>],
    [t('generated_count'), <span key="g" className="num">{rec.generated_count}</span>],
    [t('total'), <span key="t" className="num font-semibold">{formatRiyal(rec.total)}</span>],
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push('/recurring-invoices')} aria-label={t('back')}>
          <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
        </Button>
        <h1 className="text-xl font-semibold text-text">{rec.title || (partner?.name ?? '—')}</h1>
        <Badge tone={rec.active ? 'positive' : 'muted'}>{rec.active ? t('active') : t('inactive')}</Badge>
        <div className="ms-auto">
          <Button size="sm" disabled={generating || !rec.active} onClick={generate}>
            <Repeat className="h-4 w-4" strokeWidth={1.7} />
            {t('generate')}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>{t('details')}</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            {info.map(([k, v]) => (
              <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="text-text">{v}</dd></div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t('lines')}</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <THead>
              <TR>
                <TH>{tf('description')}</TH>
                <TH className="text-end">{tf('qty')}</TH>
                <TH className="text-end">{tf('price')}</TH>
                <TH className="text-end">{tf('tax')}</TH>
                <TH className="text-end">{t('total')}</TH>
              </TR>
            </THead>
            <TBody>
              {rec.lines.map((l) => (
                <TR key={l.id}>
                  <TD>{l.description ?? '—'}</TD>
                  <TD className="num text-end">{l.quantity}</TD>
                  <TD className="num text-end">{formatRiyal(l.unit_price)}</TD>
                  <TD className="num text-end">{formatRiyal(l.line_tax)}</TD>
                  <TD className="num text-end">{formatRiyal(l.line_total)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
