'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronLeft, Loader2, Search } from 'lucide-react';
import { fetchCatalog } from './client';
import type { Lang } from './format';
import type { Catalog } from './schemas';

/**
 * مركز تقارير الوقود (مشترك): الكتالوج المفوَّض للمستخدم من الخادم مجمَّعاً بالعائلات مع بحث. لا تقرير يظهر بلا صلاحيته (الخادم يصفّي)،
 * ولا قائمة ثابتة في الواجهة. `basePath` يحدد وجهة الروابط (داخل التطبيق أو داخل أَوْج).
 */
export function ReportCenter({ basePath }: { basePath: string }) {
  const t = useTranslations('fuelReports');
  const locale = useLocale();
  const lang: Lang = locale.startsWith('en') ? 'en' : 'ar';
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<number | 'other' | null>(null);
  const [q, setQ] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetchCatalog()
      .then((c) => { if (!cancelled) setCatalog(c); })
      .catch((e: unknown) => { if (!cancelled) setError(typeof (e as { status?: number })?.status === 'number' ? (e as { status: number }).status : 'other'); });
    return () => { cancelled = true; };
  }, [attempt]);

  const groups = useMemo(() => {
    if (!catalog) return [];
    const needle = q.trim().toLowerCase();
    return Object.entries(catalog.families)
      .map(([family, label]) => ({
        family, label: label[lang],
        reports: catalog.reports.filter((r) => r.family === family && (needle === '' || `${r.title[lang]} ${r.description[lang]}`.toLowerCase().includes(needle))),
      }))
      .filter((g) => g.reports.length > 0);
  }, [catalog, q, lang]);

  if (error !== null) {
    return (
      <div className="space-y-3 text-center" data-report-center-error={String(error)}>
        <p role="alert" className="rounded-[12px] bg-[color:var(--fo-negative-tint,rgba(220,38,38,.08))] p-4 text-sm text-negative">{t(error === 403 ? 'error.forbidden' : 'error.failed')}</p>
        {error !== 403 ? <button type="button" onClick={() => setAttempt((n) => n + 1)} className="min-h-11 rounded-[11px] border border-[color:var(--fo-control,var(--border))] px-4 text-sm font-semibold text-text hover:bg-primary-soft">{t('retry')}</button> : null}
      </div>
    );
  }
  if (!catalog) return <p className="py-10 text-center text-sm text-muted" role="status"><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" aria-hidden="true" />{t('loading')}</p>;

  return (
    <div className="space-y-5" data-report-center="">
      <div className="relative">
        <label htmlFor="fr-search" className="sr-only">{t('search')}</label>
        <Search aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" strokeWidth={1.8} />
        <input id="fr-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('searchPlaceholder')} autoComplete="off"
          className="h-12 w-full rounded-[11px] border border-[color:var(--fo-control,var(--border))] bg-surface ps-10 pe-3 text-base text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" />
      </div>

      {groups.length === 0 ? <p className="rounded-[12px] border border-dashed border-border px-4 py-10 text-center text-sm text-muted">{t('noResults')}</p> : null}

      {groups.map((group) => (
        <section key={group.family} aria-labelledby={`fr-${group.family}`} data-report-family={group.family} className="space-y-2">
          <h2 id={`fr-${group.family}`} className="text-sm font-semibold text-text">{group.label} <span className="num text-xs font-normal text-muted">({group.reports.length})</span></h2>
          <ul className="space-y-2">
            {group.reports.map((report) => (
              <li key={report.key}>
                <Link href={`${basePath}/${report.key}`} data-report-link={report.key}
                  className="flex min-h-14 items-center gap-3 rounded-[12px] border border-border bg-surface px-4 py-3 hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-text">{report.title[lang]}</span>
                    <span className="mt-0.5 block text-xs leading-5 text-muted">{report.description[lang]}</span>
                  </span>
                  <ChevronLeft aria-hidden="true" className="h-5 w-5 shrink-0 text-muted ltr:rotate-180" strokeWidth={1.8} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
