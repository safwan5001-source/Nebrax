'use client';

import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { ShieldCheck, Smartphone } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState, PageHeader, type PageAction } from '@/components/nebrax';
import { api, ApiError } from '@/lib/api';
import { currentUser } from '@/lib/auth';
import { appDisplayName, hasAppBuilderPermission, type BuilderApp } from '@/lib/app-builder';
import { formatDate } from '@/lib/formatting';

/**
 * APP-BUILDER-4 — قائمة تطبيقات AWJ App Builder (App Manager). صلاحية
 * `apps_builder.view`؛ الإنشاء يقود إلى `/app-builder/new` (مسار منفصل، لا
 * حوار مدمج — انظر `APP-BUILDER-4-UX-EVIDENCE-PASS.md`).
 */
export default function AppBuilderPage() {
  const t = useTranslations('appBuilder');
  const tc = useTranslations('common');
  const locale = useLocale();
  const user = currentUser();
  const canView = hasAppBuilderPermission(user, 'apps_builder.view');

  const [apps, setApps] = useState<BuilderApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    api<{ data: BuilderApp[] }>('/app-builder/apps')
      .then((res) => setApps(res.data))
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : t('loadFailed')))
      .finally(() => setLoading(false));
  }, [t]);

  useEffect(() => {
    if (canView) load();
    else setLoading(false);
  }, [canView, load]);

  const headerActions: PageAction[] = [
    { key: 'create', label: t('createAction'), href: '/app-builder/new', variant: 'primary' },
  ];

  if (!canView) {
    return (
      <div className="space-y-5">
        <PageHeader title={t('title')} />
        <Card>
          <CardContent className="flex items-center gap-3 py-8 text-sm text-muted">
            <ShieldCheck className="h-5 w-5 shrink-0" strokeWidth={1.7} aria-hidden="true" />
            {t('noAccess')}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title={t('title')} description={t('subtitle')} actions={headerActions} />

      {loading ? (
        <LoadingState variant="cards" rows={3} label={tc('loading')} />
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={load} retryLabel={tc('retry')} />
      ) : apps.length === 0 ? (
        <EmptyState
          icon={Smartphone}
          title={t('emptyTitle')}
          description={t('emptyDescription')}
          action={
            <Button asChild>
              <Link href="/app-builder/new">{t('createAction')}</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {apps.map((app) => (
            <Link key={app.id} href={`/app-builder/${app.id}`} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded">
              <Card className="h-full transition-colors hover:border-primary">
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-center gap-2">
                    <Smartphone className="h-5 w-5 shrink-0 text-primary" strokeWidth={1.7} aria-hidden="true" />
                    <h3 className="min-w-0 truncate font-medium text-text">{appDisplayName(app, locale)}</h3>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="muted">{t(`creationSource.${app.creation_source}`)}</Badge>
                    {app.latest_published_version ? (
                      <Badge tone="positive">{t('latestVersion', { version: app.latest_published_version })}</Badge>
                    ) : (
                      <Badge tone="warning">{t('unpublished')}</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted">
                    {t('createdAt', { date: formatDate(app.created_at, locale) })}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
