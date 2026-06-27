'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, Printer, FileCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { formatRiyal } from '@/lib/money';

interface Line { id: string; description: string | null; quantity: number; unit_price: string; line_tax: string; line_total: string }
interface Quote {
  id: string; number: string; partner_id: string; status: string;
  quote_date: string; valid_until: string | null;
  subtotal: string; tax_amount: string; total: string; notes: string | null;
  converted_invoice_id: string | null; lines: Line[];
}
interface Party { id: string; name: string }

const statusTone: Record<string, 'positive' | 'warning' | 'muted' | 'negative' | 'neutral'> = {
  draft: 'muted', sent: 'neutral', accepted: 'positive', rejected: 'negative', converted: 'positive',
};

export default function QuoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations('quotes');
  const tf = useTranslations('invoiceForm');
  const tc = useTranslations('common');
  const { success } = useToast();

  const [quote, setQuote] = useState<Quote | null>(null);
  const [partner, setPartner] = useState<Party | null>(null);
  const [loading, setLoading] = useState(true);
  const [converting, setConverting] = useState(false);

  function load() {
    setLoading(true);
    api<{ data: Quote }>(`/quotes/${id}`)
      .then(async (r) => {
        setQuote(r.data);
        const p = await api<{ data: Party }>(`/partners/${r.data.partner_id}`).catch(() => null);
        if (p) setPartner(p.data);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [id]);

  async function convert() {
    setConverting(true);
    try {
      const inv = await api<{ data: { id: string } }>(`/quotes/${id}/convert`, { method: 'POST', body: { payment_type: 'credit' } });
      success(tc('created'));
      router.push(`/invoices/${inv.data.id}`);
    } catch (e) {
      setConverting(false);
      alert(e instanceof ApiError ? e.message : tc('saveFailed'));
    }
  }

  if (loading) {
    return <div className="space-y-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-40 w-full" /></div>;
  }
  if (!quote) return <div className="text-muted">{t('not_found')}</div>;

  const info: [string, React.ReactNode][] = [
    [t('partner'), partner?.name ?? '—'],
    [t('date'), <span key="d" className="num">{quote.quote_date}</span>],
    [t('valid_until'), <span key="v" className="num">{quote.valid_until ?? '—'}</span>],
    [t('total'), <span key="t" className="num font-semibold">{formatRiyal(quote.total)}</span>],
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" className="no-print" onClick={() => router.push('/quotes')} aria-label={t('back')}>
          <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
        </Button>
        <h1 className="num text-xl font-semibold text-text">{quote.number}</h1>
        <Badge tone={statusTone[quote.status] ?? 'muted'}>{t(quote.status)}</Badge>
        <div className="no-print ms-auto flex gap-2">
          {quote.converted_invoice_id ? (
            <Button variant="outline" size="sm" onClick={() => router.push(`/invoices/${quote.converted_invoice_id}`)}>
              <FileCheck className="h-4 w-4" strokeWidth={1.7} />
              {t('view_invoice')}
            </Button>
          ) : (
            <Button size="sm" disabled={converting} onClick={convert}>
              <FileCheck className="h-4 w-4" strokeWidth={1.7} />
              {t('convert')}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="h-4 w-4" strokeWidth={1.7} />
            {t('print')}
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
          {quote.notes && <p className="mt-3 border-t border-border pt-3 text-sm text-muted">{quote.notes}</p>}
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
              {quote.lines.map((l) => (
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
