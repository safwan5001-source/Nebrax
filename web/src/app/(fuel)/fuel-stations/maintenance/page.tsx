'use client';
import { displayLocale } from '@/lib/formatting';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CalendarClock, ChevronRight, CircleAlert, ClipboardList, Loader2, Plus, RefreshCw, Wrench } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { currentUser } from '@/lib/auth';
import { formatMillilitersAsLiters, litersToMilliliters } from '@/lib/fuel-quantity';
import { formatMinorRiyal, isValidRiyal, riyalToMinor } from '@/lib/money';
import { nextWorkOrderStatuses, readinessAssetLabel, type ReadinessAsset, type ReadinessAssetKind } from '@/lib/fuel-readiness';

type Tone = 'positive' | 'warning' | 'negative' | 'muted';
type Station = { id: string; name: string; code: string; branch_id?: string | null; status: string };
type Tank = { id: string; name: string; code: string; fuel_station_id: string; station?: { name: string; code: string } | null };
type Pump = { id: string; name?: string | null; pump_number: string; fuel_station_id: string; station?: { name: string; code: string } | null };
type Nozzle = { id: string; nozzle_number: string; fuel_station_id: string; pump?: { pump_number: string } | null; station?: { name: string; code: string } | null };
type Device = { id: string; name?: string | null; code?: string | null; fuel_station_id: string; station?: { name: string; code: string } | null; device_type?: string | null };
type AccountingAsset = { id: string; name: string; code?: string | null; branch_id?: string | null };
type Schedule = { id: string; name: string; schedule_type: string; status: string; next_due_at: string | null; interval_days?: number | null; interval_milliliters?: number | null; station?: Station | null; asset_type: string; asset_id: string };
type WorkOrder = { id: string; number: string; title: string; status: string; work_type: string; priority: string; severity: string; cost_minor: number; downtime_minutes: number; opened_at: string; scheduled_at: string | null; completed_at?: string | null; station?: Station | null; assignee?: { name: string } | null; asset_type: string; asset_id: string };
type User = { id: string; name: string };

const ASSET_CLASSES: Record<ReadinessAssetKind, string> = {
  station: 'App\\Models\\FuelStation', tank: 'App\\Models\\FuelTank', pump: 'App\\Models\\FuelPump', nozzle: 'App\\Models\\FuelNozzle', device: 'App\\Models\\FuelStationDevice', accounting_asset: 'App\\Models\\Asset',
};
const STATUS_TONES: Record<string, Tone> = { active: 'positive', completed: 'positive', verified: 'positive', closed: 'muted', reported: 'warning', triaged: 'warning', scheduled: 'warning', in_progress: 'warning', high: 'warning', medium: 'warning', low: 'muted', critical: 'negative', suspended: 'muted' };

