'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, BarChart3, ClipboardCheck, Fuel, Plus, RefreshCw, ShieldCheck, Wrench } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { currentUser } from '@/lib/auth';

type Tone = 'positive' | 'warning' | 'negative' | 'neutral';
interface Station { id: string; name: string; code: string; status: string }
interface Dashboard { sales_today_minor: number; liters_today_milliliters: number; gross_margin_minor: number; open_shifts: number; open_work_orders: number; active_alerts: number; degraded_devices: number; tank_days_remaining: null }
interface WorkOrder { id: string; number: string; title: string; status: string; priority: string; cost_minor: number; downtime_minutes: number; opened_at: string; scheduled_at: string | null }
interface Schedule { id: string; name: string; status: string; schedule_type: string; next_due_at: string | null }
interface Inspection { id: string; number: string; inspection_type: string; status: string; scheduled_at: string | null; findings?: unknown[] }
interface Permit { id: string; permit_type: string; reference: string; status: string; expires_on: string | null }
interface Alert { id: string; rule: string; severity: string; status: string; title: string; description: string; last_detected_at: string; source_type: string | null }
interface SalesRow { dimension_id: string | null; revenue_minor: number; cogs_minor: number; margin_minor: number; quantity_milliliters: number; sales_count: number }
interface StatusSummary { status: string; count: number; cost_minor?: number; downtime_minutes?: number }

const TONES: Record<string, Tone> = { active: 'positive', verified: 'positive', completed: 'positive', closed: 'neutral', resolved: 'positive', acknowledged: 'warning', scheduled: 'warning', reported: 'warning', triaged: 'warning', in_progress: 'warning', high: 'warning', medium: 'warning', low: 'neutral', critical: 'negative', failed: 'negative', expired: 'negative' };
const STATION_ASSET = 'App\\Models\\FuelStation';

