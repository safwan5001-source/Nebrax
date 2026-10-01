'use client';

import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Layers, PenSquare, Smartphone, Ban } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { SecretRevealDialog } from '@/components/developer/secret-reveal';
import { DetailPage, ErrorState, LoadingState, type PageAction } from '@/components/nebrax';
import { api, ApiError } from '@/lib/api';
import { appDisplayName, type BuilderApp, type BuilderPublishedVersion, type PreviewSession } from '@/lib/app-builder';
import { formatDate } from '@/lib/formatting';
import { PreviewOnPhoneButton } from '@/modules/app-builder/preview-on-phone';

/**
 * APP-BUILDER-4/5 — نظرة عامة على التطبيق. «فتح مساحة التحرير» يقود إلى
 * `/app-builder/[id]/builder` (هيكل مساحة العمل — APP-BUILDER-5؛ التحرير
 * الفعلي APP-BUILDER-6).
 *
 * MOBILE-PREVIEW-6 — قسم «جلسات المعاينة على الجهاز»: إصدار/إبطال جلسة
 * `PreviewSession` حقيقية تستهلكها نسخة أَوْج الجوّالة (بيئة معاينة، انظر
 * `mobile/lib/main_preview.dart`). النصّ الخام يُعرض مرّة واحدة فقط عبر
 * `SecretRevealDialog` (نفس مكوّن عرض أسرار مفاتيح Developer API) ولا يُخزَّن
 * في حالة هذه الصفحة بعد إغلاق الحوار.
 *
 * MOBILE-PREVIEW-7 — «معاينة على الهاتف» (QR): يطلب مرجع تبادل لمرّة واحدة
 * (`POST .../preview-exchange-references`) ويعرضه كرمز QR ورابطٍ قابل
 * للنسخ. **لا بصمة عمل تُعرض هنا إطلاقاً** — المرجع الخام مختلفٌ عمداً عن
 * توكن جلسة المعاينة نفسه، ولا يصلح لشيء غير استهلاكٍ واحد عبر
 * `POST /preview/v1/exchange` من الجهاز. عدّاد الانتهاء (٥ دقائق) والتجديد
 * والحالة المنتهية محلّية بالكامل؛ رصد «تم الاتصال» أفضل-جهدٍ فقط (استطلاع
 * قائمة الجلسات القائمة أصلاً — بلا مسار API جديد لغرضه وحده).
 */
