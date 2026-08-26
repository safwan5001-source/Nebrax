'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Upload } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { PageHeader, type PageAction } from '@/components/nebrax';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { formatRiyal } from '@/lib/money';
import type { OpeningDocument, OpeningStatus } from '@/modules/inventory-openings/contract';

export default function InventoryOpeningsPage() {
  const t = useTranslations('inventoryOpenings');
  const [data, setData] = useState<OpeningDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<'' | OpeningStatus>('');

  const load = useCallback(() => {
    setLoading(true);
    const query = status ? `?status=${status}` : '';
    api<{ data: OpeningDocument[] }>(`/inventory-openings${query}`)
      .then((response) => setData(response.data))
      .finally(() => setLoading(false));
  }, [status]);

  useEffect(() => load(), [load]);

  const columns = useMemo<ColumnDef<OpeningDocument, unknown>[]>(
    () => [
      {
        accessorKey: 'number',
        header: t('col_number'),
        cell: ({ row }) => (
          <Link href={`/inventory-openings/${row.original.id}`} className="num text-primary hover:underline">
            {row.original.number}
          </Link>
        ),
      },
      {
        accessorKey: 'opening_date',
        header: t('opening_date'),
        cell: ({ row }) => <span className="num text-muted">{row.original.opening_date}</span>,
      },
      {
        id: 'lines',
        header: t('col_lines'),
        cell: ({ row }) => <span className="num text-text">{row.original.lines_count ?? '—'}</span>,
      },
      {
        accessorKey: 'total_quantity',
        header: t('col_quantity'),
        cell: ({ row }) => <div className="num text-end text-text">{row.original.total_quantity}</div>,
      },
      {
        accessorKey: 'total_value',
        header: t('col_total'),
        cell: ({ row }) => <div className="num text-end text-text">{formatRiyal(row.original.total_value)}</div>,
      },
      {
        accessorKey: 'status',
        header: t('col_status'),
        cell: ({ row }) => (
          <Badge tone={row.original.status === 'posted' ? 'positive' : 'muted'}>{t(row.original.status)}</Badge>
        ),
      },
    ],
    [t]
  );

  const actions: PageAction[] = [
    { key: 'import', label: t('import_action'), icon: Upload, href: '/inventory-openings/import', variant: 'primary' },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title={t('title')} description={t('subtitle')} actions={actions} />

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="opening-status">{t('col_status')}</Label>
          <Select
            id="opening-status"
            value={status}
            onChange={(event) => setStatus(event.target.value as '' | OpeningStatus)}
          >
            <option value="">{t('status_all')}</option>
            <option value="draft">{t('draft')}</option>
            <option value="posted">{t('posted')}</option>
          </Select>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={data}
        loading={loading}
        emptyLabel={t('empty')}
        exportName="inventory-openings"
        showToolbar={false}
        mobileRecord={(item) => ({
          title: (
            <Link href={`/inventory-openings/${item.id}`} className="num text-primary hover:underline">
              {item.number}
            </Link>
          ),
          subtitle: item.opening_date,
          amountLabel: t('col_total'),
          amount: formatRiyal(item.total_value),
          status: <Badge tone={item.status === 'posted' ? 'positive' : 'muted'}>{t(item.status)}</Badge>,
          meta: t('col_quantity') + ': ' + item.total_quantity,
        })}
      />
    </div>
  );
}
