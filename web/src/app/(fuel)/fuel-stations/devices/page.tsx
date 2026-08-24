'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Activity, CircleAlert, Cpu, Plus, Radio, UploadCloud } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { currentUser } from '@/lib/auth';

interface Station { id: string; name: string; code: string; status: string }
interface AdapterContract { key: string; device_types: string[] }
interface Device {
  id: string; fuel_station_id: string; device_key: string; name: string; device_type: string; status: string; adapter_key: string;
  manufacturer: string | null; model: string | null; serial_number: string | null; firmware_version: string | null; protocol: string | null;
  health: string; sync_status: string; last_seen_at: string | null; last_failure_reason: string | null;
}
interface IntegrationEvent {
  id: string; fuel_station_id: string; fuel_station_device_id: string | null; source_id: string; event_id: string; event_type: string;
  occurred_at: string; status: string; retry_count: number; failure_reason: string | null; device?: { id: string; device_key: string; name: string; device_type: string; health: string };
}

const DEVICE_TYPES = ['forecourt_controller', 'atg', 'rfid_reader', 'payment_terminal', 'station_gateway'] as const;
const EVENT_PRESETS: Record<string, Array<{ value: string; payload: string }>> = {
  'fake.forecourt': [
    { value: 'pump_status', payload: '{\n  "pump_reference": "P-01",\n  "status": "online"\n}' },
    { value: 'nozzle_meter', payload: '{\n  "nozzle_reference": "N-01",\n  "meter_milliliters": 120000\n}' },
    { value: 'transaction_evidence', payload: '{\n  "pump_reference": "P-01",\n  "reference": "simulated"\n}' },
  ],
  'fake.atg': [
    { value: 'reading', payload: '{\n  "tank_reference": "T-01",\n  "volume_milliliters": 1200000,\n  "temperature_celsius": 27\n}' },
    { value: 'alarm_raised', payload: '{\n  "tank_reference": "T-01",\n  "alarm_code": "high_water"\n}' },
    { value: 'alarm_cleared', payload: '{\n  "tank_reference": "T-01",\n  "alarm_code": "high_water"\n}' },
  ],
  'fake.rfid': [
    { value: 'vehicle_identified', payload: '{\n  "identity_reference": "opaque-simulation-reference"\n}' },
  ],
};
const TONES: Record<string, 'positive' | 'warning' | 'negative' | 'neutral'> = {
  active: 'positive', online: 'positive', processed: 'positive', idle: 'neutral', unknown: 'neutral', accepted: 'warning', disabled: 'warning', degraded: 'warning', failed: 'negative', retired: 'neutral', syncing: 'warning',
};

