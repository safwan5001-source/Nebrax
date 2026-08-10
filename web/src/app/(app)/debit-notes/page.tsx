'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { BranchViewToggle } from '@/components/ui/branch-view-toggle';
import { branchViewQuery, type BranchView } from '@/lib/branch-view';
import { formatRiyal } from '@/lib/money';

interface CreditNote {
  id: string;
  number: string;
  partner_id: string;
  status: string;
  note_date: string;
  total: string;
}
interface Partner { id: string; name: string }

const statusTone: Record<string, 'positive' | 'muted' | 'negative'> = { posted: 'positive', draft: 'muted', cancelled: 'negative' };

export default function DebitNotesPage() {
  const t = useTranslations('debitNotes');
  const [data, setData] = useState<CreditNote[]>([]);
  const [partners, setPartners] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  // نطاق العرض: الفرع النشط افتراضياً؛ لا يُحفظ فيبدأ كل فتح من الافتراضي.
  const [view, setView] = useState<BranchView>('current');

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([api<{ data: CreditNote[] }>(`/credit-notes?type=purchase${branchViewQuery(view, true)}`), api<{ data: Partner[] }>('/partners?type=supplier')])
      .then(([cn, prt]) => {
        setData(cn.data);
        setPartners(Object.fromEntries(prt.data.map((p) => [p.id, p.name])));
      })
      .finally(() => setLoading(false));
  }, [view]);

  useEffect(() => load(), [load]);

  const columns = useMemo<ColumnDef<CreditNote, unknown>[]>(
    () => [
      {
        accessorKey: 'number',
        header: t('number'),
        cell: ({ row }) => (
          <Link href={`/credit-notes/${row.original.id}`} className="num text-primary hover:underline">
            {row.original.number}
          </Link>
        ),
      },
      {
        id: 'partner',
        header: t('partner'),
        accessorFn: (r) => partners[r.partner_id] ?? '—',
        cell: ({ row }) => partners[row.original.partner_id] ?? '—',
      },
      { accessorKey: 'note_date', header: t('date'), cell: ({ row }) => <span className="num text-muted">{row.original.note_date}</span> },
      { accessorKey: 'total', header: t('total'), cell: ({ row }) => <div className="num text-end">{formatRiyal(row.original.total)}</div> },
      { accessorKey: 'status', header: t('status'), cell: ({ row }) => <Badge tone={statusTone[row.original.status] ?? 'muted'}>{t(row.original.status)}</Badge> },
    ],
    [partners, t]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
        {/* نطاق العرض ظاهر في الشاشة نفسها — لا مخفيّاً في الإعدادات. */}
        <BranchViewToggle value={view} onChange={setView} />
        <Link href="/debit-notes/new">
          <Button>
            <Plus className="h-4 w-4" strokeWidth={1.8} />
            {t('create')}
          </Button>
        </Link>
      </div>

      <DataTable columns={columns} data={data} loading={loading} searchPlaceholder={t('search')} emptyLabel={t('empty')} exportName="debit-notes" />
    </div>
  );
}
