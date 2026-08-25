'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Copy, Download, FileText, Pencil, Printer, ReceiptText, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import {
  DetailPage, DetailSummary, ErrorState, FormAlert, LoadingState, type PageAction,
} from '@/components/nebrax';
import { api, ApiError, downloadFile } from '@/lib/api';
import { formatRiyal } from '@/lib/money';

interface Allocation { id: string; label: string; amount: string }
interface Voucher {
  id: string;
  number: string;
  direction: 'received' | 'paid';
  partner_name?: string | null;
  method: string;
  reference?: string | null;
  cash_account_code?: string | null;
  cash_account_name?: string | null;
  journal_entry_id?: string | null;
  payment_date: string;
  amount: string;
  payment_details?: string | null;
  collector_employee_name?: string | null;
  notes?: string | null;
  attachments?: { id: string; original_name: string; mime_type: string | null; size: number }[];
  status: 'draft' | 'posted' | 'cancelled';
  allocations?: Allocation[];
}

const tone: Record<string, 'positive' | 'warning' | 'muted'> = {
  posted: 'positive', draft: 'warning', cancelled: 'muted',
};

export default function ReceiptVoucherDetailPage() {
  const t = useTranslations('receiptVouchers');
  const tc = useTranslations('common');
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { success } = useToast();
  const [voucher, setVoucher] = useState<Voucher | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  const load = useCallback(() => {
    if (!params.id) return;
    setLoading(true);
    setError(null);
    api<{ data: Voucher }>(`/payments/${params.id}`)
      .then((response) => {
        if (!response.data || response.data.direction !== 'received') {
          setError(t('load_failed'));
          return;
        }
        setVoucher(response.data);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : t('load_failed')))
      .finally(() => setLoading(false));
  }, [params.id, t]);

  useEffect(() => load(), [load]);

  async function post() {
    if (!voucher || voucher.status !== 'draft' || !window.confirm(t('confirm_post'))) return;
    setActing(true);
    try {
      const response = await api<{ data: Voucher }>(`/payments/${voucher.id}/post`, { method: 'POST' });
      setVoucher(response.data);
      success(t('post_success'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setActing(false);
    }
  }

  async function duplicate() {
    if (!voucher) return;
    setActing(true);
    try {
      const response = await api<{ data: { id: string } }>(`/payments/${voucher.id}/duplicate`, { method: 'POST' });
      success(t('duplicate_success'));
      router.push(`/receipt-vouchers/new?edit=${response.data.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setActing(false);
    }
  }

  async function remove() {
    if (!voucher || voucher.status !== 'draft' || !window.confirm(t('confirm_delete'))) return;
    setActing(true);
    try {
      await api(`/payments/${voucher.id}`, { method: 'DELETE' });
      success(t('deleted_success'));
      router.push('/receipt-vouchers');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setActing(false);
    }
  }

  if (loading) return <LoadingState rows={8} label={tc('loading')} />;

  if (!voucher) return <ErrorState message={error ?? t('load_failed')} onRetry={load} />;

  const details = [
    [t('number'), voucher.number],
    [t('customer'), voucher.partner_name || '—'],
    [t('date'), voucher.payment_date],
    [t('method'), t(voucher.method)],
    [t('collector'), voucher.collector_employee_name || '—'],
    [t('reference'), voucher.reference || '—'],
    [t('default_treasury'), voucher.cash_account_name ? [voucher.cash_account_code, voucher.cash_account_name].filter(Boolean).join(' — ') : t('default_treasury')],
  ];

  const isDraft = voucher.status === 'draft';
  const actions: PageAction[] = [
    { key: 'print', label: t('prints'), icon: Printer, onClick: () => window.print(), variant: 'outline', emphasis: 'secondary' },
    ...(isDraft ? [{ key: 'edit', label: t('edit'), icon: Pencil, href: `/receipt-vouchers/new?edit=${voucher.id}`, variant: 'outline' as const, emphasis: 'secondary' as const }] : []),
    { key: 'duplicate', label: t('duplicate'), icon: Copy, onClick: duplicate, variant: 'outline', emphasis: 'secondary', disabled: acting },
    {
      key: 'delete', label: t('delete'), icon: Trash2, onClick: remove, variant: 'danger', emphasis: 'secondary',
      disabled: !isDraft || acting,
      title: !isDraft ? t('draft_action_only') : undefined,
    },
    ...(isDraft ? [{ key: 'post', label: t('post'), onClick: post, variant: 'primary' as const, disabled: acting }] : []),
  ];

  const detailContent = (
    <div className="space-y-5">
      <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
        {details.map(([label, value]) => (
          <div key={label} className="space-y-1">
            <dt className="text-sm font-medium text-muted">{label}</dt>
            <dd className="text-sm text-text">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="border-t border-border pt-4">
        <p className="text-sm font-medium text-muted">{t('payment_details')}</p>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-text">{voucher.payment_details || '—'}</p>
      </div>
      <div className="border-t border-border pt-4">
        <p className="text-sm font-medium text-muted">{t('receipt_notes')}</p>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-text">{voucher.notes || '—'}</p>
      </div>
      {(voucher.attachments?.length ?? 0) > 0 && <div className="border-t border-border pt-4">
        <p className="text-sm font-medium text-muted">{t('attachments')}</p>
        <ul className="mt-2 divide-y divide-border rounded-md border border-border">
          {voucher.attachments?.map((attachment) => <li key={attachment.id} className="flex items-center justify-between gap-3 px-3 py-2"><span className="min-w-0 truncate text-sm text-text">{attachment.original_name}</span><Button size="sm" variant="ghost" onClick={() => downloadFile(`/payments/${voucher.id}/attachments/${attachment.id}`, attachment.original_name)}><Download className="h-4 w-4" strokeWidth={1.7} />{t('download_attachment')}</Button></li>)}
        </ul>
      </div>}
    </div>
  );

  const allocationsContent = (
    <div>
      {(voucher.allocations?.length ?? 0) === 0 ? (
        <p className="py-5 text-center text-sm text-muted">{t('no_allocations')}</p>
      ) : (
        <div className="divide-y divide-border rounded-md border border-border">
          {voucher.allocations?.map((allocation) => (
            <div key={allocation.id} className="flex items-center justify-between gap-3 px-3 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <FileText className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.7} />
                <span className="truncate text-sm text-text">{allocation.label}</span>
              </div>
              <span className="num shrink-0 text-sm font-medium">{formatRiyal(allocation.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const summaryContent = (
    <DetailSummary
      rows={[{ label: t('amount'), value: formatRiyal(voucher.amount), strong: true }]}
      note={<>
        <ReceiptText className="mb-1 h-4 w-4 text-primary" strokeWidth={1.7} aria-hidden="true" />
        {voucher.status === 'posted' ? t('posted_immutable_note') : t('draft_posting_note')}
      </>}
    />
  );

  return (
    <DetailPage
      backHref="/receipt-vouchers"
      backLabel={t('back')}
      title={t('receipt_document', { number: voucher.number })}
      badges={<Badge tone={tone[voucher.status] ?? 'muted'}>{t(voucher.status)}</Badge>}
      meta={voucher.journal_entry_id ? t('journal_entry_created') : t('journal_entry_pending')}
      actions={actions}
      alert={error ? <FormAlert>{error}</FormAlert> : undefined}
      summaryTitle={t('financial_summary')}
      summary={summaryContent}
      sections={[
        { id: 'receipt-details', title: t('detail_title'), content: detailContent },
        { id: 'receipt-allocations', title: t('allocations'), count: voucher.allocations?.length, content: allocationsContent },
      ]}
    />
  );
}
