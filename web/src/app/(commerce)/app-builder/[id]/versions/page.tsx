'use client';

import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowRight, History } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { ErrorState, LoadingState } from '@/components/nebrax';
import { api, ApiError } from '@/lib/api';
import { appDisplayName, type BuilderApp, type BuilderPublishedVersion } from '@/lib/app-builder';
import { formatDate } from '@/lib/formatting';

/**
 * APP-BUILDER-10 — القائمة الكاملة للنسخ المنشورة + «استعادة كمسودة». الاستعادة
 * تكتب `PUT .../draft` بمخطط النسخة التاريخية ثم تنقل لمساحة الباني — لا نشر
 * تلقائي؛ التاجر يراجع وينشر صراحة من نفس مسار Validate/Publish القائم، تماماً
 * كأي تعديل آخر (انظر `APP-BUILDER-10-UX-EVIDENCE-PASS.md`).
 */
export default function AppBuilderVersionsPage() {
  const t = useTranslations('appBuilder.versions');
  const td = useTranslations('appBuilder.detail');
  const tc = useTranslations('common');
  const toast = useToast();
  const locale = useLocale();
  const router = useRouter();
  const params = useParams<{ id: string }>();

  const [app, setApp] = useState<BuilderApp | null>(null);
  const [versions, setVersions] = useState<BuilderPublishedVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<BuilderPublishedVersion | null>(null);
  const [restoring, setRestoring] = useState(false);

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

  async function confirmRestore() {
    if (!restoreTarget || !params.id) return;
    setRestoring(true);
    try {
      // النسخة الكاملة (`schema`) غير موجودة في استجابة القائمة — تُجلب صراحة هنا.
      const full = await api<{ data: BuilderPublishedVersion }>(`/app-builder/apps/${params.id}/versions/${restoreTarget.version}`);
      await api(`/app-builder/apps/${params.id}/draft`, { method: 'PUT', body: { schema: full.data.schema } });
      toast.success(t('restoreSuccessTitle'));
      router.push(`/app-builder/${params.id}/builder`);
    } catch (err) {
      toast.error(t('restoreErrorTitle'), err instanceof ApiError ? err.message : undefined);
      setRestoring(false);
    }
  }

  if (loading) return <LoadingState rows={6} label={tc('loading')} />;
  if (!app) return <ErrorState message={loadError ?? t('loadFailed')} onRetry={load} retryLabel={tc('retry')} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" aria-label={td('back')}>
          <Link href={`/app-builder/${app.id}`}>
            <ArrowRight className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
          </Link>
        </Button>
        <div>
          <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
          <p className="text-sm text-muted">{appDisplayName(app, locale)}</p>
        </div>
      </div>

      {versions.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">{t('empty')}</p>
      ) : (
        <div className="divide-y divide-border rounded-md border border-border bg-surface">
          {versions.map((version) => (
            <div key={version.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-text">{t('versionLabel', { version: version.version })}</span>
                  <Badge tone="muted">{version.published_at ? formatDate(version.published_at, locale) : '—'}</Badge>
                </div>
                <p className="text-xs text-muted">
                  {version.published_by_name ? t('publishedByLabel', { name: version.published_by_name }) : null}
                </p>
                <p className="text-sm text-text">{version.note || <span className="text-muted">{t('noNote')}</span>}</p>
              </div>
              <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => setRestoreTarget(version)}>
                <History className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
                {t('restoreAction')}
              </Button>
            </div>
          ))}
        </div>
      )}

      <Dialog
        open={restoreTarget !== null}
        onClose={() => (restoring ? null : setRestoreTarget(null))}
        title={t('restoreConfirmTitle')}
      >
        <p className="text-sm leading-6 text-text">
          {restoreTarget ? t('restoreConfirmBody', { version: restoreTarget.version }) : null}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" disabled={restoring} onClick={() => setRestoreTarget(null)}>{tc('cancel')}</Button>
          <Button disabled={restoring} onClick={confirmRestore}>
            {restoring ? t('restoring') : t('restoreAction')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