export default function FuelStationsReadinessPage() {
  const t = useTranslations('fuelStationsReadiness');
  const tc = useTranslations('common');
  const { success } = useToast();
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]); const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [inspections, setInspections] = useState<Inspection[]>([]); const [permits, setPermits] = useState<Permit[]>([]); const [alerts, setAlerts] = useState<Alert[]>([]);
  const [sales, setSales] = useState<SalesRow[]>([]); const [maintenanceSummary, setMaintenanceSummary] = useState<StatusSummary[]>([]); const [safetySummary, setSafetySummary] = useState<StatusSummary[]>([]);
  const [stations, setStations] = useState<Station[]>([]); const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const [workOrderOpen, setWorkOrderOpen] = useState(false); const [inspectionOpen, setInspectionOpen] = useState(false); const [permitOpen, setPermitOpen] = useState(false);
  const [stationId, setStationId] = useState(''); const [workTitle, setWorkTitle] = useState(''); const [workType, setWorkType] = useState('corrective');
  const [inspectionType, setInspectionType] = useState(''); const [permitType, setPermitType] = useState(''); const [permitReference, setPermitReference] = useState(''); const [permitExpires, setPermitExpires] = useState('');

  const can = useCallback((permission: string) => permissions.includes('*') || permissions.includes(permission), [permissions]);
  const money = useCallback((minor: number) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'SAR' }).format(minor / 100), []);
  const volume = useCallback((ml: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(ml / 1000), []);
  const label = useCallback((value: string) => { const key = value.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()); try { return t(key); } catch { return value; } }, [t]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [dashboardResult, maintenanceResult, safetyResult, alertsResult, salesResult, maintenanceReport, safetyReport, stationsResult] = await Promise.all([
        api<{ data: Dashboard }>('/fuel-stations/dashboard'),
        api<{ data: { schedules: { data: Schedule[] }; work_orders: { data: WorkOrder[] } } }>('/fuel-stations/maintenance'),
        api<{ data: { inspections: { data: Inspection[] }; permits: { data: Permit[] } } }>('/fuel-stations/safety'),
        api<{ data: { data: Alert[] } }>('/fuel-stations/alerts'),
        api<{ data: { rows: SalesRow[] } }>('/fuel-stations/reports/sales?dimension=station'),
        api<{ data: { rows: StatusSummary[] } }>('/fuel-stations/reports/maintenance'),
        api<{ data: { inspection_statuses: StatusSummary[] } }>('/fuel-stations/reports/safety'),
        api<{ data: Station[] }>('/fuel-stations/stations'),
      ]);
      setDashboard(dashboardResult.data); setSchedules(maintenanceResult.data.schedules.data); setWorkOrders(maintenanceResult.data.work_orders.data);
      setInspections(safetyResult.data.inspections.data); setPermits(safetyResult.data.permits.data); setAlerts(alertsResult.data.data);
      setSales(salesResult.data.rows); setMaintenanceSummary(maintenanceReport.data.rows); setSafetySummary(safetyReport.data.inspection_statuses); setStations(stationsResult.data.filter((station) => station.status === 'active'));
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : t('loadFailed')); } finally { setLoading(false); }
  }, [t]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const user = currentUser(); if (user?.permissions) setPermissions(user.permissions); else api<{ user: { permissions?: string[] } }>('/me').then((result) => setPermissions(result.user.permissions ?? [])).catch(() => {}); }, []);

  const reset = () => { setStationId(''); setWorkTitle(''); setWorkType('corrective'); setInspectionType(''); setPermitType(''); setPermitReference(''); setPermitExpires(''); };
  const stationOptions = useMemo(() => stations.map((station) => ({ value: station.id, label: `${station.name} · ${station.code}` })), [stations]);

  async function scanAlerts() { setBusy(true); try { await api('/fuel-stations/alerts/scan', { method: 'POST' }); success(t('scanDone')); await load(); } catch (cause) { setError(cause instanceof ApiError ? cause.message : tc('saveFailed')); } finally { setBusy(false); } }
  async function createWorkOrder() { if (!stationId || !workTitle.trim()) return; setBusy(true); try { await api('/fuel-stations/maintenance/work-orders', { method: 'POST', body: { fuel_station_id: stationId, asset_type: STATION_ASSET, asset_id: stationId, work_type: workType, title: workTitle.trim() } }); success(t('created')); setWorkOrderOpen(false); reset(); await load(); } catch (cause) { setError(cause instanceof ApiError ? cause.message : tc('saveFailed')); } finally { setBusy(false); } }
  async function createInspection() { if (!stationId || !inspectionType.trim()) return; setBusy(true); try { await api('/fuel-stations/safety/inspections', { method: 'POST', body: { fuel_station_id: stationId, inspection_type: inspectionType.trim() } }); success(t('created')); setInspectionOpen(false); reset(); await load(); } catch (cause) { setError(cause instanceof ApiError ? cause.message : tc('saveFailed')); } finally { setBusy(false); } }
  async function createPermit() { if (!stationId || !permitType.trim() || !permitReference.trim()) return; setBusy(true); try { await api('/fuel-stations/safety/permits', { method: 'POST', body: { fuel_station_id: stationId, permit_type: permitType.trim(), reference: permitReference.trim(), expires_on: permitExpires || null } }); success(t('created')); setPermitOpen(false); reset(); await load(); } catch (cause) { setError(cause instanceof ApiError ? cause.message : tc('saveFailed')); } finally { setBusy(false); } }

  if (loading && !dashboard) return <div className="space-y-4" aria-busy="true"><Skeleton className="h-10 w-80" /><Skeleton className="h-28 w-full" /><Skeleton className="h-72 w-full" /></div>;
  const metrics = dashboard ? [
    { label: t('salesToday'), value: money(dashboard.sales_today_minor), icon: <BarChart3 /> }, { label: t('litersToday'), value: volume(dashboard.liters_today_milliliters), icon: <Fuel /> },
    { label: t('grossMargin'), value: money(dashboard.gross_margin_minor), icon: <BarChart3 /> }, { label: t('openShifts'), value: String(dashboard.open_shifts), icon: <ClipboardCheck /> },
    { label: t('openWorkOrders'), value: String(dashboard.open_work_orders), icon: <Wrench /> }, { label: t('activeAlerts'), value: String(dashboard.active_alerts), icon: <AlertTriangle /> },
    { label: t('degradedDevices'), value: String(dashboard.degraded_devices), icon: <ShieldCheck /> },
  ] : [];

  return <div className="space-y-6">
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div><p className="text-sm text-muted">{t('eyebrow')}</p><h1 className="text-xl font-semibold text-text">{t('title')}</h1><p className="mt-1 max-w-4xl text-sm text-muted">{t('subtitle')}</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy || !can('fuel.alerts.manage')} onClick={() => void scanAlerts()}><RefreshCw className="h-4 w-4" />{t('scanAlerts')}</Button><Button variant="outline" disabled={!can('fuel.safety.manage')} onClick={() => { reset(); setPermitOpen(true); }}><Plus className="h-4 w-4" />{t('newPermit')}</Button><Button variant="outline" disabled={!can('fuel.safety.manage')} onClick={() => { reset(); setInspectionOpen(true); }}><Plus className="h-4 w-4" />{t('newInspection')}</Button><Button disabled={!can('fuel.maintenance.manage')} onClick={() => { reset(); setWorkOrderOpen(true); }}><Plus className="h-4 w-4" />{t('newWorkOrder')}</Button></div></div>
    <p className="rounded-md border border-border bg-primary-soft px-3 py-2 text-xs text-text">{t('notice')}</p>
    {error && <p role="alert" className="rounded-md bg-negative/10 px-3 py-2 text-sm text-negative">{error}</p>}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{metrics.map((metric) => <Metric key={metric.label} {...metric} />)}</div>
    <section className="grid gap-5 xl:grid-cols-2"><Panel icon={<Wrench />} title={t('maintenance')}><SummaryTable rows={maintenanceSummary} label={label} t={t} /><DataRows columns={[t('number'), t('titleColumn'), t('status'), t('priority'), t('downtime')]} rows={workOrders.map((row) => [row.number, row.title, <Badge key="status" tone={TONES[row.status] ?? 'neutral'}>{label(row.status)}</Badge>, <Badge key="priority" tone={TONES[row.priority] ?? 'neutral'}>{label(row.priority)}</Badge>, String(row.downtime_minutes)])} empty={t('empty')} /></Panel><Panel icon={<ClipboardCheck />} title={t('safety')}><SummaryTable rows={safetySummary} label={label} t={t} /><DataRows columns={[t('number'), t('titleColumn'), t('status'), t('due')]} rows={inspections.map((row) => [row.number, row.inspection_type, <Badge key="status" tone={TONES[row.status] ?? 'neutral'}>{label(row.status)}</Badge>, date(row.scheduled_at)])} empty={t('empty')} /></Panel></section>
    <section className="grid gap-5 xl:grid-cols-2"><Panel icon={<AlertTriangle />} title={t('alerts')}><DataRows columns={[t('severity'), t('titleColumn'), t('status'), t('lastDetected')]} rows={alerts.map((row) => [<Badge key="severity" tone={TONES[row.severity] ?? 'neutral'}>{label(row.severity)}</Badge>, row.title, <Badge key="status" tone={TONES[row.status] ?? 'neutral'}>{label(row.status)}</Badge>, date(row.last_detected_at)])} empty={t('empty')} /></Panel><Panel icon={<BarChart3 />} title={t('reports')}><h3 className="mb-2 text-sm font-medium text-text">{t('salesByStation')}</h3><DataRows columns={[t('source'), t('revenue'), t('cogs'), t('margin'), t('quantity')]} rows={sales.map((row) => [row.dimension_id ?? '—', money(row.revenue_minor), money(row.cogs_minor), money(row.margin_minor), volume(row.quantity_milliliters)])} empty={t('empty')} /></Panel></section>
    <section className="grid gap-5 xl:grid-cols-2"><Panel icon={<ClipboardCheck />} title={t('permits')}><DataRows columns={[t('permitType'), t('reference'), t('status'), t('expiresOn')]} rows={permits.map((row) => [row.permit_type, row.reference, <Badge key="status" tone={TONES[row.status] ?? 'neutral'}>{label(row.status)}</Badge>, date(row.expires_on)])} empty={t('empty')} /></Panel><Panel icon={<Wrench />} title={t('schedules')}><DataRows columns={[t('titleColumn'), t('workType'), t('status'), t('due')]} rows={schedules.map((row) => [row.name, row.schedule_type, <Badge key="status" tone={TONES[row.status] ?? 'neutral'}>{label(row.status)}</Badge>, date(row.next_due_at)])} empty={t('empty')} /></Panel></section>
    <Dialog open={workOrderOpen} onClose={() => setWorkOrderOpen(false)} title={t('newWorkOrder')}><form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void createWorkOrder(); }}><StationField t={t} value={stationId} onChange={setStationId} options={stationOptions} disabled={busy} /><Field id="readiness-work-title" label={t('titleColumn')} value={workTitle} onChange={setWorkTitle} disabled={busy} /><SelectField id="readiness-work-type" label={t('workType')} value={workType} onChange={setWorkType} disabled={busy} options={[{ value: 'corrective', label: t('corrective') }, { value: 'preventive', label: t('preventive') }]} /><DialogActions t={t} tc={tc} busy={busy} disabled={!stationId || !workTitle.trim()} onCancel={() => setWorkOrderOpen(false)} /></form></Dialog>
    <Dialog open={inspectionOpen} onClose={() => setInspectionOpen(false)} title={t('newInspection')}><form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void createInspection(); }}><StationField t={t} value={stationId} onChange={setStationId} options={stationOptions} disabled={busy} /><Field id="readiness-inspection-type" label={t('inspectionType')} value={inspectionType} onChange={setInspectionType} disabled={busy} /><DialogActions t={t} tc={tc} busy={busy} disabled={!stationId || !inspectionType.trim()} onCancel={() => setInspectionOpen(false)} /></form></Dialog>
    <Dialog open={permitOpen} onClose={() => setPermitOpen(false)} title={t('newPermit')}><form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void createPermit(); }}><StationField t={t} value={stationId} onChange={setStationId} options={stationOptions} disabled={busy} /><Field id="readiness-permit-type" label={t('permitType')} value={permitType} onChange={setPermitType} disabled={busy} /><Field id="readiness-permit-reference" label={t('reference')} value={permitReference} onChange={setPermitReference} disabled={busy} /><Field id="readiness-permit-expiry" label={t('expiresOn')} value={permitExpires} onChange={setPermitExpires} disabled={busy} type="date" optional /><DialogActions t={t} tc={tc} busy={busy} disabled={!stationId || !permitType.trim() || !permitReference.trim()} onCancel={() => setPermitOpen(false)} /></form></Dialog>
  </div>;
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) { return <div className="rounded-md border border-border bg-surface p-3"><div className="flex items-center gap-2 text-sm text-muted"><span aria-hidden="true" className="text-primary">{icon}</span>{label}</div><p className="num mt-2 text-xl font-semibold text-text">{value}</p></div>; }
function Panel({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) { return <section className="rounded-md border border-border bg-surface p-4"><div className="mb-3 flex items-center gap-2"><span aria-hidden="true" className="text-primary">{icon}</span><h2 className="text-base font-semibold text-text">{title}</h2></div>{children}</section>; }
function DataRows({ columns, rows, empty }: { columns: string[]; rows: ReactNode[][]; empty: string }) { return <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-right text-sm"><thead className="border-y border-border text-xs text-muted"><tr>{columns.map((column) => <th className="px-2 py-2 font-medium" key={column}>{column}</th>)}</tr></thead><tbody>{rows.length ? rows.map((row, index) => <tr className="border-b border-border/70 last:border-0" key={index}>{row.map((cell, cellIndex) => <td className="px-2 py-2 text-text" key={cellIndex}>{cell}</td>)}</tr>) : <tr><td className="px-2 py-4 text-muted" colSpan={columns.length}>{empty}</td></tr>}</tbody></table></div>; }
function SummaryTable({ rows, label, t }: { rows: StatusSummary[]; label: (value: string) => string; t: ReturnType<typeof useTranslations> }) { return <div className="mb-4 flex flex-wrap gap-2">{rows.map((row) => <span key={row.status} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted"><Badge tone={TONES[row.status] ?? 'neutral'}>{label(row.status)}</Badge><span className="num">{row.count}</span>{row.downtime_minutes ? <span>· {row.downtime_minutes} {t('downtime')}</span> : null}</span>)}</div>; }
function StationField({ t, value, onChange, options, disabled }: { t: ReturnType<typeof useTranslations>; value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; disabled: boolean }) { return <div className="space-y-1.5"><Label htmlFor="readiness-station">{t('station')}</Label><select id="readiness-station" className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-primary/40" value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} required><option value="">{t('selectStation')}</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>; }
function Field({ id, label, value, onChange, disabled, type = 'text', optional = false }: { id: string; label: string; value: string; onChange: (value: string) => void; disabled: boolean; type?: string; optional?: boolean }) { return <div className="space-y-1.5"><Label htmlFor={id}>{label}</Label><Input id={id} type={type} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} required={!optional} /></div>; }
function SelectField({ id, label, value, onChange, disabled, options }: { id: string; label: string; value: string; onChange: (value: string) => void; disabled: boolean; options: { value: string; label: string }[] }) { return <div className="space-y-1.5"><Label htmlFor={id}>{label}</Label><select id={id} className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-primary/40" value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>; }
function DialogActions({ t, tc, busy, disabled, onCancel }: { t: ReturnType<typeof useTranslations>; tc: ReturnType<typeof useTranslations>; busy: boolean; disabled: boolean; onCancel: () => void }) { return <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="outline" onClick={onCancel}>{tc('cancel')}</Button><Button type="submit" disabled={busy || disabled}>{t('create')}</Button></div>; }
function date(value: string | null) { return value ? new Date(value).toLocaleString() : '—'; }
