'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { api } from '@/lib/api';
import { formatRiyal, formatRiyalShort } from '@/lib/money';

interface Invoice {
  id: string;
  number: string;
  invoice_date: string;
  total: string;
  status: string;
  payment_type: string;
}

export default function PosReportPage() {
  const t = useTranslations('posReport');
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ data: Invoice[] }>('/invoices')
      .then((r) => setInvoices(r.data))
      .finally(() => setLoading(false));
  }, []);

  const cash = useMemo(
    () => invoices.filter((i) => i.payment_type === 'cash' && i.status === 'posted'),
    [invoices],
  );
  const total = cash.reduce((s, i) => s + Number(i.total), 0);
  const count = cash.length;
  const avg = count ? total / count : 0;

  const kpis = [
    { label: t('total_sales'), value: formatRiyalShort(total) },
    { label: t('count'), value: String(count) },
    { label: t('avg'), value: formatRiyalShort(avg) },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {kpis.map((k) => (
          <Card key={k.label}>
            <CardHeader><CardTitle>{k.label}</CardTitle></CardHeader>
            <CardContent>
              {loading ? <Skeleton className="h-7 w-24" /> : <div className="num text-lg font-semibold text-text">{k.value}</div>}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle>{t('recent')}</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-32 w-full" />
          ) : cash.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">{t('empty')}</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>{t('number')}</TH>
                  <TH>{t('date')}</TH>
                  <TH className="text-end">{t('total')}</TH>
                </TR>
              </THead>
              <TBody>
                {cash.slice(0, 10).map((i) => (
                  <TR key={i.id}>
                    <TD className="num">{i.number}</TD>
                    <TD className="num text-muted">{i.invoice_date}</TD>
                    <TD className="num text-end">{formatRiyal(i.total)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
