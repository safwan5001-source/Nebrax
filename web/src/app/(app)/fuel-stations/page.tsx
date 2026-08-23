'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CircleAlert, Fuel, Gauge, Settings2, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api, ApiError } from '@/lib/api';

type Station = {
  id: string;
  branch_id: string | null;
  code: string;
  name: string;
  status: string;
  timezone: string | null;
  operating_day_starts_at: string | null;
};

type Workspace = {
  application_key: string;
  workspace_status: 'foundation_ready';
  settings: Record<string, unknown>;
  stations: Station[];
  deferred_capabilities: string[];
};

export default function FuelStationsWorkspacePage() {
  const t = useTranslations('fuelStations');
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    api<{ data: Workspace }>('/fuel-stations/workspace')
      .then((response) => setWorkspace(response.data))
      .catch((error) => setLoadError(error instanceof ApiError ? error.message : t('loadFailed')))
      .finally(() => setLoading(false));
  }, [t]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <div className="space-y-5" aria-busy="true">{[0, 1, 2].map((item) => <div key={item} className="h-32 animate-pulse rounded-md bg-muted" />)}</div>;
  }

  if (loadError || !workspace) {
    return (
      <Card>
        <CardContent className="flex flex-col items-start gap-3 py-10">
          <CircleAlert className="h-6 w-6 text-negative" strokeWidth={1.7} />
          <p role="alert" className="text-sm text-negative">{loadError ?? t('loadFailed')}</p>
          <Button variant="outline" onClick={load}>{t('retry')}</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <header className="max-w-4xl">
        <p className="text-xs font-semibold tracking-wide text-primary">{t('eyebrow')}</p>
        <h1 className="mt-1 text-xl font-semibold text-text">{t('title')}</h1>
        <p className="mt-1 text-sm leading-relaxed text-muted">{t('subtitle')}</p>
      </header>

      <section className="grid gap-3 md:grid-cols-3" aria-label={t('status')}>
        <Card>
          <CardContent className="flex items-start gap-3 py-4">
            <span className="rounded-md bg-primary/10 p-2 text-primary"><Fuel className="h-5 w-5" strokeWidth={1.7} /></span>
            <div><p className="text-xs text-muted">{t('status')}</p><div className="mt-1"><Badge tone="positive">{t('foundationReady')}</Badge></div></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-start gap-3 py-4">
            <span className="rounded-md bg-primary/10 p-2 text-primary"><Gauge className="h-5 w-5" strokeWidth={1.7} /></span>
            <div><p className="text-xs text-muted">{t('stations')}</p><p className="mt-1 text-2xl font-semibold text-text">{workspace.stations.length}</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-start gap-3 py-4">
            <span className="rounded-md bg-primary/10 p-2 text-primary"><ShieldCheck className="h-5 w-5" strokeWidth={1.7} /></span>
            <p className="text-xs leading-relaxed text-muted">{t('commercialGuard')}</p>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.85fr)]">
        <Card>
          <CardHeader><CardTitle>{t('stations')}</CardTitle><p className="mt-1 text-sm leading-relaxed text-muted">{t('stationsHint')}</p></CardHeader>
          <CardContent>
            {workspace.stations.length === 0 ? <p className="rounded-md border border-dashed border-border px-4 py-9 text-center text-sm text-muted">{t('noStations')}</p> : (
              <div className="divide-y divide-border rounded-md border border-border">
                {workspace.stations.map((station) => <div key={station.id} className="flex items-center justify-between gap-4 px-4 py-3"><div><p className="font-medium text-text">{station.name}</p><p className="mt-1 text-xs text-muted">{station.code}</p></div><Badge tone={station.status === 'active' ? 'positive' : 'muted'}>{station.status}</Badge></div>)}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader><div className="flex items-center gap-2"><Settings2 className="h-4 w-4 text-primary" strokeWidth={1.7} /><CardTitle>{t('settings')}</CardTitle></div></CardHeader>
            <CardContent><dl className="space-y-2 text-sm">{Object.entries(workspace.settings).map(([key, value]) => <div key={key} className="flex items-center justify-between gap-4 border-b border-border/70 pb-2 last:border-0 last:pb-0"><dt className="text-muted">{key}</dt><dd className="max-w-[13rem] truncate font-medium text-text" title={String(value)}>{String(value)}</dd></div>)}</dl></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>{t('deferred')}</CardTitle><p className="mt-1 text-sm leading-relaxed text-muted">{t('deferredHint')}</p></CardHeader>
            <CardContent><div className="flex flex-wrap gap-2">{workspace.deferred_capabilities.map((capability) => <Badge key={capability} tone="muted">{capability}</Badge>)}</div></CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
