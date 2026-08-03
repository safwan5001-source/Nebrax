'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus, Eye, Pencil, Trash2 } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { formatRiyal } from '@/lib/money';

interface Invoice {
  id: string;
  number: string;
  partner_id: string;
  invoice_date: string;
  total: string;
  status: string;
  payment_status: string;
}
interface Partner { id: string; name: string }

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

export default function InvoicesPage() {
  const t = useTranslations('invoices');
  const ts = useTranslations('status');
  const router = useRouter();
  const { success, error: errorToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [partners, setPartners] = useState<Record<string, string>>({});
  const [toDelete, setToDelete] = useState<Invoice | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([api<{ data: Invoice[] }>('/invoices'), api<{ data: Partner[] }>('/partners')])
      .then(([inv, prt]) => {
        setInvoices(inv.data);
        setPartners(Object.fromEntries(prt.data.map((p) => [p.id, p.name])));
      })
      .catch(() => setError(t('load_error')))
      .finally(() => setLoading(false));
  }, [t]);

  useEffect(() => load(), [load]);

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api(`/invoices/${toDelete.id}`, { method: 'DELETE' });
      success(t('deleted'));
      setToDelete(null);
      load();
    } catch (e) {
      errorToast(e instanceof ApiError ? e.message : t('delete_failed'));
    } finally {
      setDeleting(false);
    }
  }

  const columns = useMemo<ColumnDef<Invoice, unknown>[]>(
    () => [
      {
        accessorKey: 'number',
        header: t('number'),
        cell: ({ row }) => (
          <Link href={`/invoices/${row.original.id}`} className="num text-primary hover:underline">
            {row.original.number}
          </Link>
        ),
      },
      {
        id: 'partner',
        header: t('partner'),
        accessorFn: (row) => partners[row.partner_id] ?? '—',
        cell: ({ row }) => partners[row.original.partner_id] ?? '—',
      },
      {
        accessorKey: 'invoice_date',
        header: t('date'),
        cell: ({ row }) => <span className="num text-muted">{row.original.invoice_date}</span>,
      },
      {
        accessorKey: 'total',
        header: t('total'),
        cell: ({ row }) => <div className="num text-end">{formatRiyal(row.original.total)}</div>,
      },
      {
        accessorKey: 'status',
        header: t('status'),
        cell: ({ row }) => <Badge tone={statusTone[row.original.status] ?? 'muted'}>{ts(row.original.status)}</Badge>,
      },
      {
        accessorKey: 'payment_status',
        header: t('payment_status'),
        cell: ({ row }) => (
          <Badge tone={payTone[row.original.payment_status] ?? 'muted'}>{ts(row.original.payment_status)}</Badge>
        ),
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        cell: ({ row }) => {
          const inv = row.original;
          const isDraft = inv.status === 'draft';
          return (
            <div className="flex items-center justify-end gap-0.5">
              <Button variant="ghost" size="icon" aria-label={t('view')} onClick={() => router.push(`/invoices/${inv.id}`)}>
                <Eye className="h-4 w-4" strokeWidth={1.7} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('edit')}
                disabled={!isDraft}
                title={isDraft ? t('edit') : t('posted_locked')}
                onClick={() => router.push(`/invoices/${inv.id}/edit`)}
              >
                <Pencil className="h-4 w-4" strokeWidth={1.7} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('delete')}
                disabled={!isDraft}
                title={isDraft ? t('delete') : t('posted_locked')}
                onClick={() => setToDelete(inv)}
              >
                <Trash2 className={`h-4 w-4 ${isDraft ? 'text-negative' : ''}`} strokeWidth={1.7} />
              </Button>
            </div>
          );
        },
      },
    ],
    [partners, t, ts, router]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
        <Link href="/invoices/new" className="ms-auto">
          <Button>
            <Plus className="h-4 w-4" strokeWidth={1.8} />
            {t('create')}
          </Button>
        </Link>
      </div>

      {error ? (
        <div className="rounded border border-border bg-surface p-8 text-center">
          <p className="text-sm text-negative">{error}</p>
          <Button variant="outline" className="mt-3" onClick={load}>
            {t('retry')}
          </Button>
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={invoices}
          loading={loading}
          searchPlaceholder={t('search')}
          emptyLabel={t('empty')}
          exportName="invoices"
        />
      )}

      <Dialog open={!!toDelete} onClose={() => (deleting ? null : setToDelete(null))} title={t('delete_title')}>
        <p className="text-sm text-text">
          {t('delete_confirm')} <span className="num font-medium">{toDelete?.number}</span>؟
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setToDelete(null)} disabled={deleting}>{t('retry_cancel')}</Button>
          <Button variant="danger" onClick={confirmDelete} disabled={deleting}>
            {deleting ? t('generating_delete') : t('delete')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
