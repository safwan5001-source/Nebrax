'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { ArrowRight, Link2, Pencil, Plus, TabletSmartphone, TestTube2, Trash2 } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { executeCashDrawerAction, type CashDrawerAction, type CashDrawerBridgeResult } from '@/lib/cash-drawer-bridge';
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
interface PairForm {
  bridgeUrl: string;
  pairingCode: string;
}
interface PairResponse {
  ok: boolean;
  status: 'paired' | string;
  pairing_secret: string;
  printer_identifier: string;
  drawer_channel: number;
  pulse_on_ms: number;
  pulse_off_ms: number;
}

const EMPTY_FORM: DeviceForm = { name: '', code: '', notes: '', warehouse_id: '', is_active: true };
const EMPTY_PAIR_FORM: PairForm = { bridgeUrl: 'http://127.0.0.1:17463', pairingCode: '' };

export default function PosDevicesPage() {
  const t = useTranslations('posDevices');
  const tc = useTranslations('common');
  const ts = useTranslations('salesSettings');
  const { success, error: errorToast } = useToast();
  const [devices, setDevices] = useState<PosDevice[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PosDevice | null>(null);
  const [form, setForm] = useState<DeviceForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pairingDevice, setPairingDevice] = useState<PosDevice | null>(null);
  const [pairForm, setPairForm] = useState<PairForm>(EMPTY_PAIR_FORM);
  const [pairingBusy, setPairingBusy] = useState(false);
  const [testingDeviceId, setTestingDeviceId] = useState<string | null>(null);

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
  function openPair(device: PosDevice) {
    setPairingDevice(device);
    setPairForm({ bridgeUrl: device.cash_drawer.bridge_url ?? EMPTY_PAIR_FORM.bridgeUrl, pairingCode: '' });
    setError(null);
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

  function resultFromApiError(error: unknown): CashDrawerBridgeResult | null {
    const body = error instanceof ApiError ? error.body : null;
    const data = typeof body === 'object' && body !== null && 'data' in body ? (body as { data?: unknown }).data : null;
    return typeof data === 'object' && data !== null && 'status' in data ? data as CashDrawerBridgeResult : null;
  }
  function drawerStatus(device: PosDevice): string {
    const result = device.cash_drawer?.last_result?.status;
    if (!device.cash_drawer?.configured) return t('cash_drawer_not_configured');
    if (result === 'bridge_unavailable') return t('cash_drawer_bridge_unavailable');
    if (result === 'printer_unavailable') return t('cash_drawer_printer_unavailable');
    if (result === 'failed' || result === 'permission_denied') return t('cash_drawer_failed');
    return t('cash_drawer_configured');
  }
  async function pairDrawer(event: React.FormEvent) {
    event.preventDefault();
    if (!pairingDevice || !pairForm.pairingCode.trim()) return;
    setPairingBusy(true); setError(null);
    try {
      const pairResponse = await fetch(`${pairForm.bridgeUrl.replace(/\/+$/, '')}/v1/pair`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id: pairingDevice.id, pairing_code: pairForm.pairingCode.trim() }),
      });
      const bridge = await pairResponse.json() as PairResponse;
      if (!pairResponse.ok || bridge.status !== 'paired' || !bridge.pairing_secret) throw new Error('pairing_failed');
      await api(`/pos-devices/${pairingDevice.id}/cash-drawer/pair`, {
        method: 'POST',
        body: {
          bridge_url: pairForm.bridgeUrl.replace(/\/+$/, ''), pairing_secret: bridge.pairing_secret,
          printer_identifier: bridge.printer_identifier, drawer_channel: bridge.drawer_channel,
          pulse_on_ms: bridge.pulse_on_ms, pulse_off_ms: bridge.pulse_off_ms,
        },
      });
      success(t('pairing_success')); setPairingDevice(null); await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('cash_drawer_test_failed'));
    } finally { setPairingBusy(false); }
  }
  async function testDrawer(device: PosDevice) {
    setTestingDeviceId(device.id); setError(null);
    try {
      let action: CashDrawerAction;
      try {
        action = (await api<{ data: CashDrawerAction }>(`/pos-devices/${device.id}/cash-drawer/test`, { method: 'POST' })).data;
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) { errorToast(t('cash_drawer_session_required')); return; }
        const result = resultFromApiError(err);
        if (result) { errorToast(t('cash_drawer_test_failed')); return; }
        throw err;
      }
      const settle = async (path: string, body: Record<string, unknown>) => {
        try { return (await api<{ data: CashDrawerBridgeResult }>(path, { method: 'POST', body })).data; }
        catch (err) { const result = resultFromApiError(err); if (result) return result; throw err; }
      };
      const result = await executeCashDrawerAction(
        action,
        (actionId, bridgeResult) => settle(`/pos-devices/${device.id}/cash-drawer/test/complete`, { action_id: actionId, result: bridgeResult }),
        (actionId) => settle(`/pos-devices/${device.id}/cash-drawer/test/unavailable`, { action_id: actionId }),
      );
      if (result.status === 'opened') success(t('cash_drawer_opened'));
      else errorToast(t('cash_drawer_test_failed'));
      await load();
    } catch (err) {
      errorToast(err instanceof ApiError ? err.message : t('cash_drawer_test_failed'));
    } finally { setTestingDeviceId(null); }
  }

  const columns = useMemo<ColumnDef<PosDevice, unknown>[]>(() => [
    { accessorKey: 'name', header: t('name'), cell: ({ row }) => <div className="min-w-40"><div className="font-medium text-text">{row.original.name}</div>{row.original.code && <div className="num mt-0.5 text-xs text-muted">{row.original.code}</div>}</div> },
    { id: 'warehouse', header: t('warehouse'), accessorFn: (device) => device.warehouse?.name ?? '', cell: ({ row }) => row.original.warehouse ? <div><div>{row.original.warehouse.name}</div><div className="num mt-0.5 text-xs text-muted">{row.original.warehouse.code}</div></div> : '—' },
    { id: 'cash_drawer', header: t('cash_drawer'), cell: ({ row }) => <div className="space-y-1"><Badge tone={row.original.cash_drawer?.configured ? 'positive' : 'muted'}>{drawerStatus(row.original)}</Badge>{row.original.cash_drawer?.printer_identifier && <div className="max-w-36 truncate text-xs text-muted" title={row.original.cash_drawer.printer_identifier}>{row.original.cash_drawer.printer_identifier}</div>}{row.original.cash_drawer?.last_result?.at && <div className="text-xs text-muted">{t('last_test')}: {new Date(row.original.cash_drawer.last_result.at).toLocaleString()}</div>}{row.original.cash_drawer?.last_success_at && <div className="text-xs text-muted">{t('last_success')}: {new Date(row.original.cash_drawer.last_success_at).toLocaleString()}</div>}</div> },
    { accessorKey: 'is_active', header: t('status'), cell: ({ row }) => <Badge tone={row.original.is_active ? 'positive' : 'muted'}>{row.original.is_active ? t('active') : t('inactive')}</Badge> },
    { id: 'actions', header: '', cell: ({ row }) => <div className="flex items-center justify-end gap-1"><Button variant="ghost" size="icon" onClick={() => openPair(row.original)} aria-label={t('cash_drawer_pair')}><Link2 className="h-4 w-4" strokeWidth={1.7} /></Button><Button variant="ghost" size="icon" disabled={!row.original.cash_drawer?.configured || testingDeviceId === row.original.id} onClick={() => void testDrawer(row.original)} aria-label={testingDeviceId === row.original.id ? t('testing_cash_drawer') : t('test_cash_drawer')}><TestTube2 className="h-4 w-4" strokeWidth={1.7} /></Button><Button variant="ghost" size="icon" onClick={() => openEdit(row.original)} aria-label={t('edit', { name: row.original.name })}><Pencil className="h-4 w-4" strokeWidth={1.7} /></Button><Button variant="ghost" size="icon" onClick={() => void remove(row.original)} aria-label={t('delete', { name: row.original.name })}><Trash2 className="h-4 w-4" strokeWidth={1.7} /></Button></div> },
  ], [t, testingDeviceId]);

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><Button asChild variant="ghost" size="icon" aria-label={t('back_to_settings')}><Link href='/pos/settings'><ArrowRight className="h-4 w-4" strokeWidth={1.7} /></Link></Button><div><h1 className="text-xl font-semibold text-text">{t('title')}</h1><p className="mt-1 text-sm text-muted">{t('subtitle')}</p></div></div><Button onClick={openCreate} disabled={warehouses.length === 0} title={warehouses.length === 0 ? t('no_warehouse') : undefined}><Plus className="h-4 w-4" strokeWidth={1.8} />{t('add')}</Button></div>
    {error && <p role="alert" className="rounded bg-negative/10 px-3 py-2 text-sm text-negative">{error}</p>}
    <DataTable columns={columns} data={devices} loading={loading} searchPlaceholder={t('search')} emptyLabel={t('empty')} exportName="pos-devices" />
    <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={editing ? t('edit_title') : t('add_title')}><form onSubmit={submit} className="space-y-4"><div className="space-y-1.5"><Label htmlFor="device-name">{t('name')}</Label><Input id="device-name" value={form.name} onChange={(event) => updateForm('name', event.target.value)} minLength={2} required disabled={saving} /></div><div className="space-y-1.5"><Label htmlFor="device-code">{t('code')}</Label><Input id="device-code" className="num" value={form.code} onChange={(event) => updateForm('code', event.target.value)} disabled={saving} /><p className="text-xs text-muted">{t('code_hint')}</p></div><div className="space-y-1.5"><Label htmlFor="device-warehouse">{t('warehouse')}</Label><Select id="device-warehouse" value={form.warehouse_id} onChange={(event) => updateForm('warehouse_id', event.target.value)} required disabled={saving}><option value="">{t('select_warehouse')}</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name} · {warehouse.code}</option>)}</Select></div><div className="space-y-1.5"><Label htmlFor="device-notes">{t('notes')}</Label><textarea id="device-notes" value={form.notes} onChange={(event) => updateForm('notes', event.target.value)} rows={3} disabled={saving} className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60" /></div><label className="flex items-center gap-2 text-sm text-text"><input className="h-4 w-4 accent-primary focus-visible:ring-2 focus-visible:ring-primary/40" type="checkbox" checked={form.is_active} onChange={(event) => updateForm('is_active', event.target.checked)} disabled={saving} />{t('active')}</label>{error && <p role="alert" className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}<div className="flex justify-end gap-2 pt-1"><Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>{tc('cancel')}</Button><Button type="submit" disabled={saving || form.name.trim().length < 2 || !form.warehouse_id}>{ts('save')}</Button></div></form></Dialog>
    <Dialog open={pairingDevice !== null} onClose={() => setPairingDevice(null)} title={t('cash_drawer_pair_title')}><form onSubmit={pairDrawer} className="space-y-4"><p className="text-sm leading-relaxed text-muted">{t('cash_drawer_pair_hint')}</p><div className="space-y-1.5"><Label htmlFor="bridge-url">{t('bridge_url')}</Label><Input id="bridge-url" dir="ltr" className="num" value={pairForm.bridgeUrl} onChange={(event) => setPairForm((current) => ({ ...current, bridgeUrl: event.target.value }))} required disabled={pairingBusy} /></div><div className="space-y-1.5"><Label htmlFor="pairing-code">{t('pairing_code')}</Label><Input id="pairing-code" dir="ltr" className="num" type="password" autoComplete="one-time-code" value={pairForm.pairingCode} onChange={(event) => setPairForm((current) => ({ ...current, pairingCode: event.target.value }))} required disabled={pairingBusy} /></div><div className="flex justify-end gap-2 pt-1"><Button type="button" variant="outline" onClick={() => setPairingDevice(null)} disabled={pairingBusy}>{tc('cancel')}</Button><Button type="submit" disabled={pairingBusy || !pairForm.pairingCode.trim()}>{t('pairing')}</Button></div></form></Dialog>
    {!loading && warehouses.length === 0 && <div className="flex items-center gap-3 rounded border border-warning/30 bg-warning/10 px-3 py-3 text-sm text-text"><TabletSmartphone className="h-4 w-4 shrink-0" strokeWidth={1.7} aria-hidden="true" /><p>{t('no_warehouse')}</p></div>}
  </div>;
}
