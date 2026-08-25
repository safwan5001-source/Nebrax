'use client';
import { DISPLAY_LOCALE } from '@/lib/formatting';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowRight, Fuel, RefreshCw } from 'lucide-react';
import { EmptyState, ErrorState, LoadingState, PageHeader, type PageAction } from '@/components/nebrax';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api, ApiError } from '@/lib/api';
import { currentUser } from '@/lib/auth';
import { formatMinorRiyal } from '@/lib/money';
import { formatMillilitersAsLiters } from '@/lib/fuel-quantity';

type Station = {
  id: string;
  branch_id: string | null;
  code: string;
  name: string;
  status: string;
  timezone: string | null;
  operating_day_starts_at: string | null;
};
type Workspace = { stations: Station[] };
type Dashboard = {
  sales_today_minor: number;
  liters_today_milliliters: number;
  gross_margin_minor: number;
  open_shifts: number;
  open_work_orders: number;
  active_alerts: number;
  degraded_devices: number;
  data_boundary: string;
};
type Device = { fuel_station_id: string; health: string; sync_status: string; last_seen_at: string | null };
type Shift = { fuel_station_id: string; opened_at: string | null; status: string };
type Collection<T> = T[] | { data: T[] };

type Summary = {
  dashboard: Dashboard | null;
  devices: Device[];
  shifts: Shift[];
  summaryUnavailable: boolean;
};

const stationTone: Record<string, 'positive' | 'warning' | 'negative' | 'neutral'> = {
  active: 'positive', maintenance: 'warning', inactive: 'neutral', suspended: 'negative',
};

function canAccess(permissions: string[], permission: string) {
  return permissions.includes('*') || permissions.includes(permission);
}

function collectionRows<T>(value: Collection<T> | undefined): T[] {
  return Array.isArray(value) ? value : value?.data ?? [];
}

/**
 * يقرأ حمولة `/fuel-stations/workspace` **بعد التحقق من شكلها**.
 *
 * العقد هو `{ data: { stations: [...] } }`. حمولةٌ بلا `stations` كانت تُخزَّن كما
 * هي فينهار العرض عند أول `stations.filter` — استثناءٌ في `useMemo` يسقط الصفحة
 * كلها لا قسماً منها. إعادة `null` هنا تحوّل ذلك إلى حالة خطأ صريحة.
 */
function readWorkspace(payload: unknown): Workspace | null {
  const stations = (payload as { data?: { stations?: unknown } } | null)?.data?.stations;
  return Array.isArray(stations) ? { stations: stations as Station[] } : null;
}

