'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { BookOpen, ChevronLeft, CircleHelp, ClipboardCheck, Fuel, Gauge, PackageCheck, Search, Settings2, ShieldCheck, Users, X, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  FUEL_AUDIENCE_LABELS,
  FUEL_HELP_CATEGORIES,
  getFuelHelpCategory,
  helpLocale,
  searchFuelHelp,
  type FuelAudience,
  type FuelHelpCategoryKey,
} from '@/modules/help-center/fuel';
import { AudienceBadges, type FuelHelpSurface } from './fuel-help-article-body';

const CATEGORY_ICONS: Record<FuelHelpCategoryKey, LucideIcon> = {
  appBasics: BookOpen,
  stationSetup: Settings2,
  staffAccess: Users,
  shifts: ClipboardCheck,
  salesCollection: Gauge,
  receivingStock: Fuel,
  monitoring: ShieldCheck,
};

const AUDIENCES: readonly FuelAudience[] = ['operator', 'supervisor', 'manager'];

/**
 * مركز المساعدة الواحد لمحطات الوقود. يُعرض داخل غلاف التطبيق (`surface="app"`) أو غلاف وحدة ERP (`surface="erp"`)
 * بالمحتوى نفسه. `basePath` أساس روابط المقالات في ذلك السطح؛ `defaultAudience` تفضيل ابتدائي مشتق من الصلاحيات.
 */
export function FuelHelpCenter({ basePath, surface, defaultAudience }: { basePath: string; surface: FuelHelpSurface; defaultAudience?: FuelAudience }) {
  const t = useTranslations('fuelHelp');
  const common = useTranslations('helpCenter');
  const locale = helpLocale(useLocale());
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<FuelHelpCategoryKey | undefined>();
  const [audience, setAudience] = useState<FuelAudience | undefined>(defaultAudience);
  const articles = useMemo(() => searchFuelHelp({ query, category, audience }, locale), [query, category, audience, locale]);
  const filtered = Boolean(query || category);

  const clear = () => {
    setQuery('');
    setCategory(undefined);
  };

  const chip = (active: boolean) =>
    cn(
      'min-h-11 shrink-0 rounded-full border px-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
      active ? 'border-primary bg-primary-soft text-primary' : 'border-border bg-surface text-muted hover:text-text',
    );

  return (
    <div className="space-y-5" data-surface={surface}>
      <section aria-labelledby="fh-search-h" className="rounded-[16px] border border-border bg-surface p-4">
        <h2 id="fh-search-h" className="text-sm font-semibold text-text">{t('searchTitle')}</h2>
        <div className="relative mt-3">
          <Search aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" strokeWidth={1.7} />
          <input
            type="search"
            aria-labelledby="fh-search-h"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={t('searchPlaceholder')}
            enterKeyHint="search"
            className="h-12 w-full rounded-[12px] border border-border bg-background pe-11 ps-11 text-base text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label={common('clearSearch')}
              className="absolute end-1 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-[10px] text-muted hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <X aria-hidden="true" className="h-4 w-4" strokeWidth={1.7} />
            </button>
          ) : null}
        </div>

        <div className="mt-3">
          <p id="fh-audience-h" className="text-xs font-medium text-muted">{t('audienceLabel')}</p>
          <div role="group" aria-labelledby="fh-audience-h" className="-mx-1 mt-2 flex gap-2 overflow-x-auto px-1 pb-1">
            <button type="button" aria-pressed={audience === undefined} onClick={() => setAudience(undefined)} className={chip(audience === undefined)}>{t('audienceAll')}</button>
            {AUDIENCES.map((value) => (
              <button key={value} type="button" aria-pressed={audience === value} onClick={() => setAudience(value)} className={chip(audience === value)}>
                {FUEL_AUDIENCE_LABELS[value][locale]}
                {defaultAudience === value ? <span className="ms-1.5 text-[11px] opacity-80">({t('recommended')})</span> : null}
              </button>
            ))}
          </div>
        </div>
      </section>

      {!filtered ? (
        <section aria-labelledby="fh-cats-h" className="space-y-3">
          <h2 id="fh-cats-h" className="text-sm font-semibold text-text">{t('categoriesTitle')}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {FUEL_HELP_CATEGORIES.map((item) => {
              const Icon = CATEGORY_ICONS[item.key];
              const count = searchFuelHelp({ category: item.key, audience }, locale).length;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setCategory(item.key)}
                  className="flex min-h-[72px] items-start gap-3 rounded-[14px] border border-border bg-surface p-4 text-start transition-colors hover:border-primary/40 hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <Icon aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-primary" strokeWidth={1.7} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-text">{item.title[locale]}</span>
                    <span className="mt-1 block text-xs leading-relaxed text-muted">{item.description[locale]}</span>
                    <span className="mt-2 block text-[11px] text-muted">{common('articleCount', { count })}</span>
                  </span>
                  <ChevronLeft aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted ltr:rotate-180" strokeWidth={1.7} />
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="fh-list-h" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id="fh-list-h" className="text-sm font-semibold text-text">
              {category ? getFuelHelpCategory(category).title[locale] : query ? common('searchResults') : t('allGuides')}
            </h2>
            <p aria-live="polite" className="mt-0.5 text-xs text-muted">{common('resultCount', { count: articles.length })}</p>
          </div>
          {filtered ? (
            <button type="button" onClick={clear} className="min-h-11 rounded-[10px] px-3 text-sm text-primary hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
              {common('showAll')}
            </button>
          ) : null}
        </div>

        {articles.length ? (
          <ul className="overflow-hidden rounded-[14px] border border-border bg-surface">
            {articles.map((article, index) => (
              <li key={article.slug} className={cn(index > 0 && 'border-t border-border')}>
                <Link
                  href={`${basePath}/${article.slug}`}
                  className="group flex min-h-[72px] items-start gap-3 p-4 transition-colors hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
                >
                  <CircleHelp aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-muted group-hover:text-primary" strokeWidth={1.7} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold leading-6 text-text">{article.title[locale]}</span>
                    <span className="mt-1 block text-sm leading-6 text-muted">{article.summary[locale]}</span>
                    <span className="mt-2 flex flex-wrap items-center gap-2">
                      <AudienceBadges article={article} locale={locale} />
                      <span className="text-[11px] text-muted">{common('readingTime', { minutes: article.minutes })}</span>
                    </span>
                  </span>
                  <ChevronLeft aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-muted ltr:rotate-180" strokeWidth={1.7} />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-[14px] border border-dashed border-border bg-surface px-4 py-10 text-center">
            <PackageCheck aria-hidden="true" className="mx-auto h-7 w-7 text-muted" strokeWidth={1.6} />
            <h3 className="mt-3 text-sm font-semibold text-text">{common('noResults')}</h3>
            <p className="mt-1 text-sm text-muted">{common('noResultsHint')}</p>
            <button type="button" onClick={() => { clear(); setAudience(undefined); }} className="mt-3 min-h-11 rounded-[10px] px-3 text-sm font-medium text-primary hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
              {common('showAll')}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
