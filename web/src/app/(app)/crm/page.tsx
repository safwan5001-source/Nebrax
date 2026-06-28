'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus, Pencil } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ActivityDialog, type Activity } from '@/components/crm/activity-dialog';
import { api } from '@/lib/api';

interface Partner { id: string; name: string }

export default function CrmPage() {
  const t = useTranslations('crm');
  const [data, setData] = useState<Activity[]>([]);
  const [partners, setPartners] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState(false);
  const [editing, setEditing] = useState<Activity | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([api<{ data: Activity[] }>('/crm-activities'), api<{ data: Partner[] }>('/partners')])
      .then(([ac, prt]) => {
        setData(ac.data);
        setPartners(Object.fromEntries(prt.data.map((p) => [p.id, p.name])));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);

  const columns = useMemo<ColumnDef<Activity, unknown>[]>(
    () => [
      { accessorKey: 'subject', header: t('subject') },
      { accessorKey: 'type', header: t('type'), cell: ({ row }) => <Badge tone="neutral">{t(row.original.type)}</Badge> },
      {
        id: 'partner',
        header: t('customer'),
        accessorFn: (r) => (r.partner_id ? partners[r.partner_id] ?? '—' : '—'),
        cell: ({ row }) => (row.original.partner_id ? partners[row.original.partner_id] ?? '—' : '—'),
      },
      {
        accessorKey: 'activity_at',
        header: t('when'),
        cell: ({ row }) => <span className="num text-muted">{(row.original.activity_at ?? '').slice(0, 16).replace('T', ' ')}</span>,
      },
      { accessorKey: 'status', header: t('status'), cell: ({ row }) => <Badge tone={row.original.status === 'done' ? 'positive' : 'warning'}>{t(row.original.status)}</Badge> },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <Button variant="ghost" size="icon" aria-label={t('edit')} onClick={() => { setEditing(row.original); setDialog(true); }}>
            <Pencil className="h-4 w-4" strokeWidth={1.7} />
          </Button>
        ),
      },
    ],
    [partners, t]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
        <Button onClick={() => { setEditing(null); setDialog(true); }}>
          <Plus className="h-4 w-4" strokeWidth={1.8} />
          {t('create')}
        </Button>
      </div>

      <DataTable columns={columns} data={data} loading={loading} searchPlaceholder={t('search')} emptyLabel={t('empty')} exportName="crm-activities" />

      {dialog && <ActivityDialog open onClose={() => setDialog(false)} onSaved={load} activity={editing} />}
    </div>
  );
}