export default function FuelStationsWorkspacePage() {
  const t = useTranslations('fuelStations');
  const locale = useLocale();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [summary, setSummary] = useState<Summary>({ dashboard: null, devices: [], shifts: [], summaryUnavailable: false });
  const [permissions, setPermissions] = useState<string[] | null>(() => currentUser()?.permissions ?? null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (permissions !== null) return;
    api<{ user: { permissions?: string[] } }>('/me')
      .then((response) => setPermissions(response.user.permissions ?? []))
      .catch(() => setPermissions([]));
  }, [permissions]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const workspaceResult = await api<unknown>('/fuel-stations/workspace');
      const loadedWorkspace = readWorkspace(workspaceResult);
      if (loadedWorkspace === null) {
        setLoadError(t('loadFailed'));
        return;
      }
      setWorkspace(loadedWorkspace);

      const allowed = permissions ?? [];
      const dashboardAllowed = canAccess(allowed, 'fuel.reports.view');
      const devicesAllowed = canAccess(allowed, 'fuel.device.view');
      const shiftsAllowed = canAccess(allowed, 'fuel.shift.view');
      const [dashboardResult, devicesResult, shiftsResult] = await Promise.allSettled([
        dashboardAllowed ? api<{ data: Dashboard }>('/fuel-stations/dashboard') : Promise.resolve(null),
        devicesAllowed ? api<{ data: Collection<Device> }>('/fuel-stations/devices') : Promise.resolve(null),
        shiftsAllowed ? api<{ data: Collection<Shift> }>('/fuel-stations/shifts') : Promise.resolve(null),
      ]);

      const dashboard = dashboardResult.status === 'fulfilled' && dashboardResult.value ? dashboardResult.value.data : null;
      const devices = devicesResult.status === 'fulfilled' && devicesResult.value ? collectionRows(devicesResult.value.data) : [];
      const shifts = shiftsResult.status === 'fulfilled' && shiftsResult.value ? collectionRows(shiftsResult.value.data) : [];
      setSummary({ dashboard, devices, shifts, summaryUnavailable: dashboardAllowed && dashboard === null });
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.message : t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [permissions, t]);

  useEffect(() => { void load(); }, [load]);

  const activeStations = useMemo(() => workspace?.stations?.filter((station) => station.status === 'active').length ?? 0, [workspace]);
  const latestShiftByStation = useMemo(() => {
    const latest = new Map<string, Shift>();
    for (const shift of summary.shifts) {
      const existing = latest.get(shift.fuel_station_id);
      if (!existing || new Date(shift.opened_at ?? 0).getTime() > new Date(existing.opened_at ?? 0).getTime()) latest.set(shift.fuel_station_id, shift);
    }
    return latest;
  }, [summary.shifts]);

  const quickActions = useMemo(() => {
    const values: Array<{ href: string; label: string; permission: string }> = [
      { href: '/fuel-stations/sales', label: t('quickSale'), permission: 'fuel.sale.view' },
      { href: '/fuel-stations/shifts', label: t('quickShift'), permission: 'fuel.shift.view' },
      { href: '/fuel-stations/receiving', label: t('quickReceiving'), permission: 'fuel_stations.view' },
      { href: '/fuel-stations/master-data', label: t('quickStations'), permission: 'fuel_stations.view' },
    ];
    return values.filter((action) => canAccess(permissions ?? [], action.permission));
  }, [permissions, t]);

  const headerActions: PageAction[] = [
    {
      key: 'refresh',
      label: t('refresh'),
      icon: RefreshCw,
      variant: 'outline',
      emphasis: 'secondary',
      disabled: loading,
      onClick: () => void load(),
    },
  ];

  const header = (
    <PageHeader
      eyebrow={t('eyebrow')}
      title={t('commandCenterTitle')}
      description={t('commandCenterSubtitle')}
      actions={headerActions}
    />
  );

  if (loading && !workspace) {
    return (
      <div className="space-y-5">
        {header}
        <LoadingState variant="metrics" rows={4} />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (loadError || !workspace) {
    return (
      <div className="space-y-5">
        {header}
        <ErrorState message={loadError ?? t('loadFailed')} onRetry={() => void load()} retryLabel={t('retry')} />
      </div>
    );
  }

  const metrics = summary.dashboard ? [
    { label: t('salesToday'), value: formatMinorRiyal(summary.dashboard.sales_today_minor) },
    { label: t('litersToday'), value: formatMillilitersAsLiters(summary.dashboard.liters_today_milliliters, locale, t('literUnit')) },
    { label: t('grossMargin'), value: formatMinorRiyal(summary.dashboard.gross_margin_minor) },
    { label: t('openShifts'), value: String(summary.dashboard.open_shifts) },
    { label: t('openWorkOrders'), value: String(summary.dashboard.open_work_orders) },
    { label: t('activeAlerts'), value: String(summary.dashboard.active_alerts) },
    { label: t('degradedDevices'), value: String(summary.dashboard.degraded_devices) },
  ] : [];

  return (
    <div className="space-y-5">
      {header}

      {summary.dashboard ? (
        <section aria-label={t('operationalSummary')} className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {metrics.map((metric) => <Metric key={metric.label} label={metric.label} value={metric.value} />)}
        </section>
      ) : summary.summaryUnavailable ? (
        <p role="status" className="rounded border border-border bg-surface px-4 py-3 text-sm text-muted">{t('summaryUnavailable')}</p>
      ) : null}

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(17rem,0.65fr)]">
        <Card>
          <CardHeader>
            <CardTitle>{t('stations')}</CardTitle>
            <p className="mt-1 text-sm leading-relaxed text-muted">{t('stationStatusHint', { active: activeStations, total: workspace.stations.length })}</p>
          </CardHeader>
          <CardContent>
            {workspace.stations.length === 0 ? (
              <EmptyState
                icon={Fuel}
                surface="bare"
                title={t('noStations')}
                className="rounded border border-dashed border-border"
                action={
                  <Button asChild size="sm" variant="outline">
                    <Link href="/fuel-stations/master-data">
                      {t('quickStations')}
                      <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" strokeWidth={1.7} />
                    </Link>
                  </Button>
                }
              />
            ) : (
              <div className="divide-y divide-border rounded border border-border">
                {workspace.stations.map((station) => {
                  const devices = summary.devices.filter((device) => device.fuel_station_id === station.id);
                  const degraded = devices.filter((device) => device.health === 'degraded' || device.health === 'offline' || device.sync_status === 'failed').length;
                  const shift = latestShiftByStation.get(station.id);
                  return (
                    <article key={station.id} className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="font-medium text-text">{station.name}</h2>
                          <Badge tone={stationTone[station.status] ?? 'neutral'}>{stationStatusLabel(t, station.status)}</Badge>
                        </div>
                        <p className="num mt-1 text-xs text-muted">{station.code}{station.timezone ? ` · ${station.timezone}` : ''}</p>
                        <p className="mt-2 text-xs leading-relaxed text-muted">
                          {shift ? t('latestShift', { status: shiftStatusLabel(t, shift.status), at: formatDate(shift.opened_at) }) : t('noRecentShift')}
                          {devices.length ? ` · ${degraded ? t('degradedDeviceCount', { count: degraded }) : t('devicesHealthy', { count: devices.length })}` : ''}
                        </p>
                      </div>
                      <Button asChild className="w-full md:w-auto" size="sm" variant="outline"><Link href="/fuel-stations/master-data" className="w-full md:w-auto">
                          {t('viewStation')}
                          <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" strokeWidth={1.7} />
                        </Link></Button>
                    </article>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('quickActions')}</CardTitle>
            <p className="mt-1 text-sm leading-relaxed text-muted">{t('quickActionsHint')}</p>
          </CardHeader>
          <CardContent>
            {quickActions.length ? (
              <div className="flex flex-col gap-2">
                {quickActions.map((action, index) => (
                  <Button asChild key={action.href} className="w-full justify-between" variant={index === 0 ? 'primary' : 'outline'}><Link href={action.href}>
                      {action.label}
                      <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" strokeWidth={1.7} />
                    </Link></Button>
                ))}
              </div>
            ) : <p className="rounded border border-dashed border-border px-4 py-8 text-center text-sm text-muted">{t('noQuickActions')}</p>}
          </CardContent>
        </Card>
      </section>

      <p className="rounded border border-border bg-primary-soft px-4 py-3 text-sm leading-relaxed text-text">{t('operationalNotice')}</p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className="truncate text-xs text-muted" title={label}>{label}</p>
        <p className="num mt-2 break-words text-base font-semibold leading-tight text-text sm:text-xl">{value}</p>
      </CardContent>
    </Card>
  );
}

function stationStatusLabel(t: ReturnType<typeof useTranslations>, status: string) {
  const key = status === 'active' ? 'statusActive' : status === 'maintenance' ? 'statusMaintenance' : status === 'inactive' ? 'statusInactive' : 'statusUnknown';
  return t(key);
}

function shiftStatusLabel(t: ReturnType<typeof useTranslations>, status: string) {
  const key = status === 'open' ? 'shiftOpen' : status === 'closed' ? 'shiftClosed' : status === 'approved' ? 'shiftApproved' : 'statusUnknown';
  return t(key);
}

function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat(DISPLAY_LOCALE, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
}
