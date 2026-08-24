'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowRight, CircleAlert, Fuel, Gauge, MapPin, Wrench } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api, ApiError } from '@/lib/api';

type Station = { id: string; branch_id: string | null; code: string; name: string; status: string; timezone: string | null; operating_day_starts_at: string | null };
type Workspace = { stations: Station[] };

type WorkspaceLink = { href: string; label: string; primary?: boolean };

export default function FuelStationsWorkspacePage() {
  const t = useTranslations('fuelStations');
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true); setLoadError(null);
    api<{ data: Workspace }>('/fuel-stations/workspace')
      .then((response) => setWorkspace(response.data))
      .catch((error) => setLoadError(error instanceof ApiError ? error.message : t('loadFailed')))
      .finally(() => setLoading(false));
  }, [t]);

  useEffect(() => { load(); }, [load]);
  const activeStations = useMemo(() => workspace?.stations.filter((station) => station.status === 'active').length ?? 0, [workspace]);
  const links: WorkspaceLink[] = [
    { href: '/fuel-stations/sales', label: t('manageSales'), primary: true },
    { href: '/fuel-stations/shifts', label: t('manageShifts') },
    { href: '/fuel-stations/receiving', label: t('manageReceiving') },
    { href: '/fuel-stations/master-data', label: t('manageMasterData') },
    { href: '/fuel-stations/corporate-contracts', label: t('manageCorporate') },
    { href: '/fuel-stations/avi-rfid', label: t('manageAvi') },
  ];

  if (loading) return <div className="space-y-5" aria-busy="true">{[0, 1, 2].map((item) => <div key={item} className="h-32 animate-pulse rounded-md bg-muted" />)}</div>;
  if (loadError || !workspace) return <Card><CardContent className="flex flex-col items-start gap-3 py-10"><CircleAlert className="h-6 w-6 text-negative" strokeWidth={1.7} /><p role="alert" className="text-sm text-negative">{loadError ?? t('loadFailed')}</p><Button variant="outline" onClick={load}>{t('retry')}</Button></CardContent></Card>;

  return <div className="space-y-5">
    <header className="max-w-4xl"><p className="text-xs font-semibold tracking-wide text-primary">{t('eyebrow')}</p><h1 className="mt-1 text-xl font-semibold text-text">{t('title')}</h1><p className="mt-1 text-sm leading-relaxed text-muted">{t('subtitle')}</p></header>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label={t('operationalSummary')}><Metric icon={<MapPin />} label={t('stations')} value={String(workspace.stations.length)} /><Metric icon={<Fuel />} label={t('activeStations')} value={String(activeStations)} /><Metric icon={<Gauge />} label={t('workspaces')} value={String(links.length)} /></section>
    <p role="note" className="rounded-md border border-border bg-primary-soft px-3 py-2 text-sm leading-relaxed text-text">{t('operationalNotice')}</p>
    <section className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(18rem,0.75fr)]">
      <Card><CardHeader><CardTitle>{t('stations')}</CardTitle><p className="mt-1 text-sm leading-relaxed text-muted">{t('stationsHint')}</p></CardHeader><CardContent>{workspace.stations.length === 0 ? <div className="rounded-md border border-dashed border-border px-4 py-9 text-center"><p className="text-sm text-muted">{t('noStations')}</p><Link className="mt-3 inline-flex" href="/fuel-stations/master-data"><Button size="sm" variant="outline">{t('manageMasterData')}<ArrowRight className="h-3.5 w-3.5" /></Button></Link></div> : <div className="divide-y divide-border rounded-md border border-border">{workspace.stations.map((station) => <div key={station.id} className="flex items-center justify-between gap-4 px-4 py-3"><div><p className="font-medium text-text">{station.name}</p><p className="mt-1 text-xs text-muted">{station.code}{station.timezone ? ` · ${station.timezone}` : ''}</p></div><Badge tone={station.status === 'active' ? 'positive' : station.status === 'maintenance' ? 'warning' : 'muted'}>{station.status === 'active' ? t('statusActive') : station.status === 'maintenance' ? t('statusMaintenance') : t('statusInactive')}</Badge></div>)}</div>}</CardContent></Card>
      <Card><CardHeader><div className="flex items-center gap-2"><Wrench className="h-4 w-4 text-primary" strokeWidth={1.7} /><CardTitle>{t('operationalWorkspaces')}</CardTitle></div><p className="mt-1 text-sm leading-relaxed text-muted">{t('operationalWorkspacesHint')}</p></CardHeader><CardContent><div className="flex flex-col gap-2">{links.map((link) => <Link key={link.href} href={link.href}><Button className="w-full justify-between" variant={link.primary ? 'primary' : 'outline'}>{link.label}<ArrowRight className="h-3.5 w-3.5" /></Button></Link>)}</div></CardContent></Card>
    </section>
  </div>;
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <Card><CardContent className="flex items-start gap-3 py-4"><span className="rounded-md bg-primary/10 p-2 text-primary">{icon}</span><div><p className="text-xs text-muted">{label}</p><p className="num mt-1 text-2xl font-semibold text-text">{value}</p></div></CardContent></Card>; }
