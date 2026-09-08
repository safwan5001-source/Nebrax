'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  BookOpen,
  Boxes,
  Calculator,
  ChevronLeft,
  CircleHelp,
  PackageCheck,
  Receipt,
  Search,
  ShoppingCart,
  Store,
  X,
  type LucideIcon,
} from 'lucide-react';
import { PageHeader } from '@/components/nebrax';
import { cn } from '@/lib/utils';
import {
  HELP_ARTICLES,
  HELP_CATEGORIES,
  getHelpCategory,
  helpLocale,
  searchHelpArticles,
  type HelpCategoryKey,
} from '@/modules/help-center/content';

const CATEGORY_ICONS: Record<HelpCategoryKey, LucideIcon> = {
  gettingStarted: BookOpen,
  sales: Receipt,
  purchases: ShoppingCart,
  inventory: Boxes,
  accounting: Calculator,
  pos: Store,
};

export function HelpCenterHome() {
  const t = useTranslations('helpCenter');
  const locale = helpLocale(useLocale());
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<HelpCategoryKey | undefined>();
  const articles = useMemo(() => searchHelpArticles(query, locale, category), [category, locale, query]);

  const clearFilters = () => {
    setQuery('');
    setCategory(undefined);
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('description')} />

      <section aria-labelledby="help-search-heading" className="rounded border border-border bg-surface p-4 sm:p-5">
        <h2 id="help-search-heading" className="text-sm font-semibold text-text">{t('searchTitle')}</h2>
        <div className="relative mt-3 max-w-3xl">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
            strokeWidth={1.7}
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={t('searchPlaceholder')}
            className="h-11 w-full rounded border border-border bg-background pe-10 ps-10 text-sm text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label={t('clearSearch')}
              className="absolute end-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded text-muted hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <X className="h-4 w-4" strokeWidth={1.7} />
            </button>
          ) : null}
        </div>
      </section>

      {!query && !category ? (
        <section aria-labelledby="help-categories-heading" className="space-y-3">
          <h2 id="help-categories-heading" className="text-sm font-semibold text-text">{t('categoriesTitle')}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {HELP_CATEGORIES.map((item) => {
              const Icon = CATEGORY_ICONS[item.key];
              const articleCount = HELP_ARTICLES.filter((article) => article.category === item.key).length;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setCategory(item.key)}
                  className="flex items-start gap-3 rounded border border-border bg-surface p-4 text-start transition-colors hover:border-primary/40 hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" strokeWidth={1.7} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-text">{item.title[locale]}</span>
                    <span className="mt-1 block text-xs leading-relaxed text-muted">{item.description[locale]}</span>
                    <span className="mt-2 block text-[11px] text-muted">{t('articleCount', { count: articleCount })}</span>
                  </span>
                  <ChevronLeft className="mt-0.5 h-4 w-4 shrink-0 text-muted rtl:rotate-0 ltr:rotate-180" strokeWidth={1.7} />
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="help-articles-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id="help-articles-heading" className="text-sm font-semibold text-text">
              {category ? getHelpCategory(category).title[locale] : query ? t('searchResults') : t('featuredTitle')}
            </h2>
            {(query || category) && (
              <p aria-live="polite" className="mt-0.5 text-xs text-muted">{t('resultCount', { count: articles.length })}</p>
            )}
          </div>
          {(query || category) && (
            <button
              type="button"
              onClick={clearFilters}
              className="h-9 rounded px-3 text-sm text-primary hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {t('showAll')}
            </button>
          )}
        </div>

        {articles.length ? (
          <div className="overflow-hidden rounded border border-border bg-surface">
            {articles.map((article, index) => {
              const articleCategory = getHelpCategory(article.category);
              return (
                <Link
                  key={article.slug}
                  href={`/help/${article.slug}`}
                  className={cn(
                    'group flex items-start gap-3 p-4 transition-colors hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40',
                    index > 0 && 'border-t border-border'
                  )}
                >
                  <CircleHelp className="mt-0.5 h-5 w-5 shrink-0 text-muted group-hover:text-primary" strokeWidth={1.7} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-text">{article.title[locale]}</span>
                    <span className="mt-1 block text-sm leading-relaxed text-muted">{article.summary[locale]}</span>
                    <span className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                      <span>{articleCategory.title[locale]}</span>
                      <span aria-hidden="true">·</span>
                      <span>{t('readingTime', { minutes: article.minutes })}</span>
                    </span>
                  </span>
                  <ChevronLeft className="mt-1 h-4 w-4 shrink-0 text-muted group-hover:text-primary rtl:rotate-0 ltr:rotate-180" strokeWidth={1.7} />
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="rounded border border-dashed border-border bg-surface px-4 py-10 text-center">
            <PackageCheck className="mx-auto h-7 w-7 text-muted" strokeWidth={1.6} aria-hidden="true" />
            <h3 className="mt-3 text-sm font-semibold text-text">{t('noResults')}</h3>
            <p className="mt-1 text-sm text-muted">{t('noResultsHint')}</p>
            <button
              type="button"
              onClick={clearFilters}
              className="mt-3 h-9 rounded px-3 text-sm font-medium text-primary hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {t('showAll')}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