export default function FuelStationsMaintenancePage() {
  const t = useTranslations('fuelStationsMaintenance');
  const locale = useLocale();
  const { success } = useToast();
  const [stations, setStations] = useState<Station[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [assets, setAssets] = useState<ReadinessAsset[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [stationFilter, setStationFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workDialog, setWorkDialog] = useState(false);
  const [scheduleDialog, setScheduleDialog] = useState(false);
  const [transitionOrder, setTransitionOrder] = useState<WorkOrder | null>(null);
  const [work, setWork] = useState({ stationId: '', assetId: '', workType: 'corrective', priority: 'medium', title: '', description: '', assignedTo: '', cost: '', downtime: '' });
  const [schedule, setSchedule] = useState({ stationId: '', assetId: '', name: '', type: 'calendar', intervalDays: '', intervalLiters: '', instructions: '' });
  const [transition, setTransition] = useState({ status: '', scheduledAt: '', resolution: '', rootCause: '', cost: '', downtime: '' });

  const can = useCallback((permission: string) => permissions.includes('*') || permissions.includes(permission), [permissions]);
  const assetLabels = useMemo<Record<ReadinessAssetKind, string>>(() => ({ station: t('assetStation'), tank: t('assetTank'), pump: t('assetPump'), nozzle: t('assetNozzle'), device: t('assetDevice'), accounting_asset: t('assetAccounting') }), [t]);
  const selectedWorkAsset = assets.find((asset) => asset.id === work.assetId && asset.stationId === work.stationId);
  const selectedScheduleAsset = assets.find((asset) => asset.id === schedule.assetId && asset.stationId === schedule.stationId);
  const workAssets = useMemo(() => assetsForStation(assets, work.stationId), [assets, work.stationId]);
  const scheduleAssets = useMemo(() => assetsForStation(assets, schedule.stationId), [assets, schedule.stationId]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const query = new URLSearchParams(); if (stationFilter) query.set('fuel_station_id', stationFilter); if (statusFilter) query.set('status', statusFilter);
      const [maintenance, stationResponse, tanks, pumps, nozzles, devices, accountingAssets, userResponse] = await Promise.all([
        api<{ data: { schedules: { data: Schedule[] }; work_orders: { data: WorkOrder[] } } }>(`/fuel-stations/maintenance${query.size ? `?${query}` : ''}`),
        api<{ data: Station[] }>('/fuel-stations/stations'), api<{ data: Tank[] }>('/fuel-stations/tanks'), api<{ data: Pump[] }>('/fuel-stations/pumps'), api<{ data: Nozzle[] }>('/fuel-stations/nozzles'), api<{ data: Device[] }>('/fuel-stations/devices'),
        api<{ data: AccountingAsset[] }>('/assets').catch(() => ({ data: [] })), api<{ data: User[] }>('/users').catch(() => ({ data: [] })),
      ]);
      const nextStations = stationResponse.data.filter((station) => station.status === 'active');
      setStations(nextStations); setSchedules(maintenance.data.schedules.data); setOrders(maintenance.data.work_orders.data); setUsers(userResponse.data);
      setAssets(buildAssets(nextStations, tanks.data, pumps.data, nozzles.data, devices.data, accountingAssets.data));
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : t('loadFailed')); } finally { setLoading(false); }
  }, [stationFilter, statusFilter, t]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const user = currentUser(); if (user?.permissions) setPermissions(user.permissions); else api<{ user: { permissions?: string[] } }>('/me').then((response) => setPermissions(response.user.permissions ?? [])).catch(() => {}); }, []);

  function openWork() { setWork({ stationId: '', assetId: '', workType: 'corrective', priority: 'medium', title: '', description: '', assignedTo: '', cost: '', downtime: '' }); setWorkDialog(true); }
  function openSchedule() { setSchedule({ stationId: '', assetId: '', name: '', type: 'calendar', intervalDays: '', intervalLiters: '', instructions: '' }); setScheduleDialog(true); }
  function openTransition(order: WorkOrder) { const next = nextWorkOrderStatuses(order.status)[0] ?? ''; setTransitionOrder(order); setTransition({ status: next, scheduledAt: '', resolution: '', rootCause: '', cost: '', downtime: '' }); }

  async function saveWork() {
    if (!selectedWorkAsset || !work.title.trim()) return;
    if (work.cost.trim() && !isValidRiyal(work.cost)) { setError(t('invalidCost')); return; }
    setBusy(true); setError(null);
    try {
      await api('/fuel-stations/maintenance/work-orders', { method: 'POST', body: compact({ fuel_station_id: work.stationId, asset_type: selectedWorkAsset.className, asset_id: selectedWorkAsset.id, work_type: work.workType, priority: work.priority, title: work.title, description: work.description, assigned_to: work.assignedTo, cost_minor: minor(work.cost), downtime_minutes: integer(work.downtime) }) });
      success(t('workOrderCreated')); setWorkDialog(false); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : t('saveFailed')); } finally { setBusy(false); }
  }

  async function saveSchedule() {
    if (!selectedScheduleAsset || !schedule.name.trim()) return;
    const interval = schedule.type === 'calendar' ? integer(schedule.intervalDays) : litersToMilliliters(schedule.intervalLiters);
    if (!interval || interval < 1) { setError(t('intervalRequired')); return; }
    setBusy(true); setError(null);
    try {
      await api('/fuel-stations/maintenance/schedules', { method: 'POST', body: compact({ fuel_station_id: schedule.stationId, asset_type: selectedScheduleAsset.className, asset_id: selectedScheduleAsset.id, name: schedule.name, schedule_type: schedule.type, interval_days: schedule.type === 'calendar' ? interval : null, interval_milliliters: schedule.type === 'calendar' ? null : interval, instructions: schedule.instructions }) });
      success(t('scheduleCreated')); setScheduleDialog(false); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : t('saveFailed')); } finally { setBusy(false); }
  }

  async function saveTransition() {
    if (!transitionOrder || !transition.status) return;
    if (transition.status === 'completed' && !transition.resolution.trim()) { setError(t('resolutionRequired')); return; }
    if (transition.cost.trim() && !isValidRiyal(transition.cost)) { setError(t('invalidCost')); return; }
    setBusy(true); setError(null);
    try {
      await api(`/fuel-stations/maintenance/work-orders/${transitionOrder.id}/transition`, { method: 'POST', body: compact({ status: transition.status, scheduled_at: transition.scheduledAt || null, resolution: transition.resolution, root_cause: transition.rootCause, cost_minor: minor(transition.cost), downtime_minutes: integer(transition.downtime) }) });
      success(t('statusUpdated')); setTransitionOrder(null); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : t('saveFailed')); } finally { setBusy(false); }
  }

  if (loading) return <Loading />;
  return <div className="space-y-5">
    <Header title={t('title')} subtitle={t('subtitle')} actions={<><Button variant="outline" disabled={!can('fuel.maintenance.manage')} onClick={openSchedule}><CalendarClock className="h-4 w-4" />{t('newSchedule')}</Button><Button disabled={!can('fuel.maintenance.manage')} onClick={openWork}><Plus className="h-4 w-4" />{t('newWorkOrder')}</Button></>} />
    {error && <ErrorBanner message={error} retry={load} label={t('retry')} />}
    <Card><CardContent className="grid gap-3 py-4 md:grid-cols-3"><FieldSelect label={t('station')} value={stationFilter} onChange={setStationFilter} options={stations.map(stationOption)} /><FieldSelect label={t('status')} value={statusFilter} onChange={setStatusFilter} options={workStatuses(t)} /><div className="flex items-end"><Button className="min-h-11" variant="outline" onClick={() => void load()}><RefreshCw className="h-4 w-4" />{t('refresh')}</Button></div></CardContent></Card>
    <Section icon={<ClipboardList />} title={t('workOrders')} count={orders.length}><WorkOrderList orders={orders} assets={assets} labels={assetLabels} locale={locale} t={t} canTransition={can('fuel.maintenance.transition')} onTransition={openTransition} /></Section>
    <Section icon={<CalendarClock />} title={t('preventiveSchedules')} count={schedules.length}><ScheduleList schedules={schedules} assets={assets} labels={assetLabels} locale={locale} t={t} /></Section>
    <Dialog open={workDialog} onClose={() => setWorkDialog(false)} title={t('newWorkOrder')}><form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void saveWork(); }}><StationAssetFields stations={stations} assets={workAssets} labels={assetLabels} stationId={work.stationId} assetId={work.assetId} onStation={(value) => setWork({ ...work, stationId: value, assetId: '' })} onAsset={(value) => setWork({ ...work, assetId: value })} t={t} /><FieldInput label={t('titleField')} value={work.title} required onChange={(value) => setWork({ ...work, title: value })} /><FieldSelect label={t('workType')} value={work.workType} onChange={(value) => setWork({ ...work, workType: value })} options={[{ value: 'corrective', label: t('corrective') }, { value: 'preventive', label: t('preventive') }]} /><FieldSelect label={t('priority')} value={work.priority} onChange={(value) => setWork({ ...work, priority: value })} options={priorityOptions(t)} /><FieldSelect label={t('assignee')} value={work.assignedTo} onChange={(value) => setWork({ ...work, assignedTo: value })} options={users.map((user) => ({ value: user.id, label: user.name }))} /><FieldInput label={t('estimatedCost')} value={work.cost} type="number" min="0" step="0.01" onChange={(value) => setWork({ ...work, cost: value })} /><FieldInput label={t('downtimeMinutes')} value={work.downtime} type="number" min="0" step="1" onChange={(value) => setWork({ ...work, downtime: value })} /><FieldInput label={t('description')} value={work.description} onChange={(value) => setWork({ ...work, description: value })} /><DialogActions busy={busy} cancel={t('cancel')} submit={t('create')} onCancel={() => setWorkDialog(false)} disabled={!selectedWorkAsset || !work.title.trim()} /></form></Dialog>
    <Dialog open={scheduleDialog} onClose={() => setScheduleDialog(false)} title={t('newSchedule')}><form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void saveSchedule(); }}><StationAssetFields stations={stations} assets={scheduleAssets} labels={assetLabels} stationId={schedule.stationId} assetId={schedule.assetId} onStation={(value) => setSchedule({ ...schedule, stationId: value, assetId: '' })} onAsset={(value) => setSchedule({ ...schedule, assetId: value })} t={t} /><FieldInput label={t('scheduleName')} value={schedule.name} required onChange={(value) => setSchedule({ ...schedule, name: value })} /><FieldSelect label={t('scheduleType')} value={schedule.type} onChange={(value) => setSchedule({ ...schedule, type: value, intervalDays: '', intervalLiters: '' })} options={[{ value: 'calendar', label: t('calendar') }, { value: 'runtime', label: t('runtime') }, { value: 'meter', label: t('meter') }]} />{schedule.type === 'calendar' ? <FieldInput label={t('intervalDays')} value={schedule.intervalDays} type="number" min="1" step="1" required onChange={(value) => setSchedule({ ...schedule, intervalDays: value })} /> : <FieldInput label={t('intervalLiters')} value={schedule.intervalLiters} type="number" min="0.001" step="0.001" required onChange={(value) => setSchedule({ ...schedule, intervalLiters: value })} />}<FieldInput label={t('instructions')} value={schedule.instructions} onChange={(value) => setSchedule({ ...schedule, instructions: value })} /><DialogActions busy={busy} cancel={t('cancel')} submit={t('create')} onCancel={() => setScheduleDialog(false)} disabled={!selectedScheduleAsset || !schedule.name.trim()} /></form></Dialog>
    <Dialog open={transitionOrder !== null} onClose={() => setTransitionOrder(null)} title={t('advanceWorkOrder')}><form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void saveTransition(); }}><p className="text-sm text-muted">{transitionOrder?.number} · {transitionOrder?.title}</p><FieldSelect label={t('nextStatus')} value={transition.status} onChange={(value) => setTransition({ ...transition, status: value })} options={nextWorkOrderStatuses(transitionOrder?.status ?? '').map((status) => ({ value: status, label: statusLabel(status, t) }))} required />{transition.status === 'scheduled' && <FieldInput label={t('scheduledAt')} value={transition.scheduledAt} type="datetime-local" required onChange={(value) => setTransition({ ...transition, scheduledAt: value })} />}{transition.status === 'completed' && <><FieldInput label={t('resolution')} value={transition.resolution} required onChange={(value) => setTransition({ ...transition, resolution: value })} /><FieldInput label={t('rootCause')} value={transition.rootCause} onChange={(value) => setTransition({ ...transition, rootCause: value })} /><FieldInput label={t('actualCost')} value={transition.cost} type="number" min="0" step="0.01" onChange={(value) => setTransition({ ...transition, cost: value })} /><FieldInput label={t('downtimeMinutes')} value={transition.downtime} type="number" min="0" step="1" onChange={(value) => setTransition({ ...transition, downtime: value })} /></>}<DialogActions busy={busy} cancel={t('cancel')} submit={t('save')} onCancel={() => setTransitionOrder(null)} disabled={!transition.status} /></form></Dialog>
  </div>;
}

