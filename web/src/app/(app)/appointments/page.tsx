'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus, Pencil } from 'lucide-react';
import { AdvancedFilterDialog } from '@/components/data-explorer/advanced-filter-dialog';
import { DataTable } from '@/components/data-table';
import { ListToolbar, PageHeader, Pagination, type PageAction, type SortOption } from '@/components/nebrax';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AppointmentDialog, type Appointment } from '@/components/appointments/appointment-dialog';
import { api } from '@/lib/api';
import type { ActiveFilter, DataExplorerState, FilterDefinition } from '@/lib/data-explorer/types';
import { parseExplorerState, removeFilter, replaceFilter, serializeExplorerState } from '@/lib/data-explorer/url-state';

interface Partner { id: string; name: string }

const statusTone: Record<string, 'positive' | 'warning' | 'muted' | 'negative'> = {
  scheduled: 'warning',
  done: 'positive',
  cancelled: 'negative',
};

function filterValue(filter?: ActiveFilter): string {
  if (!filter || Array.isArray(filter.value)) return '';
  return String(filter.value).trim();
}

function isEmptyFilter(filter: ActiveFilter): boolean {
  return Array.isArray(filter.value)
    ? filter.value.every((value) => String(value).trim() === '')
    : String(filter.value).trim() === '';
}

function appointmentTime(value: string | null): string {
  return value ? value.slice(0, 16).replace('T', ' ') : '—';
}

