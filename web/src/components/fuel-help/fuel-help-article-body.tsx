'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { CircleAlert, ExternalLink, KeyRound, Lock, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  FUEL_AUDIENCE_LABELS,
  permissionLabel,
  type FuelHelpArticle,
  type FuelHelpProcedure,
  type FuelHelpScreen,
  type HelpLocale,
} from '@/modules/help-center/fuel';

/** السطح الذي يعرض المحتوى: يحدّد أي رابط شاشة يظهر (التطبيق لا يحيل إلى ERP أبداً). */
export type FuelHelpSurface = 'app' | 'erp';

export interface ScreenLink {
  href: string;
  label: string;
  cross: boolean;
}

/** روابط الشاشات المناسبة للسطح: التطبيق يرى روابط التطبيق فقط؛ ERP يرى روابطه، وإلا رابط التطبيق معلَّماً. */
export function screenLinks(screens: readonly FuelHelpScreen[] | undefined, surface: FuelHelpSurface, locale: HelpLocale): ScreenLink[] {
  const links: ScreenLink[] = [];
  for (const screen of screens ?? []) {
    if (surface === 'app') {
      if (screen.appHref) links.push({ href: screen.appHref, label: screen.label[locale], cross: false });
    } else if (screen.erpHref) {
      links.push({ href: screen.erpHref, label: screen.label[locale], cross: false });
    } else if (screen.appHref) {
      links.push({ href: screen.appHref, label: screen.label[locale], cross: true });
    }
  }
  return links;
}

export function SurfaceNote({ article, surface }: { article: FuelHelpArticle; surface: FuelHelpSurface }) {
  const t = useTranslations('fuelHelp');
  const text = article.surface === 'both' ? t('performedInBoth') : article.surface === 'app' ? t('performedInApp') : t('performedInErp');
  const mismatch = article.surface !== 'both' && article.surface !== surface;
  return (
    <p className={cn('flex items-start gap-2 rounded-[10px] px-3 py-2 text-[13px] leading-6', mismatch ? 'bg-warning/10 text-text' : 'bg-primary-soft text-text')}>
      <CircleAlert aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-primary" strokeWidth={1.8} />
      <span>{text}</span>
    </p>
  );
}

export function AudienceBadges({ article, locale }: { article: FuelHelpArticle; locale: HelpLocale }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {article.audiences.map((audience) => (
        <li key={audience} className="rounded-full border border-border bg-background px-2.5 py-0.5 text-[11px] font-medium text-muted">
          {FUEL_AUDIENCE_LABELS[audience][locale]}
        </li>
      ))}
    </ul>
  );
}

function Numbered({ steps, locale }: { steps: FuelHelpProcedure['steps']; locale: HelpLocale }) {
  return (
    <ol className="space-y-3">
      {steps.map((step, index) => (
        <li key={step[locale]} className="flex gap-3 text-[15px] leading-7 text-text">
          <span className="num mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary">{index + 1}</span>
          <span className="min-w-0">{step[locale]}</span>
        </li>
      ))}
    </ol>
  );
}

function Heading({ children, id }: { children: React.ReactNode; id: string }) {
  return <h2 id={id} className="text-base font-semibold text-text">{children}</h2>;
}

/**
 * جسم الدليل المشترك بين صفحة المقال (ERP والتطبيق) والورقة السياقية. `compact` يعرض الجوهر فقط:
 * الوصف + أول إجراء + أبرز ثلاث مشكلات، ويترك الباقي للدليل الكامل.
 */
