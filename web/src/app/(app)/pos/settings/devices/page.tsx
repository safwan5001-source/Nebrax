'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { ArrowRight, Pencil, Plus, TabletSmartphone, Trash2 } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';

interface Warehouse {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
}
interface CashDrawerConfig {
  configured: boolean;
  bridge_url: string | null;
  printer_identifier: string | null;
  drawer_channel: number | null;
  pulse_on_ms: number | null;
  pulse_off_ms: number | null;
  paired_at: string | null;
  last_result: { status: string; error_code: string | null; at: string } | null;
  last_success_at: string | null;
}
interface PosDevice {
  id: string;
  name: string;
  code: string | null;
  notes: string | null;
  warehouse_id: string;
  warehouse: { id: string; name: string; code: string } | null;
  cash_drawer: CashDrawerConfig;
  is_active: boolean;
}
interface DeviceForm {
  name: string;
  code: string;
  notes: string;
  warehouse_id: string;
  is_active: boolean;
}
const EMPTY_FORM: DeviceForm = { name: '', code: '', notes: '', warehouse_id: '', is_active: true };

export default function PosDevicesPage() {
  const t = useTranslations('posDevices');
  const tc = useTranslations('common');
  const ts = useTranslations('salesSettings');
  const { success } = useToast();
  const [devices, setDevices] = useState<PosDevice[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PosDevice | null>(null);
  const [form, setForm] = useState<DeviceForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [deviceResult, warehouseResult] = await Promise.all([
        api<{ data: PosDevice[] }>('/pos-devices'),
        api<{ data: Warehouse[] }>('/warehouses'),
      ]);
      setDevices(deviceResult.data);
      setWarehouses(warehouseResult.data.filter((warehouse) => warehouse.is_active));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [tc]);

  useEffect(() => { void load(); }, [load]);

  function updateForm<K extends keyof DeviceForm>(key: K, value: DeviceForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }
  function openCreate() {
    setEditing(null); setForm(EMPTY_FORM); setError(null); setDialogOpen(true);
  }
  function openEdit(device: PosDevice) {
    setEditing(device);
    setForm({ name: device.name, code: device.code ?? '', notes: device.notes ?? '', warehouse_id: device.warehouse_id, is_active: device.is_active });
    setError(null); setDialogOpen(true);
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (form.name.trim().length < 2 || !form.warehouse_id) return;
    setSaving(true); setError(null);
    try {
      if (editing) await api(`/pos-devices/${editing.id}`, { method: 'PUT', body: form });
      else await api('/pos-devices', { method: 'POST', body: form });
      success(editing ? tc('updated') : tc('created'));
      setDialogOpen(false); await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally { setSaving(false); }
  }
  async function remove(device: PosDevice) {
    if (!window.confirm(t('delete_confirm', { name: device.name }))) return;
    setError(null);
    try {
      await api(`/pos-devices/${device.id}`, { method: 'DELETE' });
      success(tc('deleted')); await load();
    } catch (err) { setError(err instanceof ApiError ? err.message : tc('saveFailed')); }
  }

  function drawerStatus(device: PosDevice): string {
    const result = device.cash_drawer?.last_result?.status;
    if (!device.cash_drawer?.configured) return t('cash_drawer_not_configured');
    if (result === 'bridge_unavailable') return t('cash_drawer_bridge_unavailable');
    if (result === 'printer_unavailable') return t('cash_drawer_printer_unavailable');
    if (result === 'failed' || result === 'permission_denied') return t('cash_drawer_failed');
    return t('cash_drawer_configured');
  }

  const columns = useMemo<ColumnDef<PosDevice, unknown>[]>(() => [
    { accessorKey: 'name', header: t('name'), cell: ({ row }) => <div className="min-w-40"><div className="font-medium text-text">{row.original.name}</div>{row.original.code && <div className="num mt-0.5 text-xs text-muted">{row.original.code}</div>}</div> },
    { id: 'warehouse', header: t('warehouse'), accessorFn: (device) => device.warehouse?.name ?? '', cell: ({ row }) => row.original.warehouse ? <div><div>{row.original.warehouse.name}</div><div className="num mt-0.5 text-xs text-muted">{row.original.warehouse.code}</div></div> : '—' },
    { id: 'cash_drawer', header: t('cash_drawer'), cell: ({ row }) => <Badge tone={row.original.cash_drawer?.configured ? 'positive' : 'muted'}>{drawerStatus(row.original)}</Badge> },
    { accessorKey: 'is_active', header: t('status'), cell: ({ row }) => <Badge tone={row.original.is_active ? 'positive' : 'muted'}>{row.original.is_active ? t('active') : t('inactive')}</Badge> },
    { id: 'actions', header: '', cell: ({ row }) => <div className="flex items-center justify-end gap-1"><Button asChild variant="ghost" size="sm" className="text-primary"><Link href={`/pos/settings/cash-drawer?device=${row.original.id}`}>{t('cash_drawer_settings')}</Link></Button><Button variant="ghost" size="icon" onClick={() => openEdit(row.original)} aria-label={t('edit', { name: row.original.name })}><Pencil className="h-4 w-4" strokeWidth={1.7} /></Button><Button variant="ghost" size="icon" onClick={() => void remove(row.original)} aria-label={t('delete', { name: row.original.name })}><Trash2 className="h-4 w-4" strokeWidth={1.7} /></Button></div> },
  ], [t]);

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><Button asChild variant="ghost" size="icon" aria-label={t('back_to_settings')}><Link href='/pos/settings'><ArrowRight className="h-4 w-4" strokeWidth={1.7} /></Link></Button><div><h1 className="text-xl font-semibold text-text">{t('title')}</h1><p className="mt-1 text-sm text-muted">{t('subtitle')}</p></div></div><Button onClick={openCreate} disabled={warehouses.length === 0} title={warehouses.length === 0 ? t('no_warehouse') : undefined}><Plus className="h-4 w-4" strokeWidth={1.8} />{t('add')}</Button></div>
    {error && <p role="alert" className="rounded bg-negative/10 px-3 py-2 text-sm text-negative">{error}</p>}
    <DataTable columns={columns} data={devices} loading={loading} searchPlaceholder={t('search')} emptyLabel={t('empty')} exportName="pos-devices" />
    <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={editing ? t('edit_title') : t('add_title')}><form onSubmit={submit} className="space-y-4"><div className="space-y-1.5"><Label htmlFor="device-name">{t('name')}</Label><Input id="device-name" value={form.name} onChange={(event) => updateForm('name', event.target.value)} minLength={2} required disabled={saving} /></div><div className="space-y-1.5"><Label htmlFor="device-code">{t('code')}</Label><Input id="device-code" className="num" value={form.code} onChange={(event) => updateForm('code', event.target.value)} disabled={saving} /><p className="text-xs text-muted">{t('code_hint')}</p></div><div className="space-y-1.5"><Label htmlFor="device-warehouse">{t('warehouse')}</Label><Select id="device-warehouse" value={form.warehouse_id} onChange={(event) => updateForm('warehouse_id', event.target.value)} required disabled={saving}><option value="">{t('select_warehouse')}</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name} · {warehouse.code}</option>)}</Select></div><div className="space-y-1.5"><Label htmlFor="device-notes">{t('notes')}</Label><textarea id="device-notes" value={form.notes} onChange={(event) => updateForm('notes', event.target.value)} rows={3} disabled={saving} className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60" /></div><label className="flex items-center gap-2 text-sm text-text"><input className="h-4 w-4 accent-primary focus-visible:ring-2 focus-visible:ring-primary/40" type="checkbox" checked={form.is_active} onChange={(event) => updateForm('is_active', event.target.checked)} disabled={saving} />{t('active')}</label>{error && <p role="alert" className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}<div className="flex justify-end gap-2 pt-1"><Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>{tc('cancel')}</Button><Button type="submit" disabled={saving || form.name.trim().length < 2 || !form.warehouse_id}>{ts('save')}</Button></div></form></Dialog>
    {!loading && warehouses.length === 0 && <div className="flex items-center gap-3 rounded border border-warning/30 bg-warning/10 px-3 py-3 text-sm text-text"><TabletSmartphone className="h-4 w-4 shrink-0" strokeWidth={1.7} aria-hidden="true" /><p>{t('no_warehouse')}</p></div>}
  </div>;
}
