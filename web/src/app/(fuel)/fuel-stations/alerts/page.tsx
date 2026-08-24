'use client';
import { displayLocale } from '@/lib/formatting';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, Check, CircleAlert, Loader2, RefreshCw, UserRoundPlus } from 'lucide-react';
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
import { fuelAlertRuleLabelKey } from '@/lib/fuel-readiness';

type Tone = 'positive' | 'warning' | 'negative' | 'muted';
type Alert = { id: string; rule: string; severity: string; status: string; title: string; description: string; source_type?: string | null; last_detected_at: string; first_detected_at?: string | null; acknowledged_at?: string | null; acknowledged_by?: { name: string } | null; assignee?: { name: string } | null };
type User = { id: string; name: string };
const TONES: Record<string, Tone> = { active: 'warning', acknowledged: 'warning', resolved: 'positive', critical: 'negative', high: 'warning', medium: 'warning', low: 'muted' };

export default function FuelStationsAlertsPage() {
  const t = useTranslations('fuelStationsAlerts');
  const locale = useLocale();
  const { success } = useToast();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  const [severity, setSeverity] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acknowledging, setAcknowledging] = useState<Alert | null>(null);
  const [assigning, setAssigning] = useState<Alert | null>(null);
  const [note, setNote] = useState('');
  const [assignee, setAssignee] = useState('');
  const [reason, setReason] = useState('');
  const canManage = permissions.includes('*') || permissions.includes('fuel.alerts.manage');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const query = new URLSearchParams(); if (status) query.set('status', status); if (severity) query.set('severity', severity);
      const [result, userResult] = await Promise.all([api<{ data: { data: Alert[] } }>(`/fuel-stations/alerts${query.size ? `?${query}` : ''}`), api<{ data: User[] }>('/users').catch(() => ({ data: [] }))]);
      setAlerts(result.data.data); setUsers(userResult.data);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : t('loadFailed')); } finally { setLoading(false); }
  }, [severity, status, t]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const user = currentUser(); if (user?.permissions) setPermissions(user.permissions); else api<{ user: { permissions?: string[] } }>('/me').then((response) => setPermissions(response.user.permissions ?? [])).catch(() => {}); }, []);

  async function scan() { setBusy(true); setError(null); try { await api('/fuel-stations/alerts/scan', { method: 'POST' }); success(t('scanCompleted')); await load(); } catch (cause) { setError(cause instanceof ApiError ? cause.message : t('saveFailed')); } finally { setBusy(false); } }
  async function acknowledge() { if (!acknowledging) return; setBusy(true); setError(null); try { await api(`/fuel-stations/alerts/${acknowledging.id}/acknowledge`, { method: 'POST', body: note.trim() ? { note: note.trim() } : {} }); success(t('acknowledged')); setAcknowledging(null); setNote(''); await load(); } catch (cause) { setError(cause instanceof ApiError ? cause.message : t('saveFailed')); } finally { setBusy(false); } }
  async function assign() { if (!assigning) return; setBusy(true); setError(null); try { await api(`/fuel-stations/alerts/${assigning.id}/assign`, { method: 'POST', body: { assigned_to: assignee || null, reason: reason.trim() || null } }); success(t('assigned')); setAssigning(null); setAssignee(''); setReason(''); await load(); } catch (cause) { setError(cause instanceof ApiError ? cause.message : t('saveFailed')); } finally { setBusy(false); } }

  if (loading) return <Loading />;
  return <div className="space-y-5">
    <header className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div><h1 className="text-xl font-semibold text-text">{t('title')}</h1><p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">{t('subtitle')}</p></div>{canManage && <Button disabled={busy} onClick={() => void scan()}><RefreshCw className="h-4 w-4" />{t('scan')}</Button>}</header>
    <p className="rounded-md border border-border bg-primary-soft px-3 py-2 text-sm leading-relaxed text-text">{t('filterScopeNotice')}</p>
    {error && <ErrorBanner message={error} retry={load} label={t('retry')} />}
    <Card><CardContent className="grid gap-3 py-4 md:grid-cols-3"><FieldSelect label={t('status')} emptyLabel={t('allStatuses')} value={status} onChange={setStatus} options={['active', 'acknowledged', 'resolved'].map((value) => ({ value, label: t(`statuses.${value}`) }))} /><FieldSelect label={t('severity')} emptyLabel={t('allSeverities')} value={severity} onChange={setSeverity} options={['critical', 'high', 'medium', 'low'].map((value) => ({ value, label: t(`statuses.${value}`) }))} /><div className="flex items-end"><Button className="min-h-11" variant="outline" onClick={() => void load()}><RefreshCw className="h-4 w-4" />{t('refresh')}</Button></div></CardContent></Card>
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-primary" strokeWidth={1.7} />{t('alertList')}<span className="num text-sm font-normal text-muted">{alerts.length}</span></CardTitle></CardHeader><CardContent>{alerts.length === 0 ? <Empty text={t('empty')} /> : <div className="space-y-3">{alerts.map((alert) => <AlertCard key={alert.id} alert={alert} locale={locale} t={t} canManage={canManage} canAssign={canManage && users.length > 0} onAcknowledge={() => { setNote(''); setAcknowledging(alert); }} onAssign={() => { setAssignee(''); setReason(''); setAssigning(alert); }} />)}</div>}</CardContent></Card>
    <Dialog open={acknowledging !== null} onClose={() => setAcknowledging(null)} title={t('acknowledgeTitle')}><form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void acknowledge(); }}><p className="text-sm text-muted">{acknowledging?.title}</p><FieldInput label={t('acknowledgementNote')} value={note} onChange={setNote} /><DialogActions busy={busy} cancel={t('cancel')} submit={t('acknowledge')} onCancel={() => setAcknowledging(null)} /></form></Dialog>
    <Dialog open={assigning !== null} onClose={() => setAssigning(null)} title={t('assignTitle')}><form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void assign(); }}><p className="text-sm text-muted">{assigning?.title}</p><FieldSelect label={t('assignee')} emptyLabel={t('unassigned')} value={assignee} onChange={setAssignee} options={users.map((user) => ({ value: user.id, label: user.name }))} /><FieldInput label={t('assignmentReason')} value={reason} onChange={setReason} /><DialogActions busy={busy} cancel={t('cancel')} submit={t('assign')} onCancel={() => setAssigning(null)} /></form></Dialog>
  </div>;
}