export default function AppointmentsPage() {
  const t = useTranslations('appointments');
  const router = useRouter();
  const searchParams = useSearchParams();
  const [explorer, setExplorer] = useState<DataExplorerState>(() => {
    const parsed = parseExplorerState(new URLSearchParams(searchParams.toString()));
    return { ...parsed, perPage: parsed.perPage ?? 25, sort: parsed.sort ?? 'appointment_at' };
  });
  const [searchInput, setSearchInput] = useState(explorer.search);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [data, setData] = useState<Appointment[]>([]);
  const [partners, setPartners] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState(false);
  const [editing, setEditing] = useState<Appointment | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api<{ data: Appointment[] }>('/appointments'),
      api<{ data: Partner[] }>('/partners?type=customer'),
    ])
      .then(([appointments, customers]) => {
        setData(appointments.data);
        setPartners(Object.fromEntries(customers.data.map((partner) => [partner.id, partner.name])));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setExplorer((current) => current.search === searchInput
        ? current
        : { ...current, search: searchInput, page: 1 });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const url = serializeExplorerState(explorer);
    router.replace(url.toString() ? `/appointments?${url.toString()}` : '/appointments', { scroll: false });
  }, [explorer, router]);

  const customerOptions = useMemo(() => Object.entries(partners)
    .sort(([, left], [, right]) => left.localeCompare(right, 'ar'))
    .map(([value, label]) => ({ value, label })), [partners]);

  const definitions = useMemo<FilterDefinition[]>(() => [
    {
      key: 'partner_id',
      label: t('customer'),
      kind: 'entity',
      quick: true,
      searchPlaceholder: t('search'),
      emptyText: t('none'),
      options: customerOptions,
    },
    {
      key: 'status',
      label: t('status'),
      kind: 'select',
      quick: true,
      options: ['scheduled', 'done', 'cancelled'].map((value) => ({ value, label: t(value) })),
    },
    { key: 'date_from', label: `${t('when')} ≥`, kind: 'date' },
    { key: 'date_to', label: `${t('when')} ≤`, kind: 'date' },
  ], [customerOptions, t]);

  const labelledFilters = useMemo(() => explorer.filters.map((filter) => ({
    ...filter,
    label: definitions.find((definition) => definition.key === filter.key)?.label ?? filter.label,
  })), [definitions, explorer.filters]);

  const filtered = useMemo(() => {
    const filters = new Map(explorer.filters.map((filter) => [filter.key, filter]));
    const query = explorer.search.trim().toLocaleLowerCase();
    const partnerId = filterValue(filters.get('partner_id'));
    const status = filterValue(filters.get('status'));
    const dateFrom = filterValue(filters.get('date_from'));
    const dateTo = filterValue(filters.get('date_to'));

    return data.filter((appointment) => {
      if (query) {
        const haystack = [
          appointment.title,
          appointment.partner_id ? partners[appointment.partner_id] : '',
          appointment.location,
          appointment.status,
        ]
          .filter(Boolean)
          .join(' ')
          .toLocaleLowerCase();
        if (!haystack.includes(query)) return false;
      }
      if (partnerId && appointment.partner_id !== partnerId) return false;
      if (status && appointment.status !== status) return false;
      const when = appointment.appointment_at?.slice(0, 10) ?? '';
      if (dateFrom && (!when || when < dateFrom)) return false;
      if (dateTo && (!when || when > dateTo)) return false;
      return true;
    });
  }, [data, explorer.filters, explorer.search, partners]);

  const sorted = useMemo(() => {
    const next = [...filtered];
    const sort = explorer.sort ?? 'appointment_at';
    const desc = sort.startsWith('-');
    const key = sort.replace(/^-/, '');
    next.sort((left, right) => {
      let comparison = 0;
      if (key === 'title') comparison = left.title.localeCompare(right.title, 'ar');
      else if (key === 'partner') comparison = (left.partner_id ? partners[left.partner_id] ?? '' : '').localeCompare(right.partner_id ? partners[right.partner_id] ?? '' : '', 'ar');
      else if (key === 'status') comparison = left.status.localeCompare(right.status, 'ar');
      else comparison = (left.appointment_at ?? '').localeCompare(right.appointment_at ?? '');
      return desc ? -comparison : comparison;
    });
    return next;
  }, [explorer.sort, filtered, partners]);

  const perPage = explorer.perPage ?? 25;
  const totalPages = Math.max(1, Math.ceil(sorted.length / perPage));
  const page = Math.min(explorer.page ?? 1, totalPages);
  const pageData = sorted.slice((page - 1) * perPage, page * perPage);

  function updateFilter(next: ActiveFilter) {
    setExplorer((current) => ({
      ...current,
      page: 1,
      filters: isEmptyFilter(next) ? removeFilter(current.filters, next.key) : replaceFilter(current.filters, next),
    }));
  }

  const columns = useMemo<ColumnDef<Appointment, unknown>[]>(
    () => [
      { accessorKey: 'title', header: t('title') },
      {
        id: 'partner',
        header: t('customer'),
        accessorFn: (r) => (r.partner_id ? partners[r.partner_id] ?? '—' : '—'),
        cell: ({ row }) => (row.original.partner_id ? partners[row.original.partner_id] ?? '—' : '—'),
      },
      {
        accessorKey: 'appointment_at',
        header: t('when'),
        cell: ({ row }) => <span className="num text-muted">{appointmentTime(row.original.appointment_at)}</span>,
      },
      { accessorKey: 'location', header: t('location'), cell: ({ row }) => row.original.location ?? '—' },
      { accessorKey: 'status', header: t('status'), cell: ({ row }) => <Badge tone={statusTone[row.original.status] ?? 'muted'}>{t(row.original.status)}</Badge> },
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
    [partners, t],
  );

  const sortOptions: SortOption[] = [
    { value: 'appointment_at', label: `${t('when')} ↑` },
    { value: '-appointment_at', label: `${t('when')} ↓` },
    { value: 'title', label: t('title') },
    { value: 'partner', label: t('customer') },
    { value: 'status', label: t('status') },
  ];

  const headerActions: PageAction[] = [
    { key: 'create', label: t('create'), icon: Plus, onClick: () => { setEditing(null); setDialog(true); }, variant: 'primary' },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title={t('title')} actions={headerActions} />

      <ListToolbar
        search={searchInput}
        searchPlaceholder={t('search')}
        searchLabel={t('title')}
        onSearchChange={setSearchInput}
        definitions={definitions}
        filters={labelledFilters}
        onFilterChange={updateFilter}
        onRemoveFilter={(key) => setExplorer((current) => ({ ...current, page: 1, filters: removeFilter(current.filters, key) }))}
        onClearFilters={() => setExplorer((current) => ({ ...current, page: 1, filters: [] }))}
        onOpenAdvanced={() => setAdvancedOpen(true)}
        sort={{
          value: explorer.sort ?? 'appointment_at',
          onChange: (value) => setExplorer((current) => ({ ...current, page: 1, sort: value })),
          options: sortOptions,
        }}
        resultCount={sorted.length}
        totalCount={data.length}
      />

      <DataTable
        columns={columns}
        data={pageData}
        loading={loading}
        emptyLabel={t('empty')}
        exportName="appointments"
        showToolbar={false}
        mobileRecord={(appointment) => ({
          title: appointment.title,
          subtitle: appointment.partner_id ? partners[appointment.partner_id] ?? '—' : '—',
          badge: <Badge tone={statusTone[appointment.status] ?? 'muted'}>{t(appointment.status)}</Badge>,
          secondary: { label: t('location'), value: appointment.location ?? '—' },
          meta: appointmentTime(appointment.appointment_at),
          actions: (
            <Button variant="ghost" size="icon" aria-label={t('edit')} onClick={() => { setEditing(appointment); setDialog(true); }}>
              <Pencil className="h-4 w-4" strokeWidth={1.7} />
            </Button>
          ),
        })}
      />

      <Pagination
        page={page}
        lastPage={totalPages}
        perPage={perPage}
        total={sorted.length}
        disabled={loading}
        onPageChange={(next) => setExplorer((current) => ({ ...current, page: next }))}
        onPerPageChange={(next) => setExplorer((current) => ({ ...current, page: 1, perPage: next }))}
      />

      <AdvancedFilterDialog
        open={advancedOpen}
        onClose={() => setAdvancedOpen(false)}
        definitions={definitions}
        filters={labelledFilters}
        onApply={(filters) => setExplorer((current) => ({ ...current, page: 1, filters }))}
      />

      {dialog && (
        <AppointmentDialog open onClose={() => setDialog(false)} onSaved={load} appointment={editing} />
      )}
    </div>
  );
}
