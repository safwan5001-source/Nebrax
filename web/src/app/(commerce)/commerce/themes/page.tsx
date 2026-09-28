'use client';

import Link from 'next/link';
import { useLocale } from 'next-intl';
import { Check, ExternalLink, Palette } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/nebrax';
import { commerceWorkspaceMessage, type CommerceWorkspaceMessageKey } from '@/modules/commerce-workspace/messages';
import { useCommerceStoreContext } from '@/modules/commerce-workspace/store-context';
import { THEME_REGISTRY, isRuntimeBackedTheme, type ThemeRegistryEntry } from '@/modules/commerce-workspace/theme-registry';

export default function CommerceThemesPage() {
  const locale = useLocale();
  const t = (key: CommerceWorkspaceMessageKey) => commerceWorkspaceMessage(locale, key);
  const { viewStoreUrl } = useCommerceStoreContext();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t('title')}
        title={t('themeGallery')}
        description={t('themeGalleryDescription')}
      />

      <section className="grid gap-5 xl:grid-cols-2">
        {THEME_REGISTRY.map((theme) => (
          <ThemeCard key={theme.id} theme={theme} viewStoreUrl={viewStoreUrl} t={t} />
        ))}
      </section>
    </div>
  );
}

function ThemeCard({
  theme,
  viewStoreUrl,
  t,
}: {
  theme: ThemeRegistryEntry;
  viewStoreUrl: string | null;
  t: (key: CommerceWorkspaceMessageKey) => string;
}) {
  const available = isRuntimeBackedTheme(theme);

  return (
    <article className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <div className="grid min-h-[320px] md:grid-cols-[minmax(0,1.12fr)_minmax(260px,0.88fr)]">
        <div className="border-b border-border bg-background p-4 md:border-b-0 md:border-e">
          <ThemePreview variant={theme.category} muted={!available} />
        </div>

        <div className="flex flex-col p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={available ? 'positive' : 'muted'}>
              <span className="inline-flex items-center gap-1">
                {available ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Palette className="h-3.5 w-3.5" aria-hidden />}
                {available ? t('themeGalleryAvailable') : t('themeGalleryPlanned')}
              </span>
            </Badge>
            {theme.official ? <Badge tone="neutral">{t('themeGalleryOfficial')}</Badge> : null}
          </div>

          <div className="mt-5">
            <h2 className="text-xl font-semibold text-text">
              {t(theme.nameKey as CommerceWorkspaceMessageKey)}
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted">
              {t(theme.descriptionKey as CommerceWorkspaceMessageKey)}
            </p>
          </div>

          {available ? (
            <div className="mt-auto flex flex-wrap gap-2 pt-6">
              <Link
                href="/commerce/appearance"
                className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                {t('themeGalleryCustomize')}
              </Link>

              {viewStoreUrl ? (
                <a
                  href={viewStoreUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-border bg-surface px-4 text-sm font-medium text-text hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  {t('themeGalleryPreview')}
                  <ExternalLink className="h-4 w-4" aria-hidden />
                </a>
              ) : (
                <span className="inline-flex min-h-11 items-center text-xs text-muted">
                  {t('themeGalleryPreviewUnavailable')}
                </span>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function ThemePreview({
  variant,
  muted,
}: {
  variant: ThemeRegistryEntry['category'];
  muted: boolean;
}) {
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
          <div className="h-5 w-20 rounded bg-primary/90" />
          <div className="flex gap-2">
            <div className="h-3 w-12 rounded bg-muted/60" />
            <div className="h-3 w-12 rounded bg-muted/60" />
            <div className="h-3 w-12 rounded bg-muted/60" />
          </div>
        </div>
      </div>
      <div className="p-4">
        <div className="grid min-h-28 place-items-center rounded-lg bg-primary-soft px-6 text-center">
          <div className="space-y-2">
            <div className="mx-auto h-4 w-32 rounded bg-primary/75" />
            <div className="mx-auto h-2.5 w-44 rounded bg-primary/20" />
            <div className="mx-auto h-7 w-20 rounded bg-primary" />
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
