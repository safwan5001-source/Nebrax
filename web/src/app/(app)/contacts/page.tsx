'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus, Pencil } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { Button } from '@/components/ui/button';
import { ContactDialog, type Contact } from '@/components/contacts/contact-dialog';
import { api } from '@/lib/api';

interface Partner { id: string; name: string }

export default function ContactsPage() {
  const t = useTranslations('contacts');
  const [data, setData] = useState<Contact[]>([]);
  const [partners, setPartners] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([api<{ data: Contact[] }>('/contacts'), api<{ data: Partner[] }>('/partners')])
      .then(([cn, prt]) => {
        setData(cn.data);
        setPartners(Object.fromEntries(prt.data.map((p) => [p.id, p.name])));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);

  const columns = useMemo<ColumnDef<Contact, unknown>[]>(
    () => [
      { accessorKey: 'name', header: t('name') },
      { accessorKey: 'job_title', header: t('job_title'), cell: ({ row }) => row.original.job_title ?? '—' },
      {
        id: 'partner',
        header: t('customer'),
        accessorFn: (r) => (r.partner_id ? partners[r.partner_id] ?? '—' : '—'),
        cell: ({ row }) => (row.original.partner_id ? partners[row.original.partner_id] ?? '—' : '—'),
      },
      { accessorKey: 'phone', header: t('phone'), cell: ({ row }) => <span className="num text-muted">{row.original.phone ?? '—'}</span> },
      { accessorKey: 'email', header: t('email'), cell: ({ row }) => <span className="num text-muted">{row.original.email ?? '—'}</span> },
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

      <DataTable columns={columns} data={data} loading={loading} searchPlaceholder={t('search')} emptyLabel={t('empty')} exportName="contacts" />

      {dialog && <ContactDialog open onClose={() => setDialog(false)} onSaved={load} contact={editing} />}
    </div>
  );
}
