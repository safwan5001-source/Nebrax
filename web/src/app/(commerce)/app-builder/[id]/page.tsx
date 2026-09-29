'use client';

import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Layers, PenSquare } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { DetailPage, ErrorState, LoadingState, type PageAction } from '@/components/nebrax';
import { api, ApiError } from '@/lib/api';
import { appDisplayName, type BuilderApp, type BuilderPublishedVersion } from '@/lib/app-builder';
import { formatDate } from '@/lib/formatting';

/**
 * APP-BUILDER-4/5 — نظرة عامة على التطبيق. «فتح مساحة التحرير» يقود إلى
 * `/app-builder/[id]/builder` (هيكل مساحة العمل — APP-BUILDER-5؛ التحرير
 * الفعلي APP-BUILDER-6).
 */
export default function AppBuilderDetailPage() {
  const t = useTranslations('appBuilder.detail');
  const tRoot = useTranslations('appBuilder');
  const tc = useTranslations('common');
  const locale = useLocale();
  const params = useParams<{ id: string }>();

  const [app, setApp] = useState<BuilderApp | null>(null);
  const [versions, setVersions] = useState<BuilderPublishedVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!params.id) return;
    setLoading(true);
    setLoadError(null);
    Promise.all([
      api<{ data: BuilderApp }>(`/app-builder/apps/${params.id}`),
      api<{ data: BuilderPublishedVersion[] }>(`/app-builder/apps/${params.id}/versions`),
    ])
      .then(([appRes, versionsRes]) => {
        setApp(appRes.data);
        setVersions(versionsRes.data);
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : t('loadFailed')))
      .finally(() => setLoading(false));
  }, [params.id, t]);

  useEffect(() => load(), [load]);

  if (loading) return <LoadingState rows={6} label={tc('loading')} />;
  if (!app) return <ErrorState message={loadError ?? t('loadFailed')} onRetry={load} retryLabel={tc('retry')} />;

  const versionsContent = (
    <div className="space-y-3">
      {versions.length === 0 ? (
        <p className="py-5 text-center text-sm text-muted">{t('versionsEmpty')}</p>
      ) : (
        <div className="divide-y divide-border rounded-md border border-border">
          {versions.slice(0, 3).map((version) => (
            <div key={version.id} className="flex items-center justify-between gap-3 px-3 py-3">
              <span className="text-sm text-text">
                {t('versionRow', {
                  version: version.version,
                  date: version.published_at ? formatDate(version.published_at, locale) : '—',
                })}
              </span>
            </div>
          ))}
        </div>
      )}
      <Link href={`/app-builder/${app.id}/versions`} className="block text-sm font-medium text-primary hover:underline">
        {t('viewAllVersions')}
      </Link>
    </div>
  );

  const actions: PageAction[] = [
    { key: 'open-builder', label: t('openBuilder'), icon: PenSquare, href: `/app-builder/${app.id}/builder`, variant: 'primary' },
  ];

  return (
    <DetailPage
      backHref="/app-builder"
      backLabel={t('back')}
      title={appDisplayName(app, locale)}
      badges={<Badge tone="muted">{tRoot(`creationSource.${app.creation_source}`)}</Badge>}
      meta={`${t('createdLabel')}: ${formatDate(app.created_at, locale)}`}
      actions={actions}
      sections={[
        { id: 'versions', title: t('versionsTitle'), count: versions.length, content: versionsContent },
      ]}
    >
      <div className="flex items-center gap-2 text-xs text-muted">
        <Layers className="h-4 w-4 shrink-0" strokeWidth={1.6} aria-hidden="true" />
        <span>{app.id}</span>
      </div>
    </DetailPage>
  );
}
