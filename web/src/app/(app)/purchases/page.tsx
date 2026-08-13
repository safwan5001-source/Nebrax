'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus, Eye, Pencil, Trash2 } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { BranchViewToggle } from '@/components/ui/branch-view-toggle';
import { branchViewQuery, type BranchView } from '@/lib/branch-view';
import { formatRiyal } from '@/lib/money';

interface Purchase {
  id: string;
  number: string;
  partner_id: string;
  purchase_date: string;
  total: string;
  status: string;
  payment_status: string;
}
interface Partner { id: string; name: string }

const statusTone: Record<string, 'positive' | 'muted' | 'negative'> = { posted: 'positive', draft: 'muted', cancelled: 'negative' };
const payTone: Record<string, 'positive' | 'warning' | 'muted'> = { paid: 'positive', partial: 'warning', unpaid: 'muted' };

export default function PurchasesPage() {
  const t = useTranslations('purchases');
  const ts = useTranslations('status');
  const [data, setData] = useState<Purchase[]>([]);
  const [partners, setPartners] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  // نطاق العرض: الفرع النشط افتراضياً؛ لا يُحفظ فيبدأ كل فتح من الافتراضي.
  const [view, setView] = useState<BranchView>('current');
  const [toDelete, setToDelete] = useState<Purchase | null>(null);
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();
  const tc = useTranslations('common');
  const { success, error: errorToast } = useToast();

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([api<{ data: Purchase[] }>(`/purchases${branchViewQuery(view)}`), api<{ data: Partner[] }>('/partners')])
      .then(([pur, prt]) => {
        setData(pur.data);
        setPartners(Object.fromEntries(prt.data.map((p) => [p.id, p.name])));
      })
      .finally(() => setLoading(false));
  }, [view]);

  useEffect(() => load(), [load]);

  const columns = useMemo<ColumnDef<Purchase, unknown>[]>(
    () => [
      {
        accessorKey: 'number',
        header: t('number'),
        cell: ({ row }) => (
          <Link href={`/purchases/${row.original.id}`} className="num text-primary hover:underline">
            {row.original.number}
          </Link>
        ),
      },
      {
        id: 'partner',
        header: t('supplier'),
        accessorFn: (r) => partners[r.partner_id] ?? '—',
        cell: ({ row }) => partners[row.original.partner_id] ?? '—',
      },
      { accessorKey: 'purchase_date', header: t('date'), cell: ({ row }) => <span className="num text-muted">{row.original.purchase_date}</span> },
      { accessorKey: 'total', header: t('total'), cell: ({ row }) => <div className="num text-end">{formatRiyal(row.original.total)}</div> },
      { accessorKey: 'status', header: t('status'), cell: ({ row }) => <Badge tone={statusTone[row.original.status] ?? 'muted'}>{ts(row.original.status)}</Badge> },
      { accessorKey: 'payment_status', header: t('payment_status'), cell: ({ row }) => <Badge tone={payTone[row.original.payment_status] ?? 'muted'}>{ts(row.original.payment_status)}</Badge> },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        cell: ({ row }) => {
          const p = row.original;
          // **المرحّلة لا تُعدَّل ولا تُحذف**: لها قيدٌ في الدفتر وحركةُ مخزون
          // غيّرت المتوسط المتحرك. الزرّان يظهران معطّلَين بسبب مكتوب — إخفاؤهما
          // كان يترك المستخدم يبحث عنهما ظانّاً أن الشاشة ناقصة.
          const isDraft = p.status === 'draft';
          return (
            <div className="flex items-center justify-end gap-0.5">
              <Button variant="ghost" size="icon" aria-label={t('view')} onClick={() => router.push(`/purchases/${p.id}`)}>
                <Eye className="h-4 w-4" strokeWidth={1.7} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('edit')}
                disabled={!isDraft}
                title={isDraft ? t('edit') : t('posted_locked')}
                onClick={() => router.push(`/purchases/${p.id}/edit`)}
              >
                <Pencil className="h-4 w-4" strokeWidth={1.7} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('delete')}
                disabled={!isDraft}
                title={isDraft ? t('delete') : t('posted_locked')}
                onClick={() => setToDelete(p)}
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

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api(`/purchases/${toDelete.id}`, { method: 'DELETE' });
      success(t('deleted'));
      setToDelete(null);
      load();
    } catch (e) {
      errorToast(e instanceof ApiError ? e.message : tc('saveFailed'));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
        {/* نطاق العرض ظاهر في الشاشة نفسها — لا مخفيّاً في الإعدادات. */}
        <BranchViewToggle value={view} onChange={setView} />
        {/* صفحة كاملة لا نافذة: النموذج صار يختار منتجاً ووحدةً ومركز تكلفة. */}
        <Button onClick={() => router.push('/purchases/new')}>
          <Plus className="h-4 w-4" strokeWidth={1.8} />
          {t('create')}
        </Button>
      </div>
      <DataTable columns={columns} data={data} loading={loading} searchPlaceholder={t('search')} emptyLabel={t('empty')} exportName="purchases" />

      <Dialog open={!!toDelete} onClose={() => (deleting ? null : setToDelete(null))} title={t('delete_title')}>
        <p className="text-sm text-text">
          {t('delete_confirm')} <span className="num font-medium">{toDelete?.number}</span>؟
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setToDelete(null)} disabled={deleting}>{t('cancel')}</Button>
          <Button variant="danger" onClick={confirmDelete} disabled={deleting}>{t('delete')}</Button>
        </div>
      </Dialog>
    </div>
  );
}
