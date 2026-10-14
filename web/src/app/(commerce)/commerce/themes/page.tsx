'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { Check, ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/nebrax';
import { currentUser } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { commerceWorkspaceMessage, type CommerceWorkspaceMessageKey } from '@/modules/commerce-workspace/messages';
import { withStoreParam } from '@/modules/commerce-workspace/active-store';
import { useCommerceStoreContext } from '@/modules/commerce-workspace/store-context';
import { listPresentationVersions } from '@/modules/commerce-workspace/presentation-versions';
import { BUILT_IN_THEMES, previewBaseVersion, themePreviewHref, type ThemeDefinition } from '@/modules/store-experience-builder/themes';

export default function CommerceThemesPage() {
  const locale = useLocale() === 'en' ? 'en' : 'ar';
  const t = (key: CommerceWorkspaceMessageKey) => commerceWorkspaceMessage(locale, key);
  const { selectedStoreId, viewStoreUrl } = useCommerceStoreContext();
  const viewer = currentUser();
  const canManage = hasPermission(viewer?.permissions, viewer?.role, 'commerce.manage');
  // The preview link is offered only once the base version is KNOWN: still loading, or failed, is not "this store has no
  // versions" — a link without `version` would let the builder pick a draft (or none) instead of the Published Version.
  const [base, setBase] = useState<{ state: 'loading' | 'ready' | 'error'; versionId: string | null }>({
    state: 'loading',
    versionId: null,
  });
  const baseVersionId = base.versionId;

  useEffect(() => {
    let cancelled = false;
    setBase({ state: 'loading', versionId: null });
    if (!selectedStoreId) return;
    void listPresentationVersions(selectedStoreId).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setBase({ state: 'error', versionId: null });
        return;
      }
      setBase({ state: 'ready', versionId: previewBaseVersion(result.data)?.id ?? null });
    });
    return () => {
      cancelled = true;
    };
  }, [selectedStoreId]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t('title')}
        title={t('themeGallery')}
        description={t('themeGalleryDescription')}
        actionsSlot={
          // One honest link to the *published* store. Theme previews open in the builder, over the merchant's own data.
          viewStoreUrl ? (
            <a
              href={viewStoreUrl}
              target="_blank"
              rel="noreferrer"
              data-testid="theme-gallery-view-live"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-border bg-surface px-4 text-sm font-medium text-text hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {t('themeGalleryViewLive')}
              <ExternalLink className="h-4 w-4" aria-hidden />
            </a>
          ) : (
            <span className="inline-flex min-h-11 items-center text-xs text-muted">
              {t('themeGalleryViewLiveUnavailable')}
            </span>
          )
        }
      />

      <section className="grid gap-5 xl:grid-cols-2">
        {BUILT_IN_THEMES.map((theme) => (
          <ThemeCard
            key={theme.id}
            theme={theme}
            locale={locale}
            canPreview={Boolean(selectedStoreId) && canManage && base.state === 'ready'}
            baseState={selectedStoreId ? base.state : 'ready'}
            href={withStoreParam(themePreviewHref(theme.id, baseVersionId), selectedStoreId)}
            customizeHref={withStoreParam('/commerce/appearance', selectedStoreId)}
            t={t}
          />
        ))}
      </section>
    </div>
  );
}

