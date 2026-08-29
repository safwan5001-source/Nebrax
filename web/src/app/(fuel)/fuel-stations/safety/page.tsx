'use client';
import { formatDate } from '@/lib/formatting';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { BadgeCheck, CalendarDays, CircleAlert, ClipboardCheck, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
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

type Tone = 'positive' | 'warning' | 'negative' | 'muted';
type Station = { id: string; name: string; code: string; status: string };
type CorrectiveAction = { id: string; title: string; status: string; due_date?: string | null; assignee?: { name: string } | null };
type Finding = { id: string; checklist_key: string; result: string; severity?: string | null; title: string; details?: string | null; corrective_actions?: CorrectiveAction[] };
type Inspection = { id: string; number: string; inspection_type: string; status: string; scheduled_at: string | null; performed_at?: string | null; station?: Station | null; findings?: Finding[] };
type Permit = { id: string; permit_type: string; reference: string; status: string; issued_on?: string | null; expires_on: string | null; station?: Station | null };
const TONES: Record<string, Tone> = { scheduled: 'warning', performed: 'warning', verified: 'positive', closed: 'muted', active: 'positive', expired: 'negative', revoked: 'muted', pass: 'positive', fail: 'negative', not_applicable: 'muted', low: 'muted', medium: 'warning', high: 'warning', critical: 'negative', open: 'warning', in_progress: 'warning', completed: 'positive' };

export default function FuelStationsSafetyPage() {
  const t = useTranslations('fuelStationsSafety');
  const locale = useLocale();
  const { success } = useToast();
  const [stations, setStations] = useState<Station[]>([]);
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [permits, setPermits] = useState<Permit[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [stationId, setStationId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inspectionOpen, setInspectionOpen] = useState(false);
  const [permitOpen, setPermitOpen] = useState(false);
  const [inspection, setInspection] = useState({ stationId: '', type: '', scheduledAt: '', notes: '' });
  const [permit, setPermit] = useState({ stationId: '', type: '', reference: '', issuedOn: '', expiresOn: '' });

  const can = useCallback((permission: string) => permissions.includes('*') || permissions.includes(permission), [permissions]);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const query = stationId ? `?fuel_station_id=${stationId}` : '';
      const [safety, stationResponse] = await Promise.all([api<{ data: { inspections: { data: Inspection[] }; permits: { data: Permit[] } } }>(`/fuel-stations/safety${query}`), api<{ data: Station[] }>('/fuel-stations/stations')]);
      setInspections(safety.data.inspections.data); setPermits(safety.data.permits.data); setStations(stationResponse.data.filter((station) => station.status === 'active'));
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : t('loadFailed')); } finally { setLoading(false); }
  }, [stationId, t]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const user = currentUser(); if (user?.permissions) setPermissions(user.permissions); else api<{ user: { permissions?: string[] } }>('/me').then((response) => setPermissions(response.user.permissions ?? [])).catch(() => {}); }, []);

  function resetInspection() { setInspection({ stationId: '', type: '', scheduledAt: '', notes: '' }); }
  function resetPermit() { setPermit({ stationId: '', type: '', reference: '', issuedOn: '', expiresOn: '' }); }
  async function saveInspection() { if (!inspection.stationId || !inspection.type.trim()) return; setBusy(true); setError(null); try { await api('/fuel-stations/safety/inspections', { method: 'POST', body: compact({ fuel_station_id: inspection.stationId, inspection_type: inspection.type, scheduled_at: inspection.scheduledAt || null, notes: inspection.notes }) }); success(t('inspectionCreated')); setInspectionOpen(false); resetInspection(); await load(); } catch (cause) { setError(cause instanceof ApiError ? cause.message : t('saveFailed')); } finally { setBusy(false); } }
  async function savePermit() { if (!permit.stationId || !permit.type.trim() || !permit.reference.trim()) return; setBusy(true); setError(null); try { await api('/fuel-stations/safety/permits', { method: 'POST', body: compact({ fuel_station_id: permit.stationId, permit_type: permit.type, reference: permit.reference, issued_on: permit.issuedOn || null, expires_on: permit.expiresOn || null }) }); success(t('permitCreated')); setPermitOpen(false); resetPermit(); await load(); } catch (cause) { setError(cause instanceof ApiError ? cause.message : t('saveFailed')); } finally { setBusy(false); } }

  if (loading) return <Loading />;
  return <div className="space-y-5">
    <header className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div><h1 className="text-xl font-semibold text-text">{t('title')}</h1><p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">{t('subtitle')}</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={!can('fuel.safety.manage')} onClick={() => { resetPermit(); setPermitOpen(true); }}><Plus className="h-4 w-4" />{t('newPermit')}</Button><Button disabled={!can('fuel.safety.manage')} onClick={() => { resetInspection(); setInspectionOpen(true); }}><Plus className="h-4 w-4" />{t('newInspection')}</Button></div></header>
    {error && <ErrorBanner message={error} retry={load} label={t('retry')} />}
    <Card><CardContent className="flex flex-wrap items-end gap-3 py-4"><div className="min-w-56 flex-1"><FieldSelect label={t('station')} value={stationId} onChange={setStationId} options={stations.map((station) => ({ value: station.id, label: `${station.name} · ${station.code}` }))} /></div><Button className="min-h-11" variant="outline" onClick={() => void load()}><RefreshCw className="h-4 w-4" />{t('refresh')}</Button></CardContent></Card>
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5 text-primary" strokeWidth={1.7} />{t('inspections')}<span className="num text-sm font-normal text-muted">{inspections.length}</span></CardTitle></CardHeader><CardContent>{inspections.length === 0 ? <Empty text={t('emptyInspections')} /> : <div className="space-y-3">{inspections.map((item) => <InspectionCard key={item.id} inspection={item} locale={locale} t={t} />)}</div>}</CardContent></Card>
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><BadgeCheck className="h-5 w-5 text-primary" strokeWidth={1.7} />{t('permitsCertificates')}<span className="num text-sm font-normal text-muted">{permits.length}</span></CardTitle></CardHeader><CardContent>{permits.length === 0 ? <Empty text={t('emptyPermits')} /> : <PermitList permits={permits} locale={locale} t={t} />}</CardContent></Card>
    <Dialog open={inspectionOpen} onClose={() => setInspectionOpen(false)} title={t('newInspection')}><form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void saveInspection(); }}><FieldSelect label={t('station')} value={inspection.stationId} required onChange={(value) => setInspection({ ...inspection, stationId: value })} options={stations.map((station) => ({ value: station.id, label: `${station.name} · ${station.code}` }))} /><FieldInput label={t('inspectionType')} value={inspection.type} required onChange={(value) => setInspection({ ...inspection, type: value })} /><FieldInput label={t('scheduledAt')} value={inspection.scheduledAt} type="datetime-local" onChange={(value) => setInspection({ ...inspection, scheduledAt: value })} /><FieldInput label={t('notes')} value={inspection.notes} onChange={(value) => setInspection({ ...inspection, notes: value })} /><DialogActions busy={busy} cancel={t('cancel')} submit={t('create')} disabled={!inspection.stationId || !inspection.type.trim()} onCancel={() => setInspectionOpen(false)} /></form></Dialog>
    <Dialog open={permitOpen} onClose={() => setPermitOpen(false)} title={t('newPermit')}><form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void savePermit(); }}><FieldSelect label={t('station')} value={permit.stationId} required onChange={(value) => setPermit({ ...permit, stationId: value })} options={stations.map((station) => ({ value: station.id, label: `${station.name} · ${station.code}` }))} /><FieldInput label={t('permitType')} value={permit.type} required onChange={(value) => setPermit({ ...permit, type: value })} /><FieldInput label={t('reference')} value={permit.reference} required onChange={(value) => setPermit({ ...permit, reference: value })} /><FieldInput label={t('issuedOn')} value={permit.issuedOn} type="date" onChange={(value) => setPermit({ ...permit, issuedOn: value })} /><FieldInput label={t('expiresOn')} value={permit.expiresOn} type="date" onChange={(value) => setPermit({ ...permit, expiresOn: value })} /><DialogActions busy={busy} cancel={t('cancel')} submit={t('create')} disabled={!permit.stationId || !permit.type.trim() || !permit.reference.trim()} onCancel={() => setPermitOpen(false)} /></form></Dialog>
  </div>;
}

