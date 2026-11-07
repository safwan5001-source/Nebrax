'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowLeft, ChevronLeft, Clock } from 'lucide-react';
import { getFuelHelpArticle, getFuelHelpCategory, helpLocale } from '@/modules/help-center/fuel';
import { AudienceBadges, FuelHelpArticleBody, type FuelHelpSurface } from './fuel-help-article-body';
import { FuelHelpGuidePlayer } from './fuel-help-guide-player';

/** صفحة دليل كاملة: الجسم المشترك + الدليل التفاعلي + أدلة ذات صلة. `basePath` أساس المركز في السطح الحالي. */
export function FuelHelpArticleView({ slug, basePath, surface, titleAs: Title = 'h1' }: { slug: string; basePath: string; surface: FuelHelpSurface; /** يملك التطبيق h1 في رأسه الكحلي فيُعرض عنوان الدليل h2 (h1 واحد لكل شاشة). */ titleAs?: 'h1' | 'h2' }) {
  const t = useTranslations('fuelHelp');
  const common = useTranslations('helpCenter');
  const locale = helpLocale(useLocale());
  const [guide, setGuide] = useState<number | null>(null);
  const article = getFuelHelpArticle(slug);

  if (!article) {
    return (
      <div className="rounded-[14px] border border-border bg-surface px-4 py-12 text-center">
        <h2 className="text-lg font-semibold text-text">{t('articleNotFound')}</h2>
        <p className="mt-1 text-sm text-muted">{t('articleNotFoundHint')}</p>
        <Link href={basePath} className="mt-4 inline-flex min-h-12 items-center rounded-[12px] border border-border px-4 text-sm font-semibold text-text hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
          {t('backToHelp')}
        </Link>
      </div>
    );
  }

  const category = getFuelHelpCategory(article.category);
  const related = (article.related ?? []).map((value) => getFuelHelpArticle(value)).filter((value) => value !== undefined);

  return (
    <div className="space-y-5">
      <nav aria-label={t('breadcrumb')} className="flex flex-wrap items-center gap-1 text-xs text-muted">
        <Link href={basePath} className="inline-flex min-h-8 items-center rounded hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">{t('title')}</Link>
        <ChevronLeft aria-hidden="true" className="h-3.5 w-3.5 ltr:rotate-180" strokeWidth={1.7} />
        <span>{category.title[locale]}</span>
      </nav>

      <article className="overflow-hidden rounded-[16px] border border-border bg-surface">
        <header className="space-y-2 border-b border-border p-4 sm:p-6">
          <p className="text-xs font-semibold text-primary">{category.title[locale]}</p>
          <Title className="text-xl font-semibold leading-8 text-text">{article.title[locale]}</Title>
          <p className="text-sm leading-6 text-muted">{article.summary[locale]}</p>
          <div className="flex flex-wrap items-center gap-3">
            <AudienceBadges article={article} locale={locale} />
            <span className="flex items-center gap-1.5 text-xs text-muted">
              <Clock aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.7} />{common('readingTime', { minutes: article.minutes })}
            </span>
          </div>
        </header>

        <div className="space-y-6 p-4 sm:p-6">
          {guide !== null ? (
            <FuelHelpGuidePlayer key={guide} procedure={article.procedures[guide]} locale={locale} onExit={() => setGuide(null)} />
          ) : null}
          <FuelHelpArticleBody article={article} locale={locale} surface={surface} onStartGuide={setGuide} />
        </div>
      </article>

      {related.length ? (
        <section aria-labelledby="fh-related-h" className="rounded-[14px] border border-border bg-surface p-4">
          <h2 id="fh-related-h" className="text-sm font-semibold text-text">{t('relatedTitle')}</h2>
          <ul className="mt-2 divide-y divide-border">
            {related.map((item) => (
              <li key={item.slug}>
                <Link href={`${basePath}/${item.slug}`} className="flex min-h-11 items-center gap-2 py-2 text-sm text-text hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                  <ChevronLeft aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted ltr:rotate-180" strokeWidth={1.7} />
                  <span>{item.title[locale]}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Link href={basePath} className="inline-flex min-h-12 items-center gap-2 rounded-[12px] border border-border bg-surface px-4 text-sm font-medium text-text hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
        <ArrowLeft aria-hidden="true" className="h-4 w-4 ltr:rotate-180" strokeWidth={1.7} />{t('backToHelp')}
      </Link>
    </div>
  );
}