function AlertCard({ alert, locale, t, canManage, canAssign, onAcknowledge, onAssign }: { alert: Alert; locale: string; t: ReturnType<typeof useTranslations>; canManage: boolean; canAssign: boolean; onAcknowledge: () => void; onAssign: () => void }) { return <article className="rounded-md border border-border p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Status value={alert.severity} t={t} /><Status value={alert.status} t={t} /></div><h2 className="mt-2 font-medium text-text">{alert.title}</h2><p className="mt-1 text-sm leading-relaxed text-muted">{alert.description}</p></div><p className="num text-xs text-muted">{date(alert.last_detected_at, locale)}</p></div><dl className="mt-4 grid gap-3 border-t border-border pt-3 text-sm sm:grid-cols-3"><Detail label={t('rule')} value={alertRuleLabel(alert.rule, t)} /><Detail label={t('assignedTo')} value={alert.assignee?.name ?? '—'} /><Detail label={t('acknowledgedBy')} value={alert.acknowledged_by?.name ?? '—'} /></dl>{canManage && alert.status === 'active' && <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-3"><Button size="sm" variant="outline" onClick={onAcknowledge}><Check className="h-4 w-4" />{t('acknowledge')}</Button>{canAssign && <Button size="sm" variant="outline" onClick={onAssign}><UserRoundPlus className="h-4 w-4" />{t('assign')}</Button>}</div>}</article>; }
function Status({ value, t }: { value: string; t: ReturnType<typeof useTranslations> }) { return <Badge tone={TONES[value] ?? 'muted'}>{t(`statuses.${value}`)}</Badge>; }
function FieldInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <div className="space-y-1.5"><Label>{label}</Label><Input value={value} onChange={(event) => onChange(event.target.value)} /></div>; }
function FieldSelect({ label, emptyLabel, value, onChange, options }: { label: string; emptyLabel: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) { return <div className="space-y-1.5"><Label>{label}</Label><Select value={value} onChange={(event) => onChange(event.target.value)}><option value="">{emptyLabel}</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</Select></div>; }
function DialogActions({ busy, cancel, submit, onCancel }: { busy: boolean; cancel: string; submit: string; onCancel: () => void }) { return <div className="flex justify-end gap-2 border-t border-border pt-4"><Button type="button" variant="outline" onClick={onCancel}>{cancel}</Button><Button type="submit" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{submit}</Button></div>; }
function ErrorBanner({ message, retry, label }: { message: string; retry: () => void; label: string }) { return <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-negative/30 bg-negative/10 px-3 py-3 text-sm text-negative"><span className="flex items-center gap-2"><CircleAlert className="h-4 w-4" />{message}</span><Button variant="outline" size="sm" onClick={() => void retry()}><RefreshCw className="h-4 w-4" />{label}</Button></div>; }
function Detail({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 break-words text-text">{value}</dd></div>; }
function Empty({ text }: { text: string }) { return <p className="rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-muted">{text}</p>; }
function Loading() { return <div className="space-y-4" aria-busy="true"><Skeleton className="h-10 w-72" /><Skeleton className="h-40 w-full" /><Skeleton className="h-40 w-full" /></div>; }
function date(value: string | null | undefined, locale: string) { return value ? new Intl.DateTimeFormat(displayLocale(locale), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—'; }
function alertRuleLabel(rule: string, t: ReturnType<typeof useTranslations>) { return t(`rules.${fuelAlertRuleLabelKey(rule)}`); }