function Header({ title, subtitle, actions }: { title: string; subtitle: string; actions: React.ReactNode }) { return <header className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div><h1 className="text-xl font-semibold text-text">{title}</h1><p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">{subtitle}</p></div><div className="flex flex-wrap gap-2">{actions}</div></header>; }
function Section({ icon, title, count, children }: { icon: React.ReactNode; title: string; count: number; children: React.ReactNode }) { return <Card><CardHeader><CardTitle className="flex items-center gap-2"><span aria-hidden="true" className="text-primary">{icon}</span>{title}<span className="num text-sm font-normal text-muted">{count}</span></CardTitle></CardHeader><CardContent>{children}</CardContent></Card>; }
function WorkOrderList({ orders, assets, labels, locale, t, canTransition, onTransition }: { orders: WorkOrder[]; assets: ReadinessAsset[]; labels: Record<ReadinessAssetKind, string>; locale: string; t: ReturnType<typeof useTranslations>; canTransition: boolean; onTransition: (order: WorkOrder) => void }) { if (!orders.length) return <Empty text={t('emptyWorkOrders')} />; return <><div className="hidden overflow-x-auto lg:block"><table className="w-full min-w-[62rem] text-sm"><thead className="border-b border-border text-start text-xs text-muted"><tr>{[t('number'), t('titleField'), t('asset'), t('status'), t('priority'), t('cost'), t('downtime'), t('openedAt'), t('actions')].map((heading) => <th key={heading} className="px-3 py-3 font-medium">{heading}</th>)}</tr></thead><tbody>{orders.map((order) => <tr key={order.id} className="border-b border-border/70 last:border-0"><td className="num px-3 py-3 text-muted">{order.number}</td><td className="px-3 py-3 font-medium text-text">{order.title}</td><td className="px-3 py-3 text-muted">{assetName(order, assets, labels)}</td><td className="px-3 py-3"><Status value={order.status} t={t} /></td><td className="px-3 py-3"><Status value={order.priority} t={t} /></td><td className="num px-3 py-3 text-end text-text">{formatMinorRiyal(order.cost_minor)}</td><td className="num px-3 py-3 text-end text-text">{order.downtime_minutes} {t('minutes')}</td><td className="num px-3 py-3 text-muted">{date(order.opened_at, locale)}</td><td className="px-3 py-3 text-end">{canTransition && nextWorkOrderStatuses(order.status).length > 0 && <Button size="sm" variant="outline" onClick={() => onTransition(order)}><ChevronRight className="h-4 w-4 rtl:rotate-180" />{t('advance')}</Button>}</td></tr>)}</tbody></table></div><div className="space-y-3 lg:hidden">{orders.map((order) => <article key={order.id} className="rounded-md border border-border p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="num text-xs text-muted">{order.number}</p><h2 className="mt-1 font-medium text-text">{order.title}</h2><p className="mt-1 text-sm text-muted">{assetName(order, assets, labels)}</p></div><Status value={order.status} t={t} /></div><dl className="mt-3 grid grid-cols-2 gap-2 border-t border-border pt-3 text-sm"><Detail label={t('priority')} value={<Status value={order.priority} t={t} />} /><Detail label={t('cost')} value={formatMinorRiyal(order.cost_minor)} /><Detail label={t('downtime')} value={`${order.downtime_minutes} ${t('minutes')}`} /><Detail label={t('openedAt')} value={date(order.opened_at, locale)} /></dl>{canTransition && nextWorkOrderStatuses(order.status).length > 0 && <div className="mt-3 border-t border-border pt-3"><Button size="sm" variant="outline" onClick={() => onTransition(order)}><ChevronRight className="h-4 w-4 rtl:rotate-180" />{t('advance')}</Button></div>}</article>)}</div></>; }
function ScheduleList({ schedules, assets, labels, locale, t }: { schedules: Schedule[]; assets: ReadinessAsset[]; labels: Record<ReadinessAssetKind, string>; locale: string; t: ReturnType<typeof useTranslations> }) { if (!schedules.length) return <Empty text={t('emptySchedules')} />; return <div className="space-y-3">{schedules.map((schedule) => <article key={schedule.id} className="rounded-md border border-border p-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-medium text-text">{schedule.name}</h2><p className="mt-1 text-sm text-muted">{assetName(schedule, assets, labels)}</p></div><Status value={schedule.status} t={t} /></div><dl className="mt-3 grid gap-2 border-t border-border pt-3 text-sm sm:grid-cols-3"><Detail label={t('scheduleType')} value={scheduleTypeLabel(schedule.schedule_type, t)} /><Detail label={t('nextDue')} value={date(schedule.next_due_at, locale)} /><Detail label={t('interval')} value={schedule.interval_days ? t('daysValue', { count: schedule.interval_days }) : schedule.interval_milliliters ? formatMillilitersAsLiters(schedule.interval_milliliters, locale) : '—'} /></dl></article>)}</div>; }
function StationAssetFields({ stations, assets, labels, stationId, assetId, onStation, onAsset, t }: { stations: Station[]; assets: ReadinessAsset[]; labels: Record<ReadinessAssetKind, string>; stationId: string; assetId: string; onStation: (value: string) => void; onAsset: (value: string) => void; t: ReturnType<typeof useTranslations> }) { return <><FieldSelect label={t('station')} value={stationId} onChange={onStation} options={stations.map(stationOption)} required /><FieldSelect label={t('asset')} value={assetId} onChange={onAsset} options={assets.map((asset) => ({ value: asset.id, label: readinessAssetLabel(asset, labels) }))} required disabled={!stationId} hint={!stationId ? t('chooseStationFirst') : undefined} /></>; }
function FieldInput({ label, value, onChange, type = 'text', required, min, step }: { label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean; min?: string; step?: string }) { return <div className="space-y-1.5"><Label>{label}</Label><Input value={value} type={type} required={required} min={min} step={step} onChange={(event) => onChange(event.target.value)} /></div>; }
function FieldSelect({ label, value, onChange, options, required, disabled, hint }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; required?: boolean; disabled?: boolean; hint?: string }) { return <div className="space-y-1.5"><Label>{label}</Label><Select value={value} required={required} disabled={disabled} onChange={(event) => onChange(event.target.value)}><option value="">—</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</Select>{hint && <p className="text-xs text-muted">{hint}</p>}</div>; }
function DialogActions({ busy, cancel, submit, onCancel, disabled }: { busy: boolean; cancel: string; submit: string; onCancel: () => void; disabled?: boolean }) { return <div className="flex justify-end gap-2 border-t border-border pt-4"><Button type="button" variant="outline" onClick={onCancel}>{cancel}</Button><Button type="submit" disabled={busy || disabled}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{submit}</Button></div>; }
function ErrorBanner({ message, retry, label }: { message: string; retry: () => void; label: string }) { return <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-negative/30 bg-negative/10 px-3 py-3 text-sm text-negative"><span className="flex items-center gap-2"><CircleAlert className="h-4 w-4" />{message}</span><Button variant="outline" size="sm" onClick={() => void retry()}><RefreshCw className="h-4 w-4" />{label}</Button></div>; }
function Status({ value, t }: { value: string; t: ReturnType<typeof useTranslations> }) { return <Badge tone={STATUS_TONES[value] ?? 'muted'}>{statusLabel(value, t)}</Badge>; }
function Detail({ label, value }: { label: string; value: React.ReactNode }) { return <div><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 text-text">{value}</dd></div>; }
function Empty({ text }: { text: string }) { return <p className="rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-muted">{text}</p>; }
function Loading() { return <div className="space-y-4" aria-busy="true"><Skeleton className="h-10 w-72" /><Skeleton className="h-48 w-full" /><Skeleton className="h-48 w-full" /></div>; }
function assetsForStation(assets: ReadinessAsset[], stationId: string) { return stationId === '' ? [] : assets.filter((asset) => asset.stationId === stationId); }
function buildAssets(stations: Station[], tanks: Tank[], pumps: Pump[], nozzles: Nozzle[], devices: Device[], accountingAssets: AccountingAsset[]): ReadinessAsset[] { const stationById = new Map(stations.map((station) => [station.id, station])); return [
  ...stations.map((station) => ({ id: station.id, kind: 'station' as const, name: station.name, code: station.code, stationName: station.name, stationId: station.id, className: ASSET_CLASSES.station })),
  ...tanks.map((tank) => ({ id: tank.id, kind: 'tank' as const, name: tank.name, code: tank.code, stationName: stationById.get(tank.fuel_station_id)?.name, stationId: tank.fuel_station_id, className: ASSET_CLASSES.tank })),
  ...pumps.map((pump) => ({ id: pump.id, kind: 'pump' as const, name: pump.name || `Pump ${pump.pump_number}`, code: pump.pump_number, stationName: stationById.get(pump.fuel_station_id)?.name, stationId: pump.fuel_station_id, className: ASSET_CLASSES.pump })),
  ...nozzles.map((nozzle) => ({ id: nozzle.id, kind: 'nozzle' as const, name: `Nozzle ${nozzle.nozzle_number}`, code: nozzle.pump?.pump_number ?? null, stationName: stationById.get(nozzle.fuel_station_id)?.name, stationId: nozzle.fuel_station_id, className: ASSET_CLASSES.nozzle })),
  ...devices.map((device) => ({ id: device.id, kind: 'device' as const, name: device.name || device.device_type || 'Device', code: device.code, stationName: stationById.get(device.fuel_station_id)?.name, stationId: device.fuel_station_id, className: ASSET_CLASSES.device })),
  ...accountingAssets.flatMap((asset) => stations.filter((station) => station.branch_id === asset.branch_id).map((station) => ({ id: asset.id, kind: 'accounting_asset' as const, name: asset.name, code: asset.code, stationName: station.name, stationId: station.id, className: ASSET_CLASSES.accounting_asset }))),
]; }
function assetName(row: { asset_id: string; station?: Station | null }, assets: ReadinessAsset[], labels: Record<ReadinessAssetKind, string>) { const asset = assets.find((item) => item.id === row.asset_id && (!row.station?.id || item.stationId === row.station.id)); return asset ? readinessAssetLabel(asset, labels) : '—'; }
function stationOption(station: Station) { return { value: station.id, label: `${station.name} · ${station.code}` }; }
function statusLabel(value: string, t: ReturnType<typeof useTranslations>) { return t(`statuses.${value}`); }
function scheduleTypeLabel(value: string, t: ReturnType<typeof useTranslations>) { return t(`scheduleTypes.${value}`); }
function workStatuses(t: ReturnType<typeof useTranslations>) { return ['reported', 'triaged', 'scheduled', 'in_progress', 'completed', 'verified', 'closed'].map((value) => ({ value, label: statusLabel(value, t) })); }
function priorityOptions(t: ReturnType<typeof useTranslations>) { return ['low', 'medium', 'high', 'critical'].map((value) => ({ value, label: statusLabel(value, t) })); }
function date(value: string | null | undefined, locale: string) { return value ? new Intl.DateTimeFormat(displayLocale(locale), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—'; }
function integer(value: string) { return value.trim() === '' ? undefined : Number.parseInt(value, 10); }
function minor(value: string) { if (value.trim() === '') return undefined; const result = riyalToMinor(value); return Number.isFinite(result) ? result : undefined; }
function compact<T extends Record<string, unknown>>(value: T): T { return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== '' && item !== undefined)) as T; }