export default function FuelStationDevicesPage() {
  const t = useTranslations('fuelStationsDevices');
  const tc = useTranslations('common');
  const { success } = useToast();
  const [devices, setDevices] = useState<Device[]>([]); const [events, setEvents] = useState<IntegrationEvent[]>([]);
  const [stations, setStations] = useState<Station[]>([]); const [adapters, setAdapters] = useState<AdapterContract[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null); const [deviceOpen, setDeviceOpen] = useState(false); const [simulationOpen, setSimulationOpen] = useState(false);
  const [stationId, setStationId] = useState(''); const [deviceKey, setDeviceKey] = useState(''); const [deviceName, setDeviceName] = useState('');
  const [deviceType, setDeviceType] = useState<string>('atg'); const [adapterKey, setAdapterKey] = useState(''); const [manufacturer, setManufacturer] = useState(''); const [model, setModel] = useState(''); const [protocol, setProtocol] = useState(''); const [credentialReference, setCredentialReference] = useState('');
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null); const [simulationType, setSimulationType] = useState(''); const [eventPayload, setEventPayload] = useState('');

  const can = useCallback((permission: string) => permissions.includes('*') || permissions.includes(permission), [permissions]);
  const stationName = useCallback((id: string) => stations.find((station) => station.id === id)?.name ?? '—', [stations]);
  const adaptersForType = useMemo(() => adapters.filter((adapter) => adapter.device_types.includes(deviceType)), [adapters, deviceType]);
  const presets = useMemo(() => selectedDevice ? (EVENT_PRESETS[selectedDevice.adapter_key] ?? []) : [], [selectedDevice]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [devicesResult, eventsResult, stationsResult, adaptersResult] = await Promise.all([
        api<{ data: Device[] }>('/fuel-stations/devices'), api<{ data: IntegrationEvent[] }>('/fuel-stations/integration-events'),
        api<{ data: Station[] }>('/fuel-stations/stations'), api<{ data: AdapterContract[] }>('/fuel-stations/devices/adapter-contracts'),
      ]);
      setDevices(devicesResult.data); setEvents(eventsResult.data); setStations(stationsResult.data.filter((station) => station.status === 'active')); setAdapters(adaptersResult.data);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : tc('loadFailed')); } finally { setLoading(false); }
  }, [tc]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const user = currentUser(); if (user?.permissions) setPermissions(user.permissions); else api<{ user: { permissions?: string[] } }>('/me').then((result) => setPermissions(result.user.permissions ?? [])).catch(() => {}); }, []);
  useEffect(() => { if (!adaptersForType.some((adapter) => adapter.key === adapterKey)) setAdapterKey(adaptersForType[0]?.key ?? ''); }, [adapterKey, adaptersForType]);

  function resetDeviceForm() { setStationId(''); setDeviceKey(''); setDeviceName(''); setDeviceType('atg'); setAdapterKey(''); setManufacturer(''); setModel(''); setProtocol(''); setCredentialReference(''); }
  function openSimulation(device: Device) { const next = (EVENT_PRESETS[device.adapter_key] ?? [])[0]; setSelectedDevice(device); setSimulationType(next?.value ?? ''); setEventPayload(next?.payload ?? '{\n\n}'); setError(null); setSimulationOpen(true); }

  async function createDevice() {
    if (!stationId || !deviceKey.trim() || !deviceName.trim() || !deviceType || !adapterKey) return;
    setBusy(true); setError(null);
    try {
      await api('/fuel-stations/devices', { method: 'POST', body: { fuel_station_id: stationId, device_key: deviceKey.trim(), name: deviceName.trim(), device_type: deviceType, adapter_key: adapterKey, manufacturer: manufacturer || null, model: model || null, protocol: protocol || null, credential_reference: credentialReference || null } });
      success(t('created')); setDeviceOpen(false); resetDeviceForm(); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : tc('saveFailed')); } finally { setBusy(false); }
  }

  async function simulateEvent() {
    if (!selectedDevice || !simulationType || !eventPayload.trim()) return;
    let payload: Record<string, unknown>;
    try { payload = JSON.parse(eventPayload) as Record<string, unknown>; } catch { setError(t('eventPayloadHint')); return; }
    setBusy(true); setError(null);
    try {
      await api(`/fuel-stations/devices/${selectedDevice.id}/simulate-event`, { method: 'POST', body: { type: simulationType, event_id: crypto.randomUUID(), occurred_at: new Date().toISOString(), sequence: null, payload } });
      success(t('eventRecorded')); setSimulationOpen(false); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : tc('saveFailed')); } finally { setBusy(false); }
  }

  const deviceColumns = useMemo<ColumnDef<Device, unknown>[]>(() => [
    { accessorKey: 'name', header: t('deviceName'), cell: ({ row }) => <div><p className="font-medium text-text">{row.original.name}</p><p className="num text-xs text-muted">{row.original.device_key}</p></div> },
    { accessorKey: 'device_type', header: t('deviceType'), cell: ({ row }) => <span>{t(`type${camel(row.original.device_type)}`)}</span> },
    { accessorKey: 'adapter_key', header: t('adapter'), cell: ({ row }) => <span className="num text-xs">{row.original.adapter_key}</span> },
    { accessorKey: 'health', header: t('health'), cell: ({ row }) => <Badge tone={TONES[row.original.health] ?? 'neutral'}>{t(row.original.health)}</Badge> },
    { accessorKey: 'status', header: t('deviceStatus'), cell: ({ row }) => <Badge tone={TONES[row.original.status] ?? 'neutral'}>{t(row.original.status)}</Badge> },
    { accessorKey: 'last_seen_at', header: t('lastSeen'), cell: ({ row }) => <span className="num text-xs">{row.original.last_seen_at ? new Date(row.original.last_seen_at).toLocaleString() : '—'}</span> },
    { id: 'actions', header: '', cell: ({ row }) => <Button size="sm" variant="outline" disabled={!can('fuel.integration.ingest') || !EVENT_PRESETS[row.original.adapter_key]?.length} title={!can('fuel.integration.ingest') ? t('noPermission') : undefined} onClick={() => openSimulation(row.original)}><UploadCloud className="h-3.5 w-3.5" />{t('simulate')}</Button> },
  ], [can, t]);
  const eventColumns = useMemo<ColumnDef<IntegrationEvent, unknown>[]>(() => [
    { accessorKey: 'occurred_at', header: t('occurredAt'), cell: ({ row }) => <span className="num text-xs">{new Date(row.original.occurred_at).toLocaleString()}</span> },
    { accessorKey: 'event_type', header: t('eventType'), cell: ({ row }) => <span className="num text-xs">{row.original.event_type}</span> },
    { accessorKey: 'source_id', header: t('deviceKey'), cell: ({ row }) => <span className="num text-xs">{row.original.source_id}</span> },
    { accessorKey: 'status', header: t('eventStatus'), cell: ({ row }) => <Badge tone={TONES[row.original.status] ?? 'neutral'}>{t(row.original.status)}</Badge> },
    { accessorKey: 'retry_count', header: t('retryCount'), cell: ({ row }) => <span className="num">{row.original.retry_count}</span> },
    { accessorKey: 'failure_reason', header: t('failureReason'), cell: ({ row }) => <span className="max-w-56 text-xs text-negative">{row.original.failure_reason ?? '—'}</span> },
  ], [t]);

  if (loading && devices.length === 0) return <div className="space-y-4" aria-busy="true"><Skeleton className="h-9 w-72" /><Skeleton className="h-64 w-full" /></div>;
  return <div className="space-y-5">
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div><p className="text-sm text-muted">{t('eyebrow')}</p><h1 className="text-xl font-semibold text-text">{t('title')}</h1><p className="mt-1 max-w-3xl text-sm text-muted">{t('subtitle')}</p></div><Button disabled={!can('fuel.device.manage')} title={!can('fuel.device.manage') ? t('noPermission') : undefined} onClick={() => { resetDeviceForm(); setError(null); setDeviceOpen(true); }}><Plus className="h-4 w-4" />{t('newDevice')}</Button></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric icon={<Cpu />} label={t('totalDevices')} value={String(devices.length)} /><Metric icon={<Radio />} label={t('online')} value={String(devices.filter((device) => device.health === 'online').length)} /><Metric icon={<CircleAlert />} label={t('degraded')} value={String(devices.filter((device) => device.health === 'degraded' || device.health === 'offline').length)} /><Metric icon={<Activity />} label={t('failedEvents')} value={String(events.filter((event) => event.status === 'failed').length)} /></div>
    <p className="rounded-md border border-border bg-primary-soft px-3 py-2 text-xs text-text">{t('separationNotice')}</p>
    {error && <p role="alert" className="rounded-md bg-negative/10 px-3 py-2 text-sm text-negative">{error}</p>}
    <section className="space-y-3"><div><h2 className="text-base font-semibold text-text">{t('devices')}</h2><p className="text-sm text-muted">{t('deviceHint')}</p></div><DataTable columns={deviceColumns} data={devices} loading={loading} searchPlaceholder={t('deviceSearch')} emptyLabel={t('emptyDevices')} exportName="fuel-station-devices" /></section>
    <section className="space-y-3"><div><h2 className="text-base font-semibold text-text">{t('events')}</h2><p className="text-sm text-muted">{t('separationNotice')}</p></div><DataTable columns={eventColumns} data={events} loading={loading} searchPlaceholder={t('eventSearch')} emptyLabel={t('emptyEvents')} exportName="fuel-station-integration-events" /></section>

    <Dialog open={deviceOpen} onClose={() => setDeviceOpen(false)} title={t('deviceTitle')}><form onSubmit={(event) => { event.preventDefault(); void createDevice(); }} className="space-y-3"><p className="rounded-md bg-primary-soft px-3 py-2 text-xs text-text">{t('deviceHint')}</p><div className="grid gap-3 sm:grid-cols-2"><SelectField id="device-station" label={t('station')} value={stationId} onChange={setStationId} disabled={busy} options={stations.map((station) => ({ value: station.id, label: `${station.name} · ${station.code}` }))} placeholder={t('selectStation')} /><TextField id="device-name" label={t('deviceName')} value={deviceName} onChange={setDeviceName} disabled={busy} /></div><div className="grid gap-3 sm:grid-cols-2"><TextField id="device-key" label={t('deviceKey')} value={deviceKey} onChange={setDeviceKey} disabled={busy} /><SelectField id="device-type" label={t('deviceType')} value={deviceType} onChange={setDeviceType} disabled={busy} options={DEVICE_TYPES.map((value) => ({ value, label: t(`type${camel(value)}`) }))} placeholder={t('selectType')} /></div><div className="grid gap-3 sm:grid-cols-2"><SelectField id="device-adapter" label={t('adapter')} value={adapterKey} onChange={setAdapterKey} disabled={busy} options={adaptersForType.map((adapter) => ({ value: adapter.key, label: adapter.key }))} placeholder={t('selectAdapter')} /><TextField id="device-protocol" label={t('protocol')} value={protocol} onChange={setProtocol} disabled={busy} optional /></div><div className="grid gap-3 sm:grid-cols-2"><TextField id="device-manufacturer" label={t('manufacturer')} value={manufacturer} onChange={setManufacturer} disabled={busy} optional /><TextField id="device-model" label={t('model')} value={model} onChange={setModel} disabled={busy} optional /></div><TextField id="device-credential-reference" label={t('credentialReference')} value={credentialReference} onChange={setCredentialReference} disabled={busy} optional /><DialogActions busy={busy} disabled={!stationId || !deviceKey.trim() || !deviceName.trim() || !adapterKey} onCancel={() => setDeviceOpen(false)} saveLabel={t('create')} /></form></Dialog>
    <Dialog open={simulationOpen} onClose={() => setSimulationOpen(false)} title={t('simulationTitle')}><form onSubmit={(event) => { event.preventDefault(); void simulateEvent(); }} className="space-y-3"><p className="rounded-md bg-primary-soft px-3 py-2 text-xs text-text">{t('simulationHint')}</p><SelectField id="simulation-type" label={t('simulationType')} value={simulationType} onChange={(value) => { setSimulationType(value); setEventPayload(presets.find((preset) => preset.value === value)?.payload ?? '{\n\n}'); }} disabled={busy} options={presets.map((preset) => ({ value: preset.value, label: preset.value }))} placeholder={t('simulationType')} /><div className="space-y-1.5"><Label htmlFor="simulation-payload">{t('eventPayload')}</Label><textarea id="simulation-payload" className="num min-h-40 w-full rounded-md border border-border bg-surface p-3 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-primary/40" value={eventPayload} onChange={(event) => setEventPayload(event.target.value)} aria-describedby="simulation-payload-hint" /><p id="simulation-payload-hint" className="text-xs text-muted">{t('eventPayloadHint')}</p></div><DialogActions busy={busy} disabled={!simulationType || !eventPayload.trim()} onCancel={() => setSimulationOpen(false)} saveLabel={t('submitSimulation')} /></form></Dialog>
  </div>;
}