export default function AppBuilderDetailPage() {
  const t = useTranslations('appBuilder.detail');
  const tp = useTranslations('appBuilder.detail.previewSessions');
  const tRoot = useTranslations('appBuilder');
  const tc = useTranslations('common');
  const toast = useToast();
  const locale = useLocale();
  const params = useParams<{ id: string }>();

  const [app, setApp] = useState<BuilderApp | null>(null);
  const [versions, setVersions] = useState<BuilderPublishedVersion[]>([]);
  const [previewSessions, setPreviewSessions] = useState<PreviewSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [issuing, setIssuing] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<PreviewSession | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [issuedToken, setIssuedToken] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!params.id) return;
    setLoading(true);
    setLoadError(null);
    Promise.all([
      api<{ data: BuilderApp }>(`/app-builder/apps/${params.id}`),
      api<{ data: BuilderPublishedVersion[] }>(`/app-builder/apps/${params.id}/versions`),
      api<{ data: PreviewSession[] }>(`/app-builder/apps/${params.id}/preview-sessions`),
    ])
      .then(([appRes, versionsRes, previewRes]) => {
        setApp(appRes.data);
        setVersions(versionsRes.data);
        setPreviewSessions(previewRes.data);
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : t('loadFailed')))
      .finally(() => setLoading(false));
  }, [params.id, t]);

  const reloadPreviewSessions = useCallback(() => {
    if (!params.id) return;
    api<{ data: PreviewSession[] }>(`/app-builder/apps/${params.id}/preview-sessions`)
      .then((res) => setPreviewSessions(res.data))
      .catch((err) => toast.error(tp('loadErrorTitle'), err instanceof ApiError ? err.message : undefined));
  }, [params.id, toast, tp]);

  useEffect(() => load(), [load]);

  async function issuePreviewSession() {
    if (!params.id) return;
    setIssuing(true);
    try {
      const res = await api<{ token: string; session: PreviewSession }>(
        `/app-builder/apps/${params.id}/preview-sessions`,
        { method: 'POST', body: {} },
      );
      setIssuedToken(res.token);
      toast.success(tp('issueSuccessTitle'));
      reloadPreviewSessions();
    } catch (err) {
      toast.error(tp('issueErrorTitle'), err instanceof ApiError ? err.message : undefined);
    } finally {
      setIssuing(false);
    }
  }

  async function confirmRevoke() {
    if (!params.id || !revokeTarget) return;
    setRevoking(true);
    try {
      await api(`/app-builder/apps/${params.id}/preview-sessions/${revokeTarget.id}`, { method: 'DELETE' });
      setRevokeTarget(null);
      reloadPreviewSessions();
    } catch (err) {
      toast.error(tp('revokeErrorTitle'), err instanceof ApiError ? err.message : undefined);
    } finally {
      setRevoking(false);
    }
  }

  if (loading) return <LoadingState rows={6} label={tc('loading')} />;
  if (!app) return <ErrorState message={loadError ?? t('loadFailed')} onRetry={load} retryLabel={tc('retry')} />;

  function previewSessionStatus(session: PreviewSession): { label: string; tone: 'positive' | 'warning' | 'negative' } {
    if (session.revoked_at) return { label: tp('statusRevoked'), tone: 'negative' };
    if (session.expires_at && new Date(session.expires_at).getTime() <= Date.now()) {
      return { label: tp('statusExpired'), tone: 'warning' };
    }
    return { label: tp('statusActive'), tone: 'positive' };
  }

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

  const previewSessionsContent = (
    <div className="space-y-3">
      {previewSessions.length === 0 ? (
        <p className="py-5 text-center text-sm text-muted">{tp('empty')}</p>
      ) : (
        <div className="divide-y divide-border rounded-md border border-border">
          {previewSessions.map((session) => {
            const status = previewSessionStatus(session);
            const active = status.tone === 'positive';
            return (
              <div key={session.id} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-2">
                  <Badge tone={status.tone}>{status.label}</Badge>
                  <span className="truncate text-sm text-text">
                    {session.expires_at ? tp('expiresLabel', { date: formatDate(session.expires_at, locale) }) : '—'}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!active}
                  className="shrink-0"
                  onClick={() => setRevokeTarget(session)}
                >
                  <Ban className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
                  {tp('revokeAction')}
                </Button>
              </div>
            );
          })}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <PreviewOnPhoneButton appId={app.id} onConsumed={reloadPreviewSessions} />
        <Button type="button" variant="outline" size="sm" disabled={issuing} onClick={() => void issuePreviewSession()}>
          <Smartphone className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
          {issuing ? tp('issuing') : tp('issueAction')}
        </Button>
      </div>
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
        { id: 'preview-sessions', title: tp('title'), count: previewSessions.length, content: previewSessionsContent },
      ]}
    >
      <div className="flex items-center gap-2 text-xs text-muted">
        <Layers className="h-4 w-4 shrink-0" strokeWidth={1.6} aria-hidden="true" />
        <span>{app.id}</span>
      </div>

      <SecretRevealDialog
        open={issuedToken !== null}
        onClose={() => setIssuedToken(null)}
        title={tp('tokenDialogTitle')}
        description={tp('tokenDialogDescription')}
        secret={issuedToken ?? ''}
      />

      <Dialog
        open={revokeTarget !== null}
        onClose={() => (revoking ? null : setRevokeTarget(null))}
        title={tp('revokeConfirmTitle')}
      >
        <p className="text-sm leading-6 text-text">{tp('revokeConfirmBody')}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" disabled={revoking} onClick={() => setRevokeTarget(null)}>{tc('cancel')}</Button>
          <Button disabled={revoking} onClick={confirmRevoke}>
            {revoking ? tp('revoking') : tp('revokeAction')}
          </Button>
        </div>
      </Dialog>
    </DetailPage>
  );
}
