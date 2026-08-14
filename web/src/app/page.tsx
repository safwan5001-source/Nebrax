'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
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
  Sparkles,
  Store,
  UserCog,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { LangToggle } from '@/components/layout/lang-toggle';
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
  { icon: Sparkles, title: 'about_flex_title', desc: 'about_flex_desc' },
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

  function enterDemo() {
    enableDemo();
    router.push('/dashboard');
  }

  return (
    <div
      className="min-h-screen overflow-x-hidden bg-background text-text"
      style={{ fontFamily: 'var(--font-tajawal), var(--font-sans)' }}
    >
      <header className="sticky top-0 z-20 border-b border-border/80 bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2.5" aria-label={t('brand_aria')}>
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-base font-bold text-white shadow-sm">
              نـ
            </span>
            <span className="text-base font-bold tracking-tight">نبراكس</span>
          </Link>

          <div className="ms-auto flex items-center gap-1.5 sm:gap-2">
            <LangToggle />
            <ThemeToggle />
            <Link href="/login" className="hidden sm:block">
              <Button variant="ghost" size="sm" className="px-3">{t('cta_login')}</Button>
            </Link>
            <Button size="sm" className="px-3 sm:px-4" onClick={enterDemo}>
              {t('cta_demo')}
              <ArrowLeft className="h-4 w-4" strokeWidth={2} />
            </Button>
          </div>
        </div>
      </header>

      <main>
        <section className="relative isolate overflow-hidden">
          <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_85%_18%,color-mix(in_srgb,var(--primary)_16%,transparent),transparent_29rem),radial-gradient(circle_at_12%_82%,color-mix(in_srgb,var(--positive)_10%,transparent),transparent_24rem)]" />
          <div className="mx-auto grid w-full max-w-7xl items-center gap-12 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[1.02fr_0.98fr] lg:gap-16 lg:px-8 lg:py-24">
            <div className="max-w-2xl">
              <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary-soft px-3 py-1.5 text-xs font-bold text-primary sm:text-sm">
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                {t('tagline')}
              </p>
              <h1 className="max-w-xl text-4xl font-bold leading-[1.22] tracking-tight sm:text-5xl lg:text-[3.35rem]">
                {t('hero_title')}
              </h1>
              <p className="mt-5 max-w-xl text-base leading-8 text-muted sm:text-lg">
                {t('hero_subtitle')}
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button size="md" className="h-11 w-full px-5 text-base shadow-lg shadow-primary/20 sm:w-auto" onClick={enterDemo}>
                  {t('cta_demo')}
                  <ArrowLeft className="h-4 w-4" strokeWidth={2} />
                </Button>
                <Link href="/login" className="w-full sm:w-auto">
                  <Button variant="outline" size="md" className="h-11 w-full px-5 text-base sm:w-auto">
                    {t('cta_login')}
                  </Button>
                </Link>
              </div>

              <ul className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted" aria-label={t('trust_aria')}>
                {TRUST_ITEMS.map((item) => (
                  <li key={item} className="inline-flex items-center gap-1.5">
                    <Check className="h-4 w-4 shrink-0 text-positive" strokeWidth={2.4} aria-hidden="true" />
                    {t(item)}
                  </li>
                ))}
              </ul>
            </div>

            <div className="relative mx-auto w-full max-w-xl lg:max-w-none" aria-label={t('preview_aria')}>
              <div className="absolute -inset-5 -z-10 rounded-[2rem] bg-primary/10 blur-3xl" />
              <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl shadow-primary/10">
                <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-5">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-positive" />
                    <span className="text-xs font-semibold text-muted">{t('preview_badge')}</span>
                  </div>
                  <div className="flex gap-1.5" aria-hidden="true">
                    <span className="h-2 w-2 rounded-full bg-border" />
                    <span className="h-2 w-2 rounded-full bg-border" />
                    <span className="h-2 w-2 rounded-full bg-border" />
                  </div>
                </div>
                <div className="bg-gradient-to-b from-primary-soft/70 to-surface p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold text-primary">{t('preview_eyebrow')}</p>
                      <h2 className="mt-1 text-lg font-bold sm:text-xl">{t('preview_title')}</h2>
                    </div>
                    <div className="rounded-lg bg-surface px-2.5 py-1.5 text-xs font-medium text-muted shadow-sm">{t('preview_realtime')}</div>
                  </div>

                  <div className="mt-5 grid grid-cols-3 gap-2.5 sm:gap-3">
                    <PreviewMetric label={t('preview_cash')} value="217,840" tone="primary" />
                    <PreviewMetric label={t('preview_invoices')} value="63,200" tone="positive" />
                    <PreviewMetric label={t('preview_income')} value="482,500" tone="text" />
                  </div>

                  <div className="mt-4 rounded-xl border border-border bg-surface p-4 shadow-sm">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold">{t('preview_balance')}</p>
                      <BarChart3 className="h-4 w-4 text-primary" aria-hidden="true" />
                    </div>
                    <div className="mt-5 flex h-20 items-end gap-1.5" aria-hidden="true">
                      {[35, 49, 43, 66, 58, 82, 74, 100, 91, 110, 106, 124].map((height, index) => (
                        <span
                          key={index}
                          className="min-w-0 flex-1 rounded-t-sm bg-primary/20 first:bg-primary/55 last:bg-primary"
                          style={{ height: `${height * 0.55}%` }}
                        />
                      ))}
                    </div>
                    <div className="mt-3 flex items-center justify-between text-[11px] text-muted">
                      <span>{t('preview_status')}</span>
                      <span className="font-semibold text-positive">{t('preview_balanced')}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
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
              <div className="rounded-2xl border border-primary/15 bg-primary-soft/70 p-5 text-sm leading-7 text-text">
                <p className="font-bold text-primary">{t('industries_note_title')}</p>
                <p className="mt-1">{t('industries_note')}</p>
              </div>
            </div>
            <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {INDUSTRIES.map((industry) => {
                const Icon = industry.icon;
                return (
                  <article key={industry.title} className="rounded-2xl border border-border bg-background p-5 transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5">
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-soft text-primary"><Icon className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" /></span>
                    <h3 className="mt-5 text-base font-bold">{t(industry.title)}</h3>
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
                  <article key={feature.title} className="group rounded-2xl border border-border bg-background p-5 transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5">
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-soft text-primary">
                      <Icon className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
                    </span>
                    <h3 className="mt-5 text-base font-bold">{t(feature.title)}</h3>
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
            <div className="mt-10 grid gap-4 md:grid-cols-4">
              {JOURNEY.map((step, index) => {
                const Icon = step.icon;
                return (
                  <article key={step.title} className="relative rounded-2xl border border-border bg-background p-5">
                    <span className="absolute end-4 top-4 text-3xl font-bold text-primary/15">0{index + 1}</span>
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-soft text-primary"><Icon className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" /></span>
                    <h3 className="mt-5 text-base font-bold">{t(step.title)}</h3>
                    <p className="mt-2 text-sm leading-6 text-muted">{t(step.desc)}</p>
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
              <div className="mt-8 inline-flex items-end gap-3 rounded-2xl border border-primary/15 bg-primary-soft px-5 py-4">
                <strong className="text-3xl font-bold tracking-tight text-primary">{t('about_stat')}</strong>
                <span className="mb-1 max-w-28 text-xs font-semibold leading-5 text-primary/80">{t('about_stat_label')}</span>
              </div>
            </div>

            <div className="space-y-5">
              <article className="rounded-2xl border border-border bg-surface p-6 sm:p-7">
                <p className="text-sm font-bold text-primary">{t('about_story_title')}</p>
                <h3 className="mt-3 text-xl font-bold sm:text-2xl">{t('about_story_heading')}</h3>
                <p className="mt-4 text-sm leading-7 text-muted sm:text-base">{t('about_story')}</p>
                <div className="mt-5 rounded-xl border-s-4 border-primary bg-primary-soft/60 px-4 py-3 text-sm font-medium leading-7 text-text">
                  {t('about_origin')}
                </div>
              </article>

              <div className="grid gap-4 sm:grid-cols-3">
                {ABOUT_PILLARS.map((pillar) => {
                  const Icon = pillar.icon;
                  return (
                    <article key={pillar.title} className="rounded-2xl border border-border bg-surface p-5">
                      <Icon className="h-5 w-5 text-primary" strokeWidth={1.8} aria-hidden="true" />
                      <h3 className="mt-4 text-sm font-bold">{t(pillar.title)}</h3>
                      <p className="mt-2 text-sm leading-6 text-muted">{t(pillar.desc)}</p>
                    </article>
                  );
                })}
              </div>

              <article className="rounded-2xl bg-text p-6 text-background sm:p-7">
                <p className="text-sm font-bold text-primary">{t('about_vision_title')}</p>
                <p className="mt-3 text-lg font-medium leading-8 text-background/90">{t('about_vision')}</p>
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
                <article key={step} className="rounded-2xl border border-border bg-background p-6">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-white">{index + 1}</span>
                  <h3 className="mt-5 text-base font-bold">{t(`${step}_title`)}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted">{t(`${step}_desc`)}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
          <div className="mx-auto max-w-5xl overflow-hidden rounded-3xl bg-primary px-6 py-10 text-white shadow-xl shadow-primary/20 sm:px-10 sm:py-12">
            <div className="grid items-center gap-8 md:grid-cols-[1fr_auto]">
              <div>
                <ShieldCheck className="h-7 w-7 text-white/85" strokeWidth={1.8} aria-hidden="true" />
                <h2 className="mt-4 text-2xl font-bold leading-tight sm:text-3xl">{t('final_title')}</h2>
                <p className="mt-3 max-w-2xl text-sm leading-7 text-white/75 sm:text-base">{t('final_subtitle')}</p>
              </div>
              <Button
                size="md"
                className="h-11 w-full bg-white px-5 text-base text-primary shadow-md hover:bg-white/90 md:w-auto"
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

function PreviewMetric({ label, value, tone }: { label: string; value: string; tone: 'primary' | 'positive' | 'text' }) {
  const toneClass = tone === 'positive' ? 'text-positive' : tone === 'primary' ? 'text-primary' : 'text-text';
  return (
    <div className="rounded-xl border border-border bg-surface p-3 shadow-sm">
      <p className="truncate text-[10px] font-medium text-muted sm:text-xs">{label}</p>
      <p className={`mt-2 text-sm font-bold tracking-tight sm:text-base ${toneClass}`}>{value}</p>
    </div>
  );
}
