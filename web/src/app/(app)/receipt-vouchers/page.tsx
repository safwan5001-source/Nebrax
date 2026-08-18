'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Copy, Eye, Pencil, Plus, Trash2 } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { BranchViewToggle } from '@/components/ui/branch-view-toggle';
import { branchViewQuery, type BranchView } from '@/lib/branch-view';
import { formatRiyal } from '@/lib/money';

interface Voucher { id: string; number: string; partner_name?: string | null; method: string; payment_date: string; amount: string; status: string }
const tone: Record<string, 'positive' | 'warning' | 'muted'> = { posted: 'positive', draft: 'warning', cancelled: 'muted' };

export default function ReceiptVouchersPage() {
  const t = useTranslations('receiptVouchers');
  const tc = useTranslations('common');
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [data, setData] = useState<Voucher[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<BranchView>('current');
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api<{ data: Voucher[] }>(`/payments?direction=received${branchViewQuery(view, true)}`)
      .then((response) => setData(response.data))
      .catch((err) => toastError(err instanceof ApiError ? err.message : t('load_list_failed')))
      .finally(() => setLoading(false));
  }, [toastError, t, view]);

  useEffect(() => load(), [load]);

  const duplicate = useCallback(async (id: string) => {
    setActing(id);
    try {
      const response = await api<{ data: Voucher }>(`/payments/${id}/duplicate`, { method: 'POST' });
      success(t('duplicate_success'));
      router.push(`/receipt-vouchers/new?edit=${response.data.id}`);
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally { setActing(null); }
  }, [router, success, t, tc, toastError]);

  const remove = useCallback(async (id: string) => {
    if (!window.confirm(t('confirm_delete'))) return;
    setActing(id);
    try {
      await api(`/payments/${id}`, { method: 'DELETE' });
      success(t('deleted_success'));
      load();
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally { setActing(null); }
  }, [load, success, t, tc, toastError]);

  const post = useCallback(async (id: string) => {
    if (!window.confirm(t('confirm_post'))) return;
    setActing(id);
    try {
      await api(`/payments/${id}/post`, { method: 'POST' });
      success(t('post_success'));
      load();
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally { setActing(null); }
  }, [load, success, t, tc, toastError]);

  const columns = useMemo<ColumnDef<Voucher, unknown>[]>(() => [
    { accessorKey: 'number', header: t('number'), cell: ({ row }) => <Link href={`/receipt-vouchers/${row.original.id}`} className="num font-medium text-primary hover:underline">{row.original.number}</Link> },
    { accessorKey: 'partner_name', header: t('customer'), cell: ({ row }) => row.original.partner_name || '—' },
    { accessorKey: 'method', header: t('method'), cell: ({ row }) => t(row.original.method) },
    { accessorKey: 'payment_date', header: t('date'), cell: ({ row }) => <span className="num text-muted">{row.original.payment_date}</span> },
    { accessorKey: 'amount', header: t('amount'), cell: ({ row }) => <span className="num">{formatRiyal(row.original.amount)}</span> },
    { accessorKey: 'status', header: t('status'), cell: ({ row }) => <Badge tone={tone[row.original.status] ?? 'muted'}>{t(row.original.status)}</Badge> },
    { id: 'actions', header: t('actions'), cell: ({ row }) => {
      const voucher = row.original; const draft = voucher.status === 'draft'; const busy = acting === voucher.id;
      return <div className="flex justify-end gap-1">
        <Link href={`/receipt-vouchers/${voucher.id}`}><Button size="icon" variant="ghost" aria-label={t('view')}><Eye className="h-4 w-4" strokeWidth={1.7} /></Button></Link>
        {draft ? <Link href={`/receipt-vouchers/new?edit=${voucher.id}`}><Button size="icon" variant="ghost" aria-label={t('edit')}><Pencil className="h-4 w-4" strokeWidth={1.7} /></Button></Link> : <Button size="icon" variant="ghost" disabled title={t('draft_action_only')} aria-label={t('edit')}><Pencil className="h-4 w-4" strokeWidth={1.7} /></Button>}
        <Button size="icon" variant="ghost" disabled={busy} onClick={() => duplicate(voucher.id)} aria-label={t('duplicate')}><Copy className="h-4 w-4" strokeWidth={1.7} /></Button>
        <Button size="icon" variant="ghost" disabled={!draft || busy} title={!draft ? t('draft_action_only') : undefined} onClick={() => remove(voucher.id)} aria-label={t('delete')}><Trash2 className="h-4 w-4 text-negative" strokeWidth={1.7} /></Button>
        {draft && <Button size="sm" variant="outline" disabled={busy} onClick={() => post(voucher.id)}>{t('post')}</Button>}
      </div>;
    } },
  ], [acting, duplicate, post, remove, t]);

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-xl font-semibold text-text">{t('title')}</h1><p className="mt-1 text-sm text-muted">{t('subtitle')}</p></div><div className="flex items-center gap-2"><BranchViewToggle value={view} onChange={setView} /><Link href="/receipt-vouchers/new"><Button><Plus className="h-4 w-4" strokeWidth={1.8} />{t('create')}</Button></Link></div></div>
    <DataTable columns={columns} data={data} loading={loading} searchPlaceholder={t('search')} emptyLabel={t('empty')} exportName="receipt-vouchers" />
  </div>;
}
