'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight, FilePlus2, RefreshCw, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Combobox, type ComboOption } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { api, ApiError } from '@/lib/api';
import { currentUser } from '@/lib/auth';
import { DELIVERY_NOTE_PERMISSIONS, hasPermission, type DeliveryNote, statusTone } from '@/lib/delivery-notes';

interface Partner { id: string; name: string; type: string; is_active?: boolean }
interface Warehouse { id: string; name: string; code?: string | null; is_active: boolean }
interface Paginator { current_page: number; last_page: number; total: number }

export default function DeliveryNotesPage() {
  const t = useTranslations('deliveryNotes');
  const tc = useTranslations('common');
  const user = currentUser();
  const canManage = hasPermission(user?.permissions, user?.role, DELIVERY_NOTE_PERMISSIONS.manage);
  const [notes, setNotes] = useState<DeliveryNote[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [status, setStatus] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<Paginator>({ current_page: 1, last_page: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const customerOptions = useMemo<ComboOption[]>(() => partners.filter((partner) => partner.is_active !== false && (partner.type === 'customer' || partner.type === 'both')).map((partner) => ({ value: partner.id, label: partner.name })), [partners]);
  const warehouseOptions = useMemo<ComboOption[]>(() => warehouses.filter((warehouse) => warehouse.is_active).map((warehouse) => ({ value: warehouse.id, label: warehouse.name, sub: warehouse.code ?? undefined })), [warehouses]);
  const statusLabel = (value: string) => value === 'draft' ? t('statusDraft') : value === 'confirmed' ? t('statusConfirmed') : t('statusCancelled');

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), per_page: '25', sort: 'delivery_date', direction: 'desc' });
    if (status) params.set('status', status);
    if (customerId) params.set('customer_id', customerId);
    if (warehouseId) params.set('warehouse_id', warehouseId);
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    if (query.trim()) params.set('search', query.trim());
    setLoading(true);
    setError(null);
    api<{ data: DeliveryNote[]; meta?: Paginator }>(`/delivery-notes?${params.toString()}`)
      .then((result) => {
        setNotes(result.data);
        setPagination(result.meta ?? { current_page: 1, last_page: 1, total: result.data.length });
      })
      .catch((caught) => setError(caught instanceof ApiError ? caught.message : tc('saveFailed')))
      .finally(() => setLoading(false));
  }, [customerId, dateFrom, dateTo, page, query, status, tc, warehouseId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api<{ data: Partner[] }>('/partners').then((result) => setPartners(result.data)).catch(() => {});
    api<{ data: Warehouse[] }>('/warehouses').then((result) => setWarehouses(result.data)).catch(() => {});
  }, []);

  function applySearch(event: React.FormEvent): void {
    event.preventDefault();
    setPage(1);
    setQuery(search);
  }
  function clearFilters(): void {
    setStatus(''); setCustomerId(''); setWarehouseId(''); setDateFrom(''); setDateTo(''); setSearch(''); setQuery(''); setPage(1);
  }

  return <div className="space-y-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div><h1 className="text-xl font-semibold text-text">{t('title')}</h1><p className="mt-1 text-sm text-muted">{t('listSubtitle')}</p></div>
      {canManage && <Button asChild><Link href="/delivery-notes/new"><FilePlus2 className="h-4 w-4" strokeWidth={1.8} />{t('create')}</Link></Button>}
    </div>

    <section aria-label={t('filters')} className="rounded border border-border bg-surface p-4">
      <form onSubmit={applySearch} className="grid grid-cols-1 gap-3 lg:grid-cols-6">
        <div className="lg:col-span-2"><Label htmlFor="delivery-search" className="sr-only">{t('search')}</Label><div className="relative"><Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" strokeWidth={1.7} /><Input id="delivery-search" className="ps-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('search')} /></div></div>
        <Select value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }} aria-label={t('status')}><option value="">{t('allStatuses')}</option><option value="draft">{t('statusDraft')}</option><option value="confirmed">{t('statusConfirmed')}</option><option value="cancelled">{t('statusCancelled')}</option></Select>
        <Combobox value={customerId} onChange={(value) => { setPage(1); setCustomerId(value); }} options={customerOptions} placeholder={t('allCustomers')} searchPlaceholder={t('searchCustomers')} emptyText={t('noCustomers')} clearLabel={t('allCustomers')} aria-label={t('customer')} />
        <Combobox value={warehouseId} onChange={(value) => { setPage(1); setWarehouseId(value); }} options={warehouseOptions} placeholder={t('allWarehouses')} searchPlaceholder={t('searchWarehouses')} emptyText={t('noWarehouses')} clearLabel={t('allWarehouses')} aria-label={t('warehouse')} />
        <div className="flex gap-2"><Button type="submit" className="flex-1">{t('apply')}</Button><Button type="button" variant="outline" onClick={clearFilters}>{t('clear')}</Button></div>
        <div className="lg:col-span-3"><Label htmlFor="delivery-from" className="mb-1.5 block">{t('dateRange')}</Label><div className="grid grid-cols-2 gap-2"><Input id="delivery-from" type="date" dir="ltr" value={dateFrom} onChange={(event) => { setPage(1); setDateFrom(event.target.value); }} aria-label={t('dateFrom')} /><Input type="date" dir="ltr" value={dateTo} onChange={(event) => { setPage(1); setDateTo(event.target.value); }} aria-label={t('dateTo')} /></div></div>
      </form>
    </section>

    {error && <section role="alert" className="flex items-center justify-between gap-3 rounded border border-negative/30 bg-negative/10 p-4 text-sm text-negative"><span>{error}</span><Button variant="outline" size="sm" onClick={load}><RefreshCw className="h-4 w-4" strokeWidth={1.7} />{t('retry')}</Button></section>}

    <section className="overflow-hidden rounded border border-border bg-surface">
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm"><thead className="border-b border-border bg-muted/50 text-start text-xs font-medium text-muted"><tr><th className="px-4 py-3">{t('number')}</th><th className="px-4 py-3">{t('customer')}</th><th className="px-4 py-3">{t('warehouse')}</th><th className="px-4 py-3">{t('deliveryDate')}</th><th className="px-4 py-3">{t('status')}</th><th className="px-4 py-3">{t('externalReference')}</th></tr></thead>
          <tbody>{loading ? Array.from({ length: 6 }).map((_, index) => <tr key={index} className="border-b border-border last:border-0"><td colSpan={6} className="px-4 py-3"><div className="h-5 animate-pulse rounded bg-muted" /></td></tr>) : notes.map((note) => <tr key={note.id} className="border-b border-border last:border-0 hover:bg-primary-soft/30"><td className="px-4 py-3"><Link className="num font-medium text-primary hover:underline" href={`/delivery-notes/${note.id}`}>{note.number}</Link></td><td className="px-4 py-3 text-text">{note.customer?.name ?? '—'}</td><td className="px-4 py-3 text-muted">{note.warehouse?.name ?? '—'}</td><td className="num px-4 py-3 text-muted" dir="ltr">{note.delivery_date}</td><td className="px-4 py-3"><Badge tone={statusTone(note.status)}>{statusLabel(note.status)}</Badge></td><td className="px-4 py-3 text-muted">{note.external_reference ?? '—'}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="divide-y divide-border md:hidden">{loading ? Array.from({ length: 4 }).map((_, index) => <div className="p-4" key={index}><div className="h-20 animate-pulse rounded bg-muted" /></div>) : notes.map((note) => <Link key={note.id} href={`/delivery-notes/${note.id}`} className="block p-4 transition-colors hover:bg-primary-soft/30"><div className="flex items-center justify-between gap-3"><span className="num font-medium text-primary">{note.number}</span><Badge tone={statusTone(note.status)}>{statusLabel(note.status)}</Badge></div><p className="mt-2 font-medium text-text">{note.customer?.name ?? '—'}</p><div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted"><span>{note.warehouse?.name ?? '—'}</span><span dir="ltr">{note.delivery_date}</span></div></Link>)}</div>
      {!loading && notes.length === 0 && <div className="px-6 py-16 text-center"><p className="font-medium text-text">{t('emptyTitle')}</p><p className="mt-1 text-sm text-muted">{t('emptyHint')}</p>{canManage && <Button asChild className="mt-4"><Link href="/delivery-notes/new">{t('create')}</Link></Button>}</div>}
    </section>

    {!loading && pagination.last_page > 1 && <nav aria-label={t('pagination')} className="flex items-center justify-between gap-3"><p className="text-sm text-muted">{t('resultsCount', { count: pagination.total })}</p><div className="flex gap-2"><Button variant="outline" size="sm" disabled={pagination.current_page <= 1} onClick={() => setPage((value) => value - 1)}><ChevronRight className="h-4 w-4 rtl:rotate-180" />{t('previous')}</Button><span className="num flex items-center px-2 text-sm text-muted">{pagination.current_page} / {pagination.last_page}</span><Button variant="outline" size="sm" disabled={pagination.current_page >= pagination.last_page} onClick={() => setPage((value) => value + 1)}>{t('next')}<ChevronLeft className="h-4 w-4 rtl:rotate-180" /></Button></div></nav>}
  </div>;
}
