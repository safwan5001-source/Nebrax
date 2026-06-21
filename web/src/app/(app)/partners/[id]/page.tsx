'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { api } from '@/lib/api';
import { formatRiyal, isNegative } from '@/lib/money';
import { cn } from '@/lib/utils';

interface Row { date: string; number: string; description: string | null; debit: string; credit: string; balance: string }
interface Statement {
  partner: { id: string; name: string; type: string };
  opening_balance: string;
  rows: Row[];
  closing_balance: string;
}

export default function PartnerStatementPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations('partnerStatement');
  const tp = useTranslations('partners');

  const [data, setData] = useState<Statement | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api<Statement>(`/reports/partner-statement/${id}`)
      .then(setData)
      .finally(() => setLoading(false));
  }, [id]);

  const amount = (v: string) => (
    <span className={cn('num', isNegative(v) && 'text-negative')}>{formatRiyal(v)}</span>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push('/partners')} aria-label={t('back')}>
          <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
        </Button>
        <h1 className="text-xl font-semibold text-text">{data?.partner.name ?? '…'}</h1>
        {data && <Badge tone="neutral">{tp(data.partner.type)}</Badge>}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{t('title')}</CardTitle>
          {data && (
            <div className="text-sm">
              <span className="text-muted">{t('closing')}: </span>
              <span className="num font-semibold text-text">{formatRiyal(data.closing_balance)}</span>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {loading || !data ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>{t('date')}</TH>
                  <TH>{t('number')}</TH>
                  <TH>{t('description')}</TH>
                  <TH className="text-end">{t('debit')}</TH>
                  <TH className="text-end">{t('credit')}</TH>
                  <TH className="text-end">{t('balance')}</TH>
                </TR>
              </THead>
              <TBody>
                <TR className="text-muted">
                  <TD />
                  <TD />
                  <TD>{t('opening')}</TD>
                  <TD />
                  <TD />
                  <TD className="text-end">{amount(data.opening_balance)}</TD>
                </TR>
                {data.rows.map((r, i) => (
                  <TR key={i}>
                    <TD className="num text-muted">{r.date}</TD>
                    <TD className="num">{r.number}</TD>
                    <TD>{r.description ?? '—'}</TD>
                    <TD className="num text-end">{r.debit !== '0.00' ? formatRiyal(r.debit) : '—'}</TD>
                    <TD className="num text-end">{r.credit !== '0.00' ? formatRiyal(r.credit) : '—'}</TD>
                    <TD className="text-end">{amount(r.balance)}</TD>
                  </TR>
                ))}
                {data.rows.length === 0 && (
                  <TR>
                    <TD colSpan={6} className="py-8 text-center text-muted">
                      {t('empty')}
                    </TD>
                  </TR>
                )}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