export function FuelHelpArticleBody({
  article,
  locale,
  surface,
  compact = false,
  onStartGuide,
}: {
  article: FuelHelpArticle;
  locale: HelpLocale;
  surface: FuelHelpSurface;
  compact?: boolean;
  onStartGuide?: (procedureIndex: number) => void;
}) {
  const t = useTranslations('fuelHelp');
  const procedures = compact ? article.procedures.slice(0, 1) : article.procedures;
  const problems = compact ? (article.problems ?? []).slice(0, 3) : (article.problems ?? []);
  const links = screenLinks(article.screens, surface, locale);
  const pid = `fh-${article.slug}`;

  return (
    <div className="space-y-7">
      <SurfaceNote article={article} surface={surface} />

      <section aria-labelledby={`${pid}-overview`} className="space-y-2">
        <Heading id={`${pid}-overview`}>{t('overview')}</Heading>
        <p className="text-[15px] leading-7 text-text">{article.overview[locale]}</p>
      </section>

      <section aria-labelledby={`${pid}-perm`} className="space-y-2">
        <Heading id={`${pid}-perm`}>{t('permissionsTitle')}</Heading>
        {article.permissions.length ? (
          <ul className="divide-y divide-border rounded-[12px] border border-border bg-background">
            {article.permissions.map((key) => (
              <li key={key} className="flex items-start gap-3 px-3 py-2.5 text-sm">
                <KeyRound aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted" strokeWidth={1.7} />
                <span className="min-w-0">
                  <code dir="ltr" className="block break-all text-[12px] font-semibold text-primary">{key}</code>
                  <span className="block leading-6 text-text">{permissionLabel(key)?.[locale] ?? ''}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">{t('permissionsNone')}</p>
        )}
        {article.permissionsNote ? <p className="text-[13px] leading-6 text-muted">{article.permissionsNote[locale]}</p> : null}
      </section>

      {procedures.map((procedure, index) => (
        <section key={procedure.title[locale]} aria-labelledby={`${pid}-proc-${index}`} className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Heading id={`${pid}-proc-${index}`}>{procedure.title[locale]}</Heading>
            {onStartGuide ? (
              <button
                type="button"
                onClick={() => onStartGuide(index)}
                className="min-h-11 rounded-[10px] border border-primary px-3 text-sm font-semibold text-primary hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                {t('startGuide')}
              </button>
            ) : null}
          </div>
          <Numbered steps={procedure.steps} locale={locale} />
        </section>
      ))}

      {!compact && article.fields?.length ? (
        <section aria-labelledby={`${pid}-fields`} className="space-y-2">
          <Heading id={`${pid}-fields`}>{t('fieldsTitle')}</Heading>
          <dl className="divide-y divide-border rounded-[12px] border border-border bg-background">
            {article.fields.map((field) => (
              <div key={field.name[locale]} className="px-3 py-3">
                <dt className="text-sm font-semibold text-text">{field.name[locale]}</dt>
                <dd className="mt-1 text-[14px] leading-6 text-muted">{field.description[locale]}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {problems.length ? (
        <section aria-labelledby={`${pid}-problems`} className="space-y-2">
          <Heading id={`${pid}-problems`}>{t('problemsTitle')}</Heading>
          <ul className="space-y-2">
            {problems.map((item) => (
              <li key={item.problem[locale]} className="rounded-[12px] border border-border bg-background p-3">
                <p className="flex items-start gap-2 text-sm font-semibold leading-6 text-text">
                  <TriangleAlert aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-warning" strokeWidth={1.8} />
                  <span><span className="sr-only">{t('problemLabel')}: </span>{item.problem[locale]}</span>
                </p>
                <p className="mt-1.5 ps-6 text-[14px] leading-6 text-text"><span className="font-semibold text-primary">{t('fixLabel')}: </span>{item.fix[locale]}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!compact && article.notes?.length ? (
        <section aria-labelledby={`${pid}-notes`} className="space-y-2">
          <Heading id={`${pid}-notes`}>{t('notesTitle')}</Heading>
          {article.notes.map((note) => (
            <p key={note[locale]} className="flex gap-2.5 rounded-[12px] border border-warning/30 bg-warning/5 p-3 text-sm leading-6 text-text">
              <CircleAlert aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-warning" strokeWidth={1.8} />
              <span>{note[locale]}</span>
            </p>
          ))}
        </section>
      ) : null}

      {!compact && article.unavailable?.length ? (
        <section aria-labelledby={`${pid}-unavailable`} className="space-y-2">
          <Heading id={`${pid}-unavailable`}>{t('unavailableTitle')}</Heading>
          <p className="text-[13px] text-muted">{t('unavailableHint')}</p>
          {article.unavailable.map((item) => (
            <p key={item[locale]} className="flex gap-2.5 rounded-[12px] border border-dashed border-border p-3 text-sm leading-6 text-text">
              <Lock aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-muted" strokeWidth={1.7} />
              <span>{item[locale]}</span>
            </p>
          ))}
        </section>
      ) : null}

      {!compact && links.length ? (
        <section aria-labelledby={`${pid}-screens`} className="space-y-2">
          <Heading id={`${pid}-screens`}>{t('screensTitle')}</Heading>
          <ul className="space-y-2">
            {links.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="flex min-h-11 items-center justify-between gap-2 rounded-[12px] border border-border bg-surface px-3 text-sm font-medium text-text hover:border-primary/40 hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <span className="min-w-0 truncate">{link.label}{link.cross ? ` — ${t('openInApp')}` : ''}</span>
                  <ExternalLink aria-hidden="true" className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.7} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
