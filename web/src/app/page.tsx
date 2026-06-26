'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  QrCode,
  BookOpen,
  Store,
  Package,
  UserCog,
  BarChart3,
  ArrowLeft,
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

export default function LandingPage() {
  const t = useTranslations('landing');
  const router = useRouter();

  function enterDemo() {
    enableDemo();
    router.push('/dashboard');
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-text">
      {/* الشريط العلوي */}
      <header className="sticky top-0 z-10 border-b border-border bg-surface/80 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-4 sm:px-6">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-primary text-sm font-bold text-white">
            نـ
          </div>
          <span className="text-sm font-semibold">نبراس</span>
          <div className="ms-auto flex items-center gap-1">
            <LangToggle />
            <ThemeToggle />
            <Link href="/login">
              <Button size="sm">{t('cta_login')}</Button>
            </Link>
          </div>
        </div>
      </header>

      {/* البطل */}
      <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="max-w-2xl">
          <p className="mb-3 text-sm font-medium text-primary">{t('tagline')}</p>
          <h1 className="text-3xl font-bold leading-tight sm:text-4xl">{t('hero_title')}</h1>
          <p className="mt-4 text-base leading-relaxed text-muted sm:text-lg">{t('hero_subtitle')}</p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <Link href="/login">
              <Button className="w-full sm:w-auto">{t('cta_login')}</Button>
            </Link>
            <Button variant="outline" className="w-full sm:w-auto" onClick={enterDemo}>
              <ArrowLeft className="h-4 w-4" strokeWidth={1.7} />
              {t('cta_demo')}
            </Button>
          </div>
        </div>
      </section>

      {/* الوحدات */}
      <section className="border-t border-border bg-surface">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="text-xl font-semibold sm:text-2xl">{t('features_title')}</h2>
          <p className="mt-2 text-sm text-muted">{t('features_subtitle')}</p>

          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => {
              const Icon = f.icon;
              return (
                <div key={f.title} className="rounded border border-border bg-background p-5">
                  <Icon className="h-6 w-6 text-primary" strokeWidth={1.6} />
                  <h3 className="mt-3 font-medium">{t(f.title)}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted">{t(f.desc)}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* التذييل */}
      <footer className="mt-auto border-t border-border">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 text-xs text-muted sm:px-6">
          {t('footer')}
        </div>
      </footer>
    </div>
  );
}
