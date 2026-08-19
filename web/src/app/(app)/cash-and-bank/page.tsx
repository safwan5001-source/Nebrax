'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Building2, Eye, Landmark, MoreHorizontal, Pencil, Plus, Trash2, Wallet } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dropdown, DropdownItem } from '@/components/ui/dropdown';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { type CashBankAccount } from '@/lib/cash-bank';
import { formatRiyal } from '@/lib/money';

export default function CashAndBankPage() {
  const t = useTranslations('cashBank');
  const tc = useTranslations('common');
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [items, setItems] = useState<CashBankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api<{ data: CashBankAccount[] }>('/cash-bank-accounts')
      .then((response) => setItems(response.data))
      .catch((err) => toastError(err instanceof ApiError ? err.message : t('load_list_failed')))
      .finally(() => setLoading(false));
  }, [t, toastError]);

  useEffect(() => load(), [load]);

  const deactivate = useCallback(async (item: CashBankAccount) => {
    if (!window.confirm(t('confirm_deactivate'))) return;
    setActing(item.id);
    try {
      await api(`/cash-bank-accounts/${item.id}/deactivate`, { method: 'POST' });
      success(t('deactivated'));
      load();
    } catch (err) { toastError(err instanceof ApiError ? err.message : tc('saveFailed')); }
    finally { setActing(null); }
  }, [load, success, t, tc, toastError]);

  const makeMain = useCallback(async (item: CashBankAccount) => {
    setActing(item.id);
    try {
      await api(`/cash-bank-accounts/${item.id}/make-main`, { method: 'POST' });
      success(t('main_updated'));
      load();
    } catch (err) { toastError(err instanceof ApiError ? err.message : tc('saveFailed')); }
    finally { setActing(null); }
  }, [load, success, t, tc, toastError]);

  const remove = useCallback(async (item: CashBankAccount) => {
    if (!window.confirm(t('confirm_delete'))) return;
    setActing(item.id);
    try {
      await api(`/cash-bank-accounts/${item.id}`, { method: 'DELETE' });
      success(t('deleted'));
      load();
    } catch (err) { toastError(err instanceof ApiError ? err.message : tc('saveFailed')); }
    finally { setActing(null); }
  }, [load, success, t, tc, toastError]);

  const columns = useMemo<ColumnDef<CashBankAccount, unknown>[]>(() => [
    { id: 'name', header: t('name'), cell: ({ row }) => {
      const item = row.original; const Icon = item.type === 'bank' ? Landmark : Wallet;
      return <Link href={`/cash-and-bank/${item.id}`} className="flex items-center gap-2 text-primary hover:underline"><Icon className="h-4 w-4 shrink-0" strokeWidth={1.7} /><span className="font-medium">{item.name}</span></Link>;
    } },
    { accessorKey: 'type', header: t('type'), cell: ({ row }) => t(row.original.type) },
    { accessorKey: 'account_code', header: t('ledger_account'), cell: ({ row }) => <span className="num text-muted">{row.original.account_code ?? '—'}</span> },
    { accessorKey: 'balance', header: t('balance'), cell: ({ row }) => <span className="num font-medium">{formatRiyal(row.original.balance)}</span> },
    { id: 'status', header: t('status'), cell: ({ row }) => <div className="flex flex-wrap items-center gap-1"><Badge tone={row.original.is_active ? 'positive' : 'muted'}>{t(row.original.is_active ? 'active' : 'inactive')}</Badge>{row.original.is_main && <Badge tone="warning">{t('main')}</Badge>}</div> },
    { id: 'actions', header: '', cell: ({ row }) => {
      const item = row.original; const busy = acting === item.id;
      return <div className="flex justify-end gap-1">
        <Link href={`/cash-and-bank/${item.id}`}><Button size="icon" variant="ghost" aria-label={t('view')}><Eye className="h-4 w-4" strokeWidth={1.7} /></Button></Link>
        <Link href={`/cash-and-bank/new?edit=${item.id}`}><Button size="icon" variant="ghost" aria-label={t('edit')}><Pencil className="h-4 w-4" strokeWidth={1.7} /></Button></Link>
        <Dropdown align="end" menuLabel={t('actions')} triggerClassName="h-9 w-9 justify-center rounded border border-border bg-surface text-text hover:bg-primary-soft" trigger={<MoreHorizontal className="h-4 w-4" strokeWidth={1.7} />}>
          <DropdownItem icon={Building2} onClick={() => router.push(`/cash-and-bank/transfer?source=${item.id}`)}>{t('transfer')}</DropdownItem>
          {!item.is_main && item.is_active && <DropdownItem icon={Building2} onClick={() => makeMain(item)}>{t('make_main')}</DropdownItem>}
          {item.is_active && <DropdownItem icon={Building2} onClick={() => deactivate(item)} disabled={busy}>{t('deactivate')}</DropdownItem>}
          <DropdownItem icon={Trash2} onClick={() => remove(item)} disabled={busy} tone="danger">{t('delete')}</DropdownItem>
        </Dropdown>
      </div>;
    } },
  ], [acting, deactivate, makeMain, remove, router, t]);

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-xl font-semibold text-text">{t('title')}</h1><p className="mt-1 text-sm text-muted">{t('subtitle')}</p></div>
      <Dropdown align="end" menuLabel={t('add')} triggerClassName="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" trigger={<><Plus className="h-4 w-4" strokeWidth={1.8} />{t('add')}</>}>
        <DropdownItem icon={Landmark} href="/cash-and-bank/new?type=bank">{t('add_bank')}</DropdownItem>
        <DropdownItem icon={Wallet} href="/cash-and-bank/new?type=cash">{t('add_cash')}</DropdownItem>
      </Dropdown>
    </div>
    <DataTable columns={columns} data={items} loading={loading} searchPlaceholder={t('search')} emptyLabel={t('empty')} exportName="cash-bank-accounts" />
  </div>;
}
