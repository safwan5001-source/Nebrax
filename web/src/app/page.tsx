'use client';

/**
 * اتجاه التصميم: «المكتب الواثق» — مسرح منتج غير متماثل، نص عربي مباشر،
 * ولقطتا سطح المكتب والجوال هما الدليل البصري مع تبديل مصدر واحد لكل سمة.
 */
import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import {
  ArrowLeft,
  BarChart3,
  BookOpen,
  Building2,
  CalendarCog,
  Factory,
  Truck,
  UsersRound,
  Wrench,
  Check,
  ChevronLeft,
  Package,
  QrCode,
  ShieldCheck,
  Store,
  UserCog,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { LangToggle } from '@/components/layout/lang-toggle';
import { NebraxLogo } from '@/components/layout/nebrax-logo';
import { enableDemo } from '@/lib/demo';

const FEATURES: { icon: LucideIcon; title: string; desc: string }[] = [
  { icon: QrCode, title: 'f_zatca_title', desc: 'f_zatca_desc' },
  { icon: BookOpen, title: 'f_accounting_title', desc: 'f_accounting_desc' },
  { icon: Store, title: 'f_sales_title', desc: 'f_sales_desc' },
  { icon: Package, title: 'f_inventory_title', desc: 'f_inventory_desc' },
  { icon: UserCog, title: 'f_hr_title', desc: 'f_hr_desc' },
  { icon: BarChart3, title: 'f_reports_title', desc: 'f_reports_desc' },
];

const TRUST_ITEMS = ['trust_fast', 'trust_arabic', 'trust_secure'] as const;

const ABOUT_PILLARS: { icon: LucideIcon; title: string; desc: string }[] = [
  { icon: Wrench, title: 'about_flex_title', desc: 'about_flex_desc' },
  { icon: BookOpen, title: 'about_arabic_title', desc: 'about_arabic_desc' },
  { icon: Package, title: 'about_ops_title', desc: 'about_ops_desc' },
];

const INDUSTRIES: { icon: LucideIcon; title: string; desc: string }[] = [
  { icon: Store, title: 'industry_retail_title', desc: 'industry_retail_desc' },
  { icon: Wrench, title: 'industry_services_title', desc: 'industry_services_desc' },
  { icon: Building2, title: 'industry_contracting_title', desc: 'industry_contracting_desc' },
  { icon: Truck, title: 'industry_logistics_title', desc: 'industry_logistics_desc' },
  { icon: CalendarCog, title: 'industry_hospitality_title', desc: 'industry_hospitality_desc' },
  { icon: Factory, title: 'industry_operations_title', desc: 'industry_operations_desc' },
];

const JOURNEY: { icon: LucideIcon; title: string; desc: string }[] = [
  { icon: Store, title: 'journey_sell_title', desc: 'journey_sell_desc' },
  { icon: Package, title: 'journey_stock_title', desc: 'journey_stock_desc' },
  { icon: BookOpen, title: 'journey_finance_title', desc: 'journey_finance_desc' },
  { icon: UsersRound, title: 'journey_team_title', desc: 'journey_team_desc' },
];

export default function LandingPage() {
  const t = useTranslations('landing');
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const [themeReady, setThemeReady] = useState(false);

  useEffect(() => {
    setThemeReady(true);
  }, []);

  const isDark = themeReady && resolvedTheme === 'dark';

  function enterDemo() {
    enableDemo();
    router.push('/dashboard');
  }

  const ghostActionClass = 'inline-flex h-8 items-center justify-center rounded px-3 text-sm font-medium text-text transition-colors hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background';
  const outlineActionClass = 'inline-flex h-11 w-full items-center justify-center rounded border border-border bg-surface px-5 text-base font-medium text-text transition-colors hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:w-auto';

  return (
    <div
      className="min-h-screen overflow-x-hidden bg-background text-text"
    >
      <a
        href="#main-content"
        className="sr-only absolute start-4 top-4 z-50 rounded bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm focus:not-sr-only focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        onClick={() => window.requestAnimationFrame(() => document.getElementById('main-content')?.focus())}
      >
        {t('skip_to_content')}
      </a>
      <header className="sticky top-0 z-20 border-b border-border/80 bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center" aria-label={t('brand_aria')}>
            <NebraxLogo className="h-10 w-auto" priority />
          </Link>

          <div className="ms-auto flex items-center gap-1.5 sm:gap-2">
            <LangToggle />
            <ThemeToggle />
            <Link href="/login" className={`hidden sm:inline-flex ${ghostActionClass}`}>{t('cta_login')}</Link>
            <Button size="sm" className="px-3 sm:px-4" onClick={enterDemo}>
              {t('cta_demo')}
              <ArrowLeft className="h-4 w-4" strokeWidth={2} />
            </Button>
          </div>
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="outline-none">
        <section className="relative overflow-hidden border-b border-border bg-background">
          <div className="mx-auto grid w-full max-w-7xl items-center gap-12 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[0.78fr_1.22fr] lg:gap-10 lg:px-8 lg:py-24">
            <div className="max-w-xl">
              <p className="mb-5 inline-flex items-center gap-2 border-b-2 border-primary pb-2 text-sm font-semibold text-primary">
                <span className="h-2 w-2 rounded-full bg-primary" aria-hidden="true" />
                {t('tagline')}
              </p>
              <h1 className="max-w-xl text-4xl font-bold leading-[1.16] tracking-tight sm:text-5xl lg:text-[3.65rem]">
                {t('hero_title')}
              </h1>
              <p className="mt-6 max-w-xl text-base leading-8 text-muted sm:text-lg">
                {t('hero_subtitle')}
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button size="md" className="h-11 w-full px-5 text-base sm:w-auto" onClick={enterDemo}>
                  {t('cta_demo')}
                  <ArrowLeft className="h-4 w-4" strokeWidth={2} />
                </Button>
                <Link href="#modules" className="w-full sm:w-auto">
                  <span className={outlineActionClass}>{t('hero_secondary_cta')}</span>
                </Link>
              </div>

              <ul className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted" aria-label={t('trust_aria')}>
                {TRUST_ITEMS.map((item) => (
                  <li key={item} className="inline-flex items-center gap-1.5">
                    <Check className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.8} aria-hidden="true" />
                    {t(item)}
                  </li>
                ))}
              </ul>
            </div>

            <figure className="mx-auto w-full max-w-3xl lg:max-w-none" aria-label={t('preview_aria')}>
              <p className="mb-3 text-sm font-semibold text-primary">{t('hero_product_label')}</p>
              <div className="relative pb-9 sm:pb-12">
                <div className="relative aspect-[1.40625] overflow-hidden rounded-xl border border-border bg-surface shadow-lg shadow-black/10 dark:shadow-black/25">
                  {themeReady ? (
                    <Image
                      src={isDark ? '/landing/dashboard-desktop-dark.png' : '/landing/dashboard-desktop-light.png'}
                      alt={t('hero_desktop_alt')}
                      fill
                      priority
                      quality={82}
                      sizes="(max-width: 767px) 94vw, (max-width: 1280px) 56vw, 800px"
                      className="object-cover"
                    />
                  ) : (
                    <div className="absolute inset-0 animate-pulse bg-primary-soft" aria-hidden="true" />
                  )}
                </div>

                <div className="absolute -bottom-2 start-3 w-[31%] min-w-[124px] max-w-[184px] sm:-bottom-5 sm:start-7">
                  <div className="relative aspect-[390/844] overflow-hidden rounded-[1.25rem] border-[5px] border-text bg-background shadow-lg shadow-black/15 dark:shadow-black/40">
                    {themeReady ? (
                      <Image
                        src={isDark ? '/landing/dashboard-mobile-dark.png' : '/landing/dashboard-mobile-light.png'}
                        alt={t('hero_mobile_alt')}
                        fill
                        quality={86}
                        sizes="(max-width: 767px) 30vw, 170px"
                        className="object-cover"
                      />
                    ) : (
                      <div className="absolute inset-0 bg-primary-soft" aria-hidden="true" />
                    )}
                  </div>
                </div>
              </div>
              <figcaption className="mt-2 text-sm leading-6 text-muted sm:ms-[12rem]">{t('hero_product_note')}</figcaption>
            </figure>
          </div>
        </section>

        <section id="industries" className="border-y border-border bg-surface">
          <div className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
            <div className="grid gap-8 lg:grid-cols-[0.75fr_1.25fr] lg:items-end">
              <div>
                <p className="text-sm font-bold text-primary">{t('industries_kicker')}</p>
                <h2 className="mt-3 text-2xl font-bold leading-tight tracking-tight sm:text-3xl">{t('industries_title')}</h2>
                <p className="mt-4 text-base leading-7 text-muted">{t('industries_subtitle')}</p>
              </div>
              <div className="rounded-lg border border-primary/15 bg-primary-soft p-5 text-sm leading-7 text-text">
                <p className="font-bold text-primary">{t('industries_note_title')}</p>
                <p className="mt-1">{t('industries_note')}</p>
              </div>
            </div>
            <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {INDUSTRIES.map((industry) => {
                const Icon = industry.icon;
                return (
                  <article key={industry.title} className="rounded-lg border border-border bg-background p-5 transition-colors duration-200 hover:border-primary/40">
                    <Icon className="h-5 w-5 text-muted" strokeWidth={1.8} aria-hidden="true" />
                    <h3 className="mt-4 text-base font-bold">{t(industry.title)}</h3>
                    <p className="mt-2 text-sm leading-6 text-muted">{t(industry.desc)}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section id="modules" className="border-b border-border bg-background">
          <div className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-sm font-bold text-primary">{t('features_kicker')}</p>
              <h2 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">{t('features_title')}</h2>
              <p className="mt-3 text-base leading-7 text-muted">{t('features_subtitle')}</p>
            </div>

            <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((feature) => {
                const Icon = feature.icon;
                return (
                  <article key={feature.title} className="group rounded-lg border border-border bg-background p-5 transition-colors duration-200 hover:border-primary/40">
                    <Icon className="h-5 w-5 text-muted" strokeWidth={1.8} aria-hidden="true" />
                    <h3 className="mt-4 text-base font-bold">{t(feature.title)}</h3>
                    <p className="mt-2 text-sm leading-6 text-muted">{t(feature.desc)}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section id="journey" className="border-b border-border bg-surface">
          <div className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-sm font-bold text-primary">{t('journey_kicker')}</p>
              <h2 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">{t('journey_title')}</h2>
              <p className="mt-3 text-base leading-7 text-muted">{t('journey_subtitle')}</p>
            </div>
            <div className="mx-auto mt-10 max-w-5xl divide-y divide-border rounded-lg border border-border bg-background">
              {JOURNEY.map((step, index) => {
                const Icon = step.icon;
                return (
                  <article key={step.title} className="grid gap-4 p-5 sm:grid-cols-[2.5rem_1fr_auto] sm:items-center">
                    <span className="font-mono text-sm font-semibold text-primary">0{index + 1}</span>
                    <div>
                      <h3 className="text-base font-bold">{t(step.title)}</h3>
                      <p className="mt-1 text-sm leading-6 text-muted">{t(step.desc)}</p>
                    </div>
                    <Icon className="h-5 w-5 text-muted" strokeWidth={1.8} aria-hidden="true" />
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section id="about" className="border-b border-border bg-background px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
          <div className="mx-auto grid w-full max-w-7xl gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
            <div className="lg:sticky lg:top-24 lg:self-start">
              <p className="text-sm font-bold text-primary">{t('about_kicker')}</p>
              <h2 className="mt-3 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">{t('about_title')}</h2>
              <p className="mt-5 text-base leading-8 text-muted">{t('about_lead')}</p>
              <div className="mt-8 inline-flex items-end gap-3 rounded-lg border border-primary/15 bg-primary-soft px-5 py-4">
                <strong className="text-3xl font-bold tracking-tight text-primary">{t('about_stat')}</strong>
                <span className="mb-1 max-w-28 text-xs font-semibold leading-5 text-primary/80">{t('about_stat_label')}</span>
              </div>
            </div>

            <div className="space-y-5">
              <article className="rounded-lg border border-border bg-surface p-6 sm:p-7">
                <p className="text-sm font-bold text-primary">{t('about_story_title')}</p>
                <h3 className="mt-3 text-xl font-bold sm:text-2xl">{t('about_story_heading')}</h3>
                <p className="mt-4 text-sm leading-7 text-muted sm:text-base">{t('about_story')}</p>
                <div className="mt-5 rounded-lg border-s-4 border-primary bg-primary-soft px-4 py-3 text-sm font-medium leading-7 text-text">
                  {t('about_origin')}
                </div>
              </article>

              <div className="grid gap-4 sm:grid-cols-3">
                {ABOUT_PILLARS.map((pillar) => {
                  const Icon = pillar.icon;
                  return (
                    <article key={pillar.title} className="rounded-lg border border-border bg-surface p-5">
                      <Icon className="h-5 w-5 text-primary" strokeWidth={1.8} aria-hidden="true" />
                      <h3 className="mt-4 text-sm font-bold">{t(pillar.title)}</h3>
                      <p className="mt-2 text-sm leading-6 text-muted">{t(pillar.desc)}</p>
                    </article>
                  );
                })}
              </div>

              <article className="rounded-lg border border-border bg-surface p-6 text-text sm:p-7">
                <p className="text-sm font-bold text-primary">{t('about_vision_title')}</p>
                <p className="mt-3 text-lg font-medium leading-8 text-muted">{t('about_vision')}</p>
              </article>
            </div>
          </div>
        </section>

        <section id="start" className="border-b border-border bg-surface">
          <div className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-sm font-bold text-primary">{t('start_kicker')}</p>
              <h2 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">{t('start_title')}</h2>
              <p className="mt-3 text-base leading-7 text-muted">{t('start_subtitle')}</p>
            </div>
            <div className="mx-auto mt-10 grid max-w-5xl gap-4 md:grid-cols-3">
              {(['start_step_one', 'start_step_two', 'start_step_three'] as const).map((step, index) => (
                <article key={step} className="rounded-lg border border-border bg-background p-6">
                  <span className="font-mono text-sm font-semibold text-primary">0{index + 1}</span>
                  <h3 className="mt-4 text-base font-bold">{t(`${step}_title`)}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted">{t(`${step}_desc`)}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
          <div className="mx-auto max-w-5xl rounded-lg border border-primary bg-primary px-6 py-10 text-white sm:px-10 sm:py-12">
            <div className="grid items-center gap-8 md:grid-cols-[1fr_auto]">
              <div>
                <ShieldCheck className="h-7 w-7 text-white/85" strokeWidth={1.8} aria-hidden="true" />
                <h2 className="mt-4 text-2xl font-bold leading-tight sm:text-3xl">{t('final_title')}</h2>
                <p className="mt-3 max-w-2xl text-sm leading-7 text-white/75 sm:text-base">{t('final_subtitle')}</p>
              </div>
              <Button
                size="md"
                className="h-11 w-full bg-white px-5 text-base text-primary hover:bg-primary-soft md:w-auto"
                onClick={enterDemo}
              >
                {t('cta_demo')}
                <ChevronLeft className="h-4 w-4" strokeWidth={2} />
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 px-4 py-7 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>{t('footer')}</p>
          <Link href="/login" className="font-medium text-text transition-colors hover:text-primary">{t('cta_login')}</Link>
        </div>
      </footer>
    </div>
  );
}
