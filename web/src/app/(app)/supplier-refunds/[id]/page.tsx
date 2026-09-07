'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, CheckCircle2, Undo2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { ErrorState, LoadingState } from '@/components/nebrax';
import { api, ApiError } from '@/lib/api';
import { formatRiyal } from '@/lib/money';

interface Allocation {
  id: string;
  purchase_return_id: string;
  purchase_return_number: string | null;
  amount: string;
}

interface SupplierRefund {
  id: string;
  number: string;
  partner_name?: string | null;
  refund_date: string;
  amount: string;
  method: string;
  payment_method_name: string | null;
  reference: string | null;
  notes: string | null;
  status: 'draft' | 'posted' | 'reversed';
  journal_entry_id: string | null;
  reversal_entry_id: string | null;
  allocations?: Allocation[];
}

const tone: Record<SupplierRefund['status'], 'warning' | 'positive' | 'muted'> = {
  draft: 'warning',
  posted: 'positive',
  reversed: 'muted',
};

export default function SupplierRefundDetailPage() {
  const t = useTranslations('supplierRefunds');
  const tc = useTranslations('common');
  const params = useParams<{ id: string }>();
  const { success, error: toastError } = useToast();

  const [refund, setRefund] = useState<SupplierRefund | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoadError(null);
    api<{ data: SupplierRefund }>(`/supplier-refunds/${params.id}`)
      .then((response) => setRefund(response.data))
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : t('load_failed')));
  }, [params.id, t]);

  useEffect(() => load(), [load]);

  async function act(action: 'post' | 'reverse') {
    setBusy(true);
    try {
      await api(`/supplier-refunds/${params.id}/${action}`, { method: 'POST' });
      success(action === 'post' ? t('posted_done') : t('reversed_done'));
      load();
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : t('action_failed'));
    } finally {
      setBusy(false);
    }
  }

  if (loadError) return <ErrorState message={loadError} onRetry={load} />;
  if (!refund) return <LoadingState variant="cards" rows={4} />;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" aria-label={t('back')}>
            <Link href="/supplier-refunds">
              <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="num text-xl font-semibold text-text">{refund.number}</h1>
              <Badge tone={tone[refund.status]}>{t(`status_${refund.status}`)}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
          </div>
        </div>
        <div className="flex gap-2">
          {refund.status === 'draft' && (
            <Button disabled={busy} onClick={() => act('post')}>
              <CheckCircle2 className="h-4 w-4" strokeWidth={1.8} />
              {t('post_action')}
            </Button>
          )}
          {refund.status === 'posted' && (
            <Button variant="outline" disabled={busy} onClick={() => act('reverse')}>
              <Undo2 className="h-4 w-4" strokeWidth={1.8} />
              {t('reverse_action')}
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>{t('details')}</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted">{t('supplier')}</dt>
              <dd className="text-sm text-text">{refund.partner_name ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">{t('refund_date')}</dt>
              <dd className="num text-sm text-text">{refund.refund_date}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">{t('destination')}</dt>
              <dd className="text-sm text-text">{refund.payment_method_name ?? t(`method_${refund.method}`)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">{t('col_amount')}</dt>
              <dd className="num text-sm font-medium text-text">{formatRiyal(refund.amount)}</dd>
            </div>
            {refund.reference && (
              <div>
                <dt className="text-xs text-muted">{t('reference')}</dt>
                <dd className="text-sm text-text">{refund.reference}</dd>
              </div>
            )}
            {refund.notes && (
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted">{t('notes')}</dt>
                <dd className="text-sm leading-relaxed text-text">{refund.notes}</dd>
              </div>
            )}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t('allocations')}</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[24rem] text-sm">
              <thead className="border-b border-border text-start text-muted">
                <tr>
                  <th className="px-2 py-2 font-medium">{t('col_return')}</th>
                  <th className="px-2 py-2 text-end font-medium">{t('col_allocated')}</th>
                </tr>
              </thead>
              <tbody>
                {(refund.allocations ?? []).map((allocation) => (
                  <tr key={allocation.id} className="border-b border-border/70 last:border-0">
                    <td className="px-2 py-2">
                      <Link href={`/returns/${allocation.purchase_return_id}`} className="num text-primary hover:underline">
                        {allocation.purchase_return_number ?? allocation.purchase_return_id}
                      </Link>
                    </td>
                    <td className="num px-2 py-2 text-end text-text">{formatRiyal(allocation.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {refund.status === 'reversed' && (
            <p className="mt-3 rounded border border-border bg-surface px-3 py-2 text-xs leading-relaxed text-muted">
              {t('reversed_hint')}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
