'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { type ColumnDef } from '@tanstack/react-table';
import { BookOpen, FileText, Plus, Pencil } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PartnerDialog, type Partner } from '@/components/partners/partner-dialog';
import { api } from '@/lib/api';

/**
 * إدارة الموردين — يعيد استخدام بنية الأطراف بالكامل: الطرف كيان واحد، والمورّد
 * تصفيةٌ بالنوع (`type=supplier`). ملف المورّد وتعديله هما شاشتا الطرف نفسهما.
 */
export default function SuppliersPage() {
  const ts = useTranslations('suppliers');
  const tp = useTranslations('partners');
  const [data, setData] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Partner | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    // النوع 'both' يظهر في نتيجة supplier أيضاً (الخادم يشمله) — فالطرف المزدوج مرئي هنا وفي العملاء.
    api<{ data: Partner[] }>('/partners?type=supplier')
      .then((r) => setData(r.data))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);

  const columns = useMemo<ColumnDef<Partner, unknown>[]>(
    () => [
      {
        accessorKey: 'name',
        header: tp('name'),
        cell: ({ row }) => (
          <Link href={`/partners/${row.original.id}`} className="text-primary hover:underline">
            {row.original.name}
          </Link>
        ),
      },
      {
        accessorKey: 'entity_type',
        header: tp('entity_type_supplier'),
        cell: ({ row }) => <Badge tone="muted">{tp(row.original.entity_type ?? 'commercial')}</Badge>,
      },
      { accessorKey: 'city', header: tp('city'), cell: ({ row }) => row.original.city ?? '—' },
      {
        accessorKey: 'phone',
        header: tp('phone'),
        cell: ({ row }) => <span className="num text-muted">{row.original.phone ?? '—'}</span>,
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1">
            <Link
              href={`/suppliers/${row.original.id}/statement`}
              className="inline-flex h-9 w-9 items-center justify-center rounded text-text hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              aria-label={ts('statement')}
              title={ts('statement')}
            >
              <FileText className="h-4 w-4" strokeWidth={1.7} />
            </Link>
            <Link
              href={`/suppliers/${row.original.id}/ledger`}
              className="inline-flex h-9 w-9 items-center justify-center rounded text-text hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              aria-label={ts('ledger')}
              title={ts('ledger')}
            >
              <BookOpen className="h-4 w-4" strokeWidth={1.7} />
            </Link>
            <Button
              variant="ghost"
              size="icon"
              aria-label={tp('edit')}
              onClick={() => {
                setEditing(row.original);
                setDialogOpen(true);
              }}
            >
              <Pencil className="h-4 w-4" strokeWidth={1.7} />
            </Button>
          </div>
        ),
      },
    ],
    [tp, ts]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text">{ts('title')}</h1>
        <Button
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="h-4 w-4" strokeWidth={1.8} />
          {ts('add')}
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={data}
        loading={loading}
        searchPlaceholder={ts('search')}
        emptyLabel={ts('empty')}
        exportName="suppliers"
      />

      <PartnerDialog
        key={editing?.id ?? 'new'}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSaved={load}
        partner={editing}
        defaultType="supplier"
        addTitle={ts('add')}
        editTitle={ts('edit')}
      />
    </div>
  );
}
