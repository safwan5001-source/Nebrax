'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslations } from 'next-intl';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { LangToggle } from '@/components/layout/lang-toggle';
import { login } from '@/lib/auth';
import { enableDemo } from '@/lib/demo';
import { ApiError } from '@/lib/api';

const schema = z.object({
  slug: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(1),
});

type FormValues = z.infer<typeof schema>;

const BRAND_BULLETS = ['f_zatca_title', 'f_accounting_title', 'f_reports_title'];

export default function LoginPage() {
  const t = useTranslations('login');
  const tl = useTranslations('landing');
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues) {
    setServerError(null);
    try {
      await login(values.slug, values.email, values.password);
      router.replace('/dashboard');
    } catch (e) {
      setServerError(e instanceof ApiError ? e.message : t('error'));
    }
  }

  function enterDemo() {
    enableDemo();
    router.replace('/dashboard');
  }

  return (
    <main className="flex min-h-screen bg-background">
      {/* لوحة الهوية — على الشاشات الكبيرة فقط */}
      <aside className="hidden w-1/2 flex-col justify-between bg-primary p-10 text-white lg:flex">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded bg-white text-sm font-bold text-primary">
            نـ
          </div>
          <span className="text-base font-semibold">نبراس</span>
        </Link>

        <div className="max-w-md">
          <h2 className="text-2xl font-bold leading-snug">{tl('hero_title')}</h2>
          <ul className="mt-6 space-y-3 text-sm text-white/90">
            {BRAND_BULLETS.map((b) => (
              <li key={b} className="flex items-center gap-2">
                <Check className="h-4 w-4 shrink-0" strokeWidth={2} />
                <span>{tl(b)}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-white/70">{tl('footer')}</p>
      </aside>

      {/* لوحة النموذج */}
      <div className="relative flex w-full flex-col justify-center p-4 lg:w-1/2">
        <div className="absolute end-4 top-4 flex items-center gap-1">
          <LangToggle />
          <ThemeToggle />
        </div>

        <div className="mx-auto w-full max-w-sm">
          <Link
            href="/"
            className="mb-6 inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-text"
          >
            <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.7} />
            {t('back_home')}
          </Link>

          {/* الشعار على الجوال (لوحة الهوية مخفية) */}
          <div className="mb-5 flex items-center gap-2 lg:hidden">
            <div className="flex h-9 w-9 items-center justify-center rounded bg-primary text-sm font-bold text-white">
              نـ
            </div>
            <span className="text-base font-semibold text-text">نبراس</span>
          </div>

          <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>

          <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="slug">{t('slug')}</Label>
              <Input id="slug" dir="ltr" placeholder="nibras" {...register('slug')} />
              {errors.slug && <p className="text-xs text-negative">{t('slug')}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">{t('email')}</Label>
              <Input id="email" type="email" dir="ltr" placeholder="owner@nibras.test" {...register('email')} />
              {errors.email && <p className="text-xs text-negative">{t('email')}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">{t('password')}</Label>
              <Input id="password" type="password" dir="ltr" {...register('password')} />
              {errors.password && <p className="text-xs text-negative">{t('password')}</p>}
            </div>

            {serverError && (
              <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{serverError}</p>
            )}

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {t('submit')}
            </Button>
          </form>

          <div className="mt-4 border-t border-border pt-4">
            <Button type="button" variant="outline" className="w-full text-muted" onClick={enterDemo}>
              <ArrowLeft className="h-4 w-4" strokeWidth={1.7} />
              {t('demo')}
            </Button>
            <p className="mt-1.5 text-center text-xs text-muted">{t('demo_hint')}</p>
          </div>
        </div>
      </div>
    </main>
  );
}
