'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus, Pencil } from 'lucide-react';
import { AdvancedFilterDialog } from '@/components/data-explorer/advanced-filter-dialog';
import { DataTable } from '@/components/data-table';
import { ListToolbar, PageHeader, Pagination, type PageAction, type SortOption } from '@/components/nebrax';
import { Button } from '@/components/ui/button';
import { ContactDialog, type Contact } from '@/components/contacts/contact-dialog';
import { api } from '@/lib/api';
import type { ActiveFilter, DataExplorerState, FilterDefinition } from '@/lib/data-explorer/types';
import { parseExplorerState, removeFilter, replaceFilter, serializeExplorerState } from '@/lib/data-explorer/url-state';

interface Partner { id: string; name: string }

function filterValue(filter?: ActiveFilter): string {
  if (!filter || Array.isArray(filter.value)) return '';
  return String(filter.value).trim();
}

function isEmptyFilter(filter: ActiveFilter): boolean {
  return Array.isArray(filter.value)
    ? filter.value.every((value) => String(value).trim() === '')
    : String(filter.value).trim() === '';
}

export default function ContactsPage() {
  const t = useTranslations('contacts');
  const router = useRouter();
  const searchParams = useSearchParams();
  const [explorer, setExplorer] = useState<DataExplorerState>(() => {
    const parsed = parseExplorerState(new URLSearchParams(searchParams.toString()));
    return { ...parsed, perPage: parsed.perPage ?? 25, sort: parsed.sort ?? 'name' };
  });
  const [searchInput, setSearchInput] = useState(explorer.search);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [data, setData] = useState<Contact[]>([]);
  const [partners, setPartners] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([api<{ data: Contact[] }>('/contacts'), api<{ data: Partner[] }>('/partners')])
      .then(([contacts, partnerResponse]) => {
        setData(contacts.data);
        setPartners(Object.fromEntries(partnerResponse.data.map((partner) => [partner.id, partner.name])));
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
    router.replace(url.toString() ? `/contacts?${url.toString()}` : '/contacts', { scroll: false });
  }, [explorer, router]);

  const partnerOptions = useMemo(() => Object.entries(partners)
    .sort(([, left], [, right]) => left.localeCompare(right, 'ar'))
    .map(([value, label]) => ({ value, label })), [partners]);

  const definitions = useMemo<FilterDefinition[]>(() => [
    {
      key: 'partner_id',
      label: t('customer'),
      kind: 'entity',
      quick: true,
      searchPlaceholder: t('search'),
      emptyText: t('empty'),
      options: partnerOptions,
    },
  ], [partnerOptions, t]);

  const labelledFilters = useMemo(() => explorer.filters.map((filter) => ({
    ...filter,
    label: definitions.find((definition) => definition.key === filter.key)?.label ?? filter.label,
  })), [definitions, explorer.filters]);

  const filtered = useMemo(() => {
    const query = explorer.search.trim().toLocaleLowerCase();
    const partnerId = filterValue(explorer.filters.find((filter) => filter.key === 'partner_id'));
    return data.filter((contact) => {
      if (query) {
        const haystack = [contact.name, contact.job_title, contact.email, contact.phone, contact.partner_id ? partners[contact.partner_id] : '']
          .filter(Boolean)
          .join(' ')
          .toLocaleLowerCase();
        if (!haystack.includes(query)) return false;
      }
      if (partnerId && contact.partner_id !== partnerId) return false;
      return true;
    });
  }, [data, explorer.filters, explorer.search, partners]);

  const sorted = useMemo(() => {
    const next = [...filtered];
    const sort = explorer.sort ?? 'name';
    const desc = sort.startsWith('-');
    const key = sort.replace(/^-/, '');
    next.sort((left, right) => {
      let comparison = 0;
      if (key === 'partner') comparison = (left.partner_id ? partners[left.partner_id] ?? '' : '').localeCompare(right.partner_id ? partners[right.partner_id] ?? '' : '', 'ar');
      else if (key === 'job_title') comparison = (left.job_title ?? '').localeCompare(right.job_title ?? '', 'ar');
      else comparison = left.name.localeCompare(right.name, 'ar');
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
    [partners, t],
  );

  const sortOptions: SortOption[] = [
    { value: 'name', label: t('name') },
    { value: '-name', label: `${t('name')} ↓` },
    { value: 'partner', label: t('customer') },
    { value: 'job_title', label: t('job_title') },
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
        sort={{ value: explorer.sort ?? 'name', onChange: (value) => setExplorer((current) => ({ ...current, page: 1, sort: value })), options: sortOptions }}
        resultCount={sorted.length}
        totalCount={data.length}
      />

      <DataTable
        columns={columns}
        data={pageData}
        loading={loading}
        emptyLabel={t('empty')}
        exportName="contacts"
        showToolbar={false}
        mobileRecord={(contact) => ({
          title: contact.name,
          subtitle: contact.job_title ?? (contact.partner_id ? partners[contact.partner_id] ?? '—' : '—'),
          caption: contact.partner_id ? partners[contact.partner_id] ?? undefined : undefined,
          secondary: { label: t('phone'), value: contact.phone ?? '—' },
          meta: contact.email ?? '—',
          actions: (
            <Button variant="ghost" size="icon" aria-label={t('edit')} onClick={() => { setEditing(contact); setDialog(true); }}>
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

      {dialog && <ContactDialog open onClose={() => setDialog(false)} onSaved={load} contact={editing} />}
    </div>
  );
}
