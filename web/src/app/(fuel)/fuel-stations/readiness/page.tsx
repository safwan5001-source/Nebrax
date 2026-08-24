'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, CircleAlert, ClipboardCheck, Network, RefreshCw, ShieldCheck, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api, ApiError } from '@/lib/api';
import { currentUser } from '@/lib/auth';

type Dashboard = { open_shifts: number; open_work_orders: number; active_alerts: number; degraded_devices: number; tank_days_remaining: null };

export default function FuelStationsReadinessPage() {
  const t = useTranslations('fuelStationsReadiness');
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [permissionsReady, setPermissionsReady] = useState(false);
  const can = useCallback((permission: string) => permissions.includes('*') || permissions.includes(permission), [permissions]);
  const canViewSummary = can('fuel.reports.view');
  const load = useCallback(async () => { if (!canViewSummary) { setDashboard(null); setLoading(false); return; } setLoading(true); setError(null); try { const response = await api<{ data: Dashboard }>('/fuel-stations/dashboard'); setDashboard(response.data); } catch (cause) { setError(cause instanceof ApiError ? cause.message : t('loadFailed')); } finally { setLoading(false); } }, [canViewSummary, t]);
  useEffect(() => { if (permissionsReady) void load(); }, [load, permissionsReady]);
  useEffect(() => { const user = currentUser(); if (user?.permissions) { setPermissions(user.permissions); setPermissionsReady(true); } else api<{ user: { permissions?: string[] } }>('/me').then((response) => setPermissions(response.user.permissions ?? [])).catch(() => {}).finally(() => setPermissionsReady(true)); }, []);
  if (!permissionsReady || (loading && !dashboard)) return <div className="space-y-4" aria-busy="true"><Skeleton className="h-10 w-80" /><Skeleton className="h-28 w-full" /><Skeleton className="h-28 w-full" /></div>;
  if (!canViewSummary) return <div className="space-y-5"><header><p className="text-sm text-muted">{t('eyebrow')}</p><h1 className="text-xl font-semibold text-text">{t('summaryTitle')}</h1><p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">{t('summarySubtitle')}</p></header><Card><CardContent className="py-6"><p role="status" className="text-sm leading-relaxed text-muted">{t('noPermission')}</p></CardContent></Card></div>;
  const metrics = dashboard ? [
    { label: t('openShifts'), value: dashboard.open_shifts, icon: ClipboardCheck, href: '/fuel-stations/shifts', visible: can('fuel.shift.view') },
    { label: t('openWorkOrders'), value: dashboard.open_work_orders, icon: Wrench, href: '/fuel-stations/maintenance', visible: can('fuel.maintenance.view') },
    { label: t('activeAlerts'), value: dashboard.active_alerts, icon: AlertTriangle, href: '/fuel-stations/alerts', visible: can('fuel.alerts.view') },
    { label: t('degradedDevices'), value: dashboard.degraded_devices, icon: Network, href: '/fuel-stations/devices', visible: can('fuel.device.view') && can('fuel.integration.view') },
  ].filter((metric) => metric.visible) : [];
  return <div className="space-y-5"><header><p className="text-sm text-muted">{t('eyebrow')}</p><h1 className="text-xl font-semibold text-text">{t('summaryTitle')}</h1><p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">{t('summarySubtitle')}</p></header>{error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-negative/30 bg-negative/10 px-3 py-3 text-sm text-negative"><span className="flex items-center gap-2"><CircleAlert className="h-4 w-4" />{error}</span><Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw className="h-4 w-4" />{t('retry')}</Button></div>}<section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{metrics.map((metric) => { const Icon = metric.icon; return <Link key={metric.label} href={metric.href} className="rounded-md border border-border bg-surface p-4 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><span className="flex items-center gap-2 text-sm text-muted"><Icon aria-hidden="true" className="h-4 w-4 text-primary" strokeWidth={1.7} />{metric.label}</span><p className="num mt-3 text-2xl font-semibold text-text">{metric.value}</p></Link>; })}</section><Card><CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" strokeWidth={1.7} />{t('healthScopeTitle')}</CardTitle></CardHeader><CardContent><p className="max-w-3xl text-sm leading-relaxed text-muted">{t('healthScopeNotice')}</p></CardContent></Card></div>;
}
