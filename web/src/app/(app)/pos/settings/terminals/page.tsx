'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { ArrowRight, CreditCard, Pencil, Plus } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { useCan } from '@/lib/use-can';
import { useTerminalErrorText } from '@/components/pos/pos-terminal-pay';
import { MANAGE_PERMISSION, reasonOf, type PosPaymentTerminal, type TerminalProvider } from '@/modules/pos-terminals/contract';

interface PosDevice { id: string; name: string; code: string | null; is_active: boolean }
interface TerminalForm { name: string; code: string; provider: string; pos_device_id: string; is_active: boolean }
const EMPTY_FORM: TerminalForm = { name: '', code: '', provider: '', pos_device_id: '', is_active: true };

/** إدارة أجهزة دفع POS وربطها بأجهزة نقطة البيع (PAY-H6-UI-01). المزوّد لا يتغيّر بعد الإنشاء (الخادم يمنعه). */
export default function PosTerminalsPage() {
  const t = useTranslations('posTerminals');
  const tc = useTranslations('common');
  const errorText = useTerminalErrorText();
  const { success } = useToast();
  const { can } = useCan();
  const canManage = can(MANAGE_PERMISSION);
  const [terminals, setTerminals] = useState<PosPaymentTerminal[]>([]);
  const [providers, setProviders] = useState<TerminalProvider[]>([]);
  const [devices, setDevices] = useState<PosDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PosPaymentTerminal | null>(null);
  const [form, setForm] = useState<TerminalForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, deviceList] = await Promise.all([
        api<{ data: PosPaymentTerminal[]; meta?: { providers?: TerminalProvider[] } }>('/pos-payment-terminals'),
        api<{ data: PosDevice[] }>('/pos-devices'),
      ]);
      setTerminals(list.data);
      setProviders(list.meta?.providers ?? []);
      setDevices(deviceList.data.filter((device) => device.is_active));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [tc]);
  useEffect(() => { void load(); }, [load]);

  function patch<K extends keyof TerminalForm>(key: K, value: TerminalForm[K]) { setForm((current) => ({ ...current, [key]: value })); }
  function openCreate() {
    setEditing(null); setForm({ ...EMPTY_FORM, provider: providers[0]?.key ?? '' }); setError(null); setDialogOpen(true);
  }
  function openEdit(terminal: PosPaymentTerminal) {
    setEditing(terminal);
    setForm({ name: terminal.name, code: terminal.code ?? '', provider: terminal.provider, pos_device_id: terminal.pos_device_id ?? '', is_active: terminal.is_active });
    setError(null); setDialogOpen(true);
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (form.name.trim().length < 2 || (!editing && !form.provider)) return;
    setSaving(true); setError(null);
    try {
      const common = { name: form.name.trim(), code: form.code.trim() || null, pos_device_id: form.pos_device_id || null, is_active: form.is_active };
      if (editing) await api(`/pos-payment-terminals/${editing.id}`, { method: 'PUT', body: common });
      else await api('/pos-payment-terminals', { method: 'POST', body: { ...common, provider: form.provider } });
      success(editing ? tc('updated') : tc('created'));
      setDialogOpen(false); await load();
    } catch (err) {
      setError(reasonOf(err) ? errorText(err) : err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally { setSaving(false); }
  }

  const deviceName = useCallback((id: string | null) => (id ? devices.find((device) => device.id === id)?.name ?? '—' : t('any_device')), [devices, t]);

  const columns = useMemo<ColumnDef<PosPaymentTerminal, unknown>[]>(() => [
    { accessorKey: 'name', header: t('name'), cell: ({ row }) => <div className="min-w-40"><div className="font-medium text-text">{row.original.name}</div>{row.original.code && <div className="num mt-0.5 text-xs text-muted">{row.original.code}</div>}</div> },
    { id: 'provider', header: t('provider'), accessorFn: (terminal) => terminal.provider, cell: ({ row }) => <div className="flex flex-wrap items-center gap-1.5"><span className="num text-sm">{row.original.provider}</span>{row.original.simulated && <Badge tone="warning">{t('simulated')}</Badge>}</div> },
    { id: 'device', header: t('device'), accessorFn: (terminal) => deviceName(terminal.pos_device_id), cell: ({ row }) => <span className="text-sm text-text">{deviceName(row.original.pos_device_id)}</span> },
    { accessorKey: 'is_active', header: t('status_col'), cell: ({ row }) => <Badge tone={row.original.is_active ? 'positive' : 'muted'}>{row.original.is_active ? t('active') : t('inactive')}</Badge> },
    { id: 'actions', header: '', cell: ({ row }) => canManage ? <div className="flex justify-end"><Button variant="ghost" size="icon" onClick={() => openEdit(row.original)} aria-label={t('edit', { name: row.original.name })}><Pencil className="h-4 w-4" strokeWidth={1.7} /></Button></div> : null },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, deviceName, canManage]);

  const noProvider = !loading && providers.length === 0;

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" aria-label={t('back_to_settings')}><Link href="/pos/settings"><ArrowRight className="h-4 w-4" strokeWidth={1.7} /></Link></Button>
        <div><h1 className="text-xl font-semibold text-text">{t('title')}</h1><p className="mt-1 text-sm text-muted">{t('subtitle')}</p></div>
      </div>
      {canManage && <Button onClick={openCreate} disabled={noProvider} title={noProvider ? t('no_provider_title') : undefined}><Plus className="h-4 w-4" strokeWidth={1.8} />{t('add')}</Button>}
    </div>

    {noProvider && (
      <div role="note" data-testid="pos-terminals-no-provider" className="flex items-start gap-3 rounded border border-warning/30 bg-warning/10 px-3 py-3 text-sm text-text">
        <CreditCard className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.7} aria-hidden="true" />
        <div><p className="font-medium">{t('no_provider_title')}</p><p className="mt-1 text-muted">{t('no_provider_body')}</p></div>
      </div>
    )}
    {providers.some((provider) => provider.simulated) && (
      <p role="note" className="rounded border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-text" data-testid="pos-terminals-simulated-note">{t('simulated_env_note')}</p>
    )}
    {!canManage && <p className="rounded bg-primary-soft px-3 py-2 text-xs text-text">{t('read_only')}</p>}
    {error && !dialogOpen && <p role="alert" className="rounded bg-negative/10 px-3 py-2 text-sm text-negative">{error}</p>}

    <DataTable columns={columns} data={terminals} loading={loading} searchPlaceholder={t('search')} emptyLabel={t('empty')} exportName="pos-payment-terminals" />

    <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={editing ? t('edit_title') : t('add_title')}>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5"><Label htmlFor="terminal-name">{t('name')}</Label><Input id="terminal-name" value={form.name} onChange={(event) => patch('name', event.target.value)} minLength={2} required disabled={saving} /></div>
        <div className="space-y-1.5"><Label htmlFor="terminal-code">{t('code')}</Label><Input id="terminal-code" className="num" value={form.code} onChange={(event) => patch('code', event.target.value)} disabled={saving} /><p className="text-xs text-muted">{t('code_hint')}</p></div>
        <div className="space-y-1.5">
          <Label htmlFor="terminal-provider">{t('provider')}</Label>
          <Select id="terminal-provider" value={form.provider} onChange={(event) => patch('provider', event.target.value)} disabled={saving || Boolean(editing)} required>
            {editing && <option value={editing.provider}>{editing.provider}{editing.simulated ? ` — ${t('simulated')}` : ''}</option>}
            {!editing && providers.map((provider) => <option key={provider.key} value={provider.key}>{provider.key}{provider.simulated ? ` — ${t('simulated')}` : ''}</option>)}
          </Select>
          {editing && <p className="text-xs text-muted">{t('provider_fixed')}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="terminal-device">{t('device')}</Label>
          <Select id="terminal-device" value={form.pos_device_id} onChange={(event) => patch('pos_device_id', event.target.value)} disabled={saving}>
            <option value="">{t('any_device')}</option>
            {devices.map((device) => <option key={device.id} value={device.id}>{device.name}{device.code ? ` · ${device.code}` : ''}</option>)}
          </Select>
          <p className="text-xs text-muted">{t('device_hint')}</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-text"><input className="h-4 w-4 accent-primary focus-visible:ring-2 focus-visible:ring-primary/40" type="checkbox" checked={form.is_active} onChange={(event) => patch('is_active', event.target.checked)} disabled={saving} />{t('active')}</label>
        {error && <p role="alert" className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}
        <div className="flex justify-end gap-2 pt-1"><Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>{tc('cancel')}</Button><Button type="submit" disabled={saving || form.name.trim().length < 2 || (!editing && !form.provider)}>{tc('save')}</Button></div>
      </form>
    </Dialog>
  </div>;
}