function ThemeCard({
  theme,
  locale,
  canPreview,
  baseState,
  href,
  customizeHref,
  t,
}: {
  theme: ThemeDefinition;
  locale: 'ar' | 'en';
  canPreview: boolean;
  baseState: 'loading' | 'ready' | 'error';
  href: string;
  customizeHref: string;
  t: (key: CommerceWorkspaceMessageKey) => string;
}) {
  return (
    <article data-theme-card={theme.id} className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <div className="grid min-h-[320px] md:grid-cols-[minmax(0,1.12fr)_minmax(260px,0.88fr)]">
        <div className="border-b border-border bg-background p-4 md:border-b-0 md:border-e">
          <ThemePreview variant={theme.vertical} muted={false} primary={theme.primaryColor} />
        </div>

        <div className="flex flex-col p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="positive">
              <span className="inline-flex items-center gap-1">
                <Check className="h-3.5 w-3.5" aria-hidden />
                {t('themeGalleryAvailable')}
              </span>
            </Badge>
            <Badge tone="neutral">{t('themeGalleryOfficial')}</Badge>
          </div>

          <div className="mt-5">
            <h2 className="text-xl font-semibold text-text">
              <bdi>{theme.name[locale]}</bdi>
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted">{theme.description[locale]}</p>
          </div>

          <div className="mt-auto flex flex-wrap gap-2 pt-6">
            {canPreview ? (
              <Link
                href={href}
                data-theme-preview-link={theme.id}
                className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                {t('themeGalleryPreviewApply')}
              </Link>
            ) : (
              <span
                aria-disabled="true"
                data-theme-preview-disabled={baseState === 'ready' ? undefined : baseState}
                className="inline-flex min-h-11 cursor-not-allowed items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground opacity-50"
              >
                {t('themeGalleryPreviewApply')}
              </span>
            )}
            {baseState === 'error' ? (
              <p role="status" data-theme-base-error="" className="basis-full text-xs text-muted">
                {t('themeGalleryVersionsError')}
              </p>
            ) : null}
            <Link
              href={customizeHref}
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-surface px-4 text-sm font-medium text-text hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {t('themeGalleryCustomize')}
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}

function ThemePreview({
  variant,
  muted,
  primary,
}: {
  variant: ThemeDefinition['vertical'];
  muted: boolean;
  /** The preset's real primary color, so each card previews its own identity (not the admin app's). */
  primary: string | null;
}) {
  const tint = (percent: number) =>
    primary ? { backgroundColor: `color-mix(in srgb, ${primary} ${percent}%, transparent)` } : undefined;
  const cls = (fallback: string) => (primary ? '' : fallback);
  return (
    <div
      aria-hidden
      data-theme-preview={variant}
      className={`mx-auto h-full min-h-[286px] max-w-2xl overflow-hidden rounded-lg border border-border bg-surface shadow-sm ${muted ? 'opacity-70' : ''}`}
    >
      <div className="flex h-9 items-center gap-1.5 border-b border-border px-3">
        <span className="h-2 w-2 rounded-full bg-muted" />
        <span className="h-2 w-2 rounded-full bg-muted" />
        <span className="h-2 w-2 rounded-full bg-muted" />
      </div>
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className={`h-5 w-20 rounded ${cls('bg-primary/90')}`} style={tint(90)} />
          <div className="flex gap-2">
            <div className="h-3 w-12 rounded bg-muted/60" />
            <div className="h-3 w-12 rounded bg-muted/60" />
            <div className="h-3 w-12 rounded bg-muted/60" />
          </div>
        </div>
      </div>
      <div className="p-4">
        <div className={`grid min-h-28 place-items-center rounded-lg px-6 text-center ${cls('bg-primary-soft')}`} style={tint(12)}>
          <div className="space-y-2">
            <div className={`mx-auto h-4 w-32 rounded ${cls('bg-primary/75')}`} style={tint(75)} />
            <div className={`mx-auto h-2.5 w-44 rounded ${cls('bg-primary/20')}`} style={tint(20)} />
            <div className={`mx-auto h-7 w-20 rounded ${cls('bg-primary')}`} style={primary ? { backgroundColor: primary } : undefined} />
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3">
          {[0, 1, 2].map((item) => (
            <div key={item} className="rounded-md border border-border p-2">
              <div className="aspect-[4/3] rounded bg-muted/40" />
              <div className="mt-2 h-2.5 w-3/4 rounded bg-muted/70" />
              <div className="mt-1.5 h-2 w-1/2 rounded bg-muted/50" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