function InspectionCard({ inspection, locale, t }: { inspection: Inspection; locale: string; t: ReturnType<typeof useTranslations> }) { return <article className="rounded-md border border-border p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="num text-xs text-muted">{inspection.number}</p><h2 className="mt-1 font-medium text-text">{inspection.inspection_type}</h2><p className="mt-1 text-sm text-muted">{inspection.station?.name ?? '—'} · {date(inspection.scheduled_at, locale)}</p></div><Status value={inspection.status} t={t} /></div>{inspection.findings && inspection.findings.length > 0 && <div className="mt-4 border-t border-border pt-4"><h3 className="flex items-center gap-2 text-sm font-medium text-text"><ShieldCheck className="h-4 w-4 text-muted" strokeWidth={1.7} />{t('findings')}</h3><div className="mt-3 space-y-3">{inspection.findings.map((finding) => <FindingCard key={finding.id} finding={finding} locale={locale} t={t} />)}</div></div>}</article>; }
function FindingCard({ finding, locale, t }: { finding: Finding; locale: string; t: ReturnType<typeof useTranslations> }) { return <div className="rounded-md border border-border/70 p-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><h4 className="font-medium text-text">{finding.title}</h4>{finding.details && <p className="mt-2 text-sm leading-relaxed text-muted">{finding.details}</p>}</div><div className="flex gap-2"><Status value={finding.result} t={t} />{finding.severity && <Status value={finding.severity} t={t} />}</div></div>{finding.corrective_actions && finding.corrective_actions.length > 0 && <div className="mt-3 border-t border-border pt-3"><p className="text-xs font-medium text-muted">{t('correctiveActions')}</p><div className="mt-2 space-y-2">{finding.corrective_actions.map((action) => <div key={action.id} className="flex flex-wrap items-center justify-between gap-2 text-sm"><span className="text-text">{action.title}</span><span className="flex items-center gap-2"><span className="text-muted">{action.assignee?.name ?? '—'} · {date(action.due_date, locale)}</span><Status value={action.status} t={t} /></span></div>)}</div></div>}</div>; }
function PermitList({ permits, locale, t }: { permits: Permit[]; locale: string; t: ReturnType<typeof useTranslations> }) { return <><div className="hidden overflow-x-auto lg:block"><table className="w-full min-w-[48rem] text-sm"><thead className="border-b border-border text-start text-xs text-muted"><tr>{[t('permitType'), t('reference'), t('station'), t('issuedOn'), t('expiresOn'), t('status')].map((heading) => <th key={heading} className="px-3 py-3 font-medium">{heading}</th>)}</tr></thead><tbody>{permits.map((permit) => <tr key={permit.id} className="border-b border-border/70 last:border-0"><td className="px-3 py-3 font-medium text-text">{permit.permit_type}</td><td className="num px-3 py-3 text-muted">{permit.reference}</td><td className="px-3 py-3 text-muted">{permit.station?.name ?? '—'}</td><td className="num px-3 py-3 text-muted">{date(permit.issued_on, locale)}</td><td className="num px-3 py-3 text-muted">{date(permit.expires_on, locale)}</td><td className="px-3 py-3"><Status value={permit.status} t={t} /></td></tr>)}</tbody></table></div><div className="space-y-3 lg:hidden">{permits.map((permit) => <article key={permit.id} className="rounded-md border border-border p-3"><div className="flex items-start justify-between gap-3"><div><h2 className="font-medium text-text">{permit.permit_type}</h2><p className="num mt-1 text-sm text-muted">{permit.reference} · {permit.station?.name ?? '—'}</p></div><Status value={permit.status} t={t} /></div><dl className="mt-3 grid grid-cols-2 gap-2 border-t border-border pt-3 text-sm"><Detail label={t('issuedOn')} value={date(permit.issued_on, locale)} /><Detail label={t('expiresOn')} value={date(permit.expires_on, locale)} /></dl></article>)}</div></>; }
function Status({ value, t }: { value: string; t: ReturnType<typeof useTranslations> }) { return <Badge tone={TONES[value] ?? 'muted'}>{t(`statuses.${value}`)}</Badge>; }
function FieldInput({ label, value, onChange, type = 'text', required }: { label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean }) { return <div className="space-y-1.5"><Label>{label}</Label><Input type={type} value={value} required={required} onChange={(event) => onChange(event.target.value)} /></div>; }
function FieldSelect({ label, value, onChange, options, required }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; required?: boolean }) { return <div className="space-y-1.5"><Label>{label}</Label><Select value={value} required={required} onChange={(event) => onChange(event.target.value)}><option value="">—</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</Select></div>; }
function DialogActions({ busy, cancel, submit, disabled, onCancel }: { busy: boolean; cancel: string; submit: string; disabled: boolean; onCancel: () => void }) { return <div className="flex justify-end gap-2 border-t border-border pt-4"><Button type="button" variant="outline" onClick={onCancel}>{cancel}</Button><Button type="submit" disabled={busy || disabled}>{busy && <span className="animate-pulse">…</span>}{submit}</Button></div>; }
function ErrorBanner({ message, retry, label }: { message: string; retry: () => void; label: string }) { return <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-negative/30 bg-negative/10 px-3 py-3 text-sm text-negative"><span className="flex items-center gap-2"><CircleAlert className="h-4 w-4" />{message}</span><Button variant="outline" size="sm" onClick={() => void retry()}><RefreshCw className="h-4 w-4" />{label}</Button></div>; }
function Detail({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 text-text">{value}</dd></div>; }
function Empty({ text }: { text: string }) { return <p className="rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-muted">{text}</p>; }
function Loading() { return <div className="space-y-4" aria-busy="true"><Skeleton className="h-10 w-72" /><Skeleton className="h-48 w-full" /><Skeleton className="h-48 w-full" /></div>; }
function compact<T extends Record<string, unknown>>(value: T): T { return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== '' && item !== undefined)) as T; }
function date(value: string | null | undefined, locale: string) { return formatDate(value, locale); }
