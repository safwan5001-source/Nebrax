'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { QRCodeSVG } from 'qrcode.react';
import { ArrowRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { api } from '@/lib/api';
import { formatRiyal } from '@/lib/money';

interface Line {
  id: string;
  description: string | null;
  quantity: number;
  unit_price: string;
  tax_rate: number;
  line_subtotal: string;
  line_tax: string;
  line_total: string;
}
interface Invoice {
  id: string;
  number: string;
  partner_id: string;
  payment_type: string;
  status: string;
  payment_status: string;
  invoice_date: string;
  subtotal: string;
  tax_amount: string;
  total: string;
  paid_amount: string;
  remaining: string;
  lines: Line[];
}
interface Zatca {
  qr: string | null;
  hash: string | null;
  uuid: string | null;
  icv: number | null;
}

const statusTone: Record<string, 'positive' | 'muted' | 'negative'> = {
  posted: 'positive',
  draft: 'muted',
  cancelled: 'negative',
};
const payTone: Record<string, 'positive' | 'warning' | 'muted'> = {
  paid: 'positive',
  partial: 'warning',
  unpaid: 'muted',
};

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations('invoiceDetail');
  const ti = useTranslations('invoices');
  const ts = useTranslations('status');

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [partnerName, setPartnerName] = useState('—');
  const [zatca, setZatca] = useState<Zatca | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api<{ data: Invoice }>(`/invoices/${id}`)
      .then(async (r) => {
        setInvoice(r.data);
        const [p, z] = await Promise.allSettled([
          api<{ data: { name: string } }>(`/partners/${r.data.partner_id}`),
          api<Zatca>(`/invoices/${id}/zatca`),
        ]);
        if (p.status === 'fulfilled') setPartnerName(p.value.data.name);
        if (z.status === 'fulfilled') setZatca(z.value);
      })
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!invoice) {
    return <div className="text-muted">{t('not_found')}</div>;
  }

  const info: [string, React.ReactNode][] = [
    [t('partner'), partnerName],
    [t('date'), <span key="d" className="num">{invoice.invoice_date}</span>],
    [t('payment_type'), invoice.payment_type === 'cash' ? t('cash') : t('credit')],
    [ti('total'), <span key="t" className="num font-semibold">{formatRiyal(invoice.total)}</span>],
    [t('paid'), <span key="p" className="num">{formatRiyal(invoice.paid_amount)}</span>],
    [t('remaining'), <span key="r" className="num">{formatRiyal(invoice.remaining)}</span>],
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push('/invoices')} aria-label={t('back')}>
          <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
        </Button>
        <h1 className="num text-xl font-semibold text-text">{invoice.number}</h1>
        <Badge tone={statusTone[invoice.status] ?? 'muted'}>{ts(invoice.status)}</Badge>
        <Badge tone={payTone[invoice.payment_status] ?? 'muted'}>{ts(invoice.payment_status)}</Badge>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t('details')}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
              {info.map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-muted">{k}</dt>
                  <dd className="text-text">{v}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('zatca')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-3">
            {zatca?.qr ? (
              <>
                <div className="rounded bg-white p-3">
                  <QRCodeSVG value={zatca.qr} size={140} level="M" />
                </div>
                <div className="w-full space-y-1 text-xs text-muted">
                  <div className="flex justify-between gap-2">
                    <span>ICV</span>
                    <span className="num text-text">{zatca.icv}</span>
                  </div>
                  <div className="truncate" title={zatca.uuid ?? ''}>
                    UUID: <span className="num text-text">{zatca.uuid}</span>
                  </div>
                </div>
              </>
            ) : (
              <p className="py-6 text-xs text-muted">{t('zatca_pending')}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('lines')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <THead>
              <TR>
                <TH>{t('description')}</TH>
                <TH className="text-end">{t('qty')}</TH>
                <TH className="text-end">{t('unit_price')}</TH>
                <TH className="text-end">{t('tax')}</TH>
                <TH className="text-end">{ti('total')}</TH>
              </TR>
            </THead>
            <TBody>
              {invoice.lines.map((l) => (
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