function camel(value: string) { return value.replace(/(?:^|_)([a-z])/g, (_, letter: string) => letter.toUpperCase()); }
function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) { return <div className="rounded-md border border-border bg-surface p-3"><div className="flex items-center gap-2 text-sm text-muted"><span aria-hidden="true" className="text-primary">{icon}</span>{label}</div><p className="num mt-2 text-xl font-semibold text-text">{value}</p></div>; }
function TextField({ id, label, value, onChange, disabled, optional = false }: { id: string; label: string; value: string; onChange: (value: string) => void; disabled: boolean; optional?: boolean }) { return <div className="space-y-1.5"><Label htmlFor={id}>{label}</Label><Input id={id} autoComplete="off" value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} required={!optional} /></div>; }
function SelectField({ id, label, value, onChange, disabled, options, placeholder }: { id: string; label: string; value: string; onChange: (value: string) => void; disabled: boolean; options: Array<{ value: string; label: string }>; placeholder: string }) { return <div className="space-y-1.5"><Label htmlFor={id}>{label}</Label><select id={id} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} required className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><option value="">{placeholder}</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>; }
function DialogActions({ busy, disabled, onCancel, saveLabel }: { busy: boolean; disabled: boolean; onCancel: () => void; saveLabel: string }) { const tc = useTranslations('common'); return <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="outline" onClick={onCancel}>{tc('cancel')}</Button><Button type="submit" disabled={busy || disabled}>{saveLabel}</Button></div>; }
