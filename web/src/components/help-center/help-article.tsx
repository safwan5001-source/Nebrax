'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowLeft, ChevronLeft, CircleAlert, Clock, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getHelpArticle, getHelpCategory, HELP_ARTICLES, helpLocale } from '@/modules/help-center/content';

export function HelpArticle({ slug }: { slug: string }) {
  const t = useTranslations('helpCenter');
  const locale = helpLocale(useLocale());
  const article = getHelpArticle(slug);

  if (!article) {
    return (
      <div className="rounded border border-border bg-surface px-4 py-12 text-center">
        <h1 className="text-lg font-semibold text-text">{t('articleNotFound')}</h1>
        <p className="mt-1 text-sm text-muted">{t('articleNotFoundHint')}</p>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/help">{t('backToHelp')}</Link>
        </Button>
      </div>
    );
  }

  const category = getHelpCategory(article.category);
  const related = HELP_ARTICLES.filter((candidate) => candidate.category === article.category && candidate.slug !== article.slug).slice(0, 3);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <nav aria-label={t('breadcrumbs')} className="flex flex-wrap items-center gap-1 text-xs text-muted">
        <Link href="/help" className="rounded hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
          {t('title')}
        </Link>
        <ChevronLeft className="h-3.5 w-3.5 rtl:rotate-0 ltr:rotate-180" strokeWidth={1.7} aria-hidden="true" />
        <span>{category.title[locale]}</span>
      </nav>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <article className="overflow-hidden rounded border border-border bg-surface">
          <header className="border-b border-border p-5 sm:p-6">
            <p className="text-xs font-semibold text-primary">{category.title[locale]}</p>
            <h1 className="mt-1 text-xl font-semibold text-text sm:text-2xl">{article.title[locale]}</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted">{article.summary[locale]}</p>
            <p className="mt-3 flex items-center gap-1.5 text-xs text-muted">
              <Clock className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
              {t('readingTime', { minutes: article.minutes })}
            </p>
          </header>

          <div className="space-y-7 p-5 sm:p-6">
            {article.sections.map((section) => (
              <section key={section.title[locale]} className="space-y-3">
                <h2 className="text-base font-semibold text-text">{section.title[locale]}</h2>
                {section.paragraphs?.map((paragraph) => (
                  <p key={paragraph[locale]} className="text-sm leading-7 text-text">{paragraph[locale]}</p>
                ))}
                {section.steps ? (
                  <ol className="space-y-3">
                    {section.steps.map((step, index) => (
                      <li key={step[locale]} className="flex gap-3 text-sm leading-6 text-text">
                        <span className="num flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
                          {index + 1}
                        </span>
                        <span>{step[locale]}</span>
                      </li>
                    ))}
                  </ol>
                ) : null}
                {section.note ? (
                  <div className="flex gap-2.5 rounded border border-warning/30 bg-warning/5 p-3 text-sm leading-6 text-text">
                    <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" strokeWidth={1.7} aria-hidden="true" />
                    <p><span className="font-semibold">{t('important')}:</span> {section.note[locale]}</p>
                  </div>
                ) : null}
              </section>
            ))}

            {article.action ? (
              <div className="border-t border-border pt-5">
                <Button asChild>
                  <Link href={article.action.href}>
                    {article.action.label[locale]}
                    <ExternalLink className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
                  </Link>
                </Button>
              </div>
            ) : null}
          </div>
        </article>

        <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
          <Link
            href="/help"
            className="flex h-10 items-center gap-2 rounded border border-border bg-surface px-3 text-sm text-text hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" strokeWidth={1.7} aria-hidden="true" />
            {t('backToHelp')}
          </Link>

          {related.length ? (
            <section className="rounded border border-border bg-surface p-3" aria-labelledby="related-help-heading">
              <h2 id="related-help-heading" className="text-sm font-semibold text-text">{t('relatedArticles')}</h2>
              <div className="mt-2 divide-y divide-border">
                {related.map((item) => (
                  <Link
                    key={item.slug}
                    href={`/help/${item.slug}`}
                    className="flex items-start gap-2 py-2.5 text-sm text-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    <ChevronLeft className="mt-0.5 h-3.5 w-3.5 shrink-0 rtl:rotate-0 ltr:rotate-180" strokeWidth={1.7} aria-hidden="true" />
                    <span>{item.title[locale]}</span>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
