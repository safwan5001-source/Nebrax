'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslations } from 'next-intl';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

export default function LoginPage() {
  const t = useTranslations('login');
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [showPw, setShowPw] = useState(false);
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
    <main className="relative flex min-h-screen items-center justify-center bg-background p-4">
      <div className="absolute end-4 top-4 flex items-center gap-1">
        <LangToggle />
        <ThemeToggle />
      </div>

      <div className="w-full max-w-md">
        {/* الشعار */}
        <Link href="/" className="mb-6 flex items-center justify-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-base font-bold text-white">
            نـ
          </div>
          <span className="text-lg font-semibold text-text">نبراس</span>
        </Link>

        {/* البطاقة */}
        <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm sm:p-8">
          <h1 className="text-center text-2xl font-bold text-text">{t('title')}</h1>
          <p className="mt-1 text-center text-sm text-muted">{t('subtitle')}</p>

          <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-3">
            <Input
              aria-label={t('slug')}
              dir="ltr"
              className="h-11 text-base"
              placeholder={t('slug') + ' *'}
              {...register('slug')}
            />
            <Input
              aria-label={t('email')}
              type="email"
              dir="ltr"
              className="h-11 text-base"
              placeholder={t('email') + ' *'}
              {...register('email')}
            />
            <div className="relative">
              <Input
                aria-label={t('password')}
                type={showPw ? 'text' : 'password'}
                dir="ltr"
                className="h-11 pe-10 text-base"
                placeholder={t('password') + ' *'}
                {...register('password')}
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? t('hide_pw') : t('show_pw')}
                className="absolute inset-y-0 end-0 flex items-center px-3 text-muted hover:text-text"
              >
                {showPw ? <EyeOff className="h-4 w-4" strokeWidth={1.7} /> : <Eye className="h-4 w-4" strokeWidth={1.7} />}
              </button>
            </div>

            {(errors.slug || errors.email || errors.password) && (
              <p className="text-xs text-negative">{t('required_hint')}</p>
            )}
            {serverError && (
              <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{serverError}</p>
            )}

            <Button type="submit" className="h-11 w-full text-base" disabled={isSubmitting}>
              {t('submit')}
            </Button>
          </form>

          <div className="mt-5 flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted">{t('or')}</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <Button type="button" variant="outline" className="mt-4 h-11 w-full text-muted" onClick={enterDemo}>
            {t('demo')}
          </Button>
          <p className="mt-1.5 text-center text-xs text-muted">{t('demo_hint')}</p>
        </div>

        {/* روابط أسفل البطاقة */}
        <p className="mt-6 text-center text-sm text-muted">
          {t('no_account')}{' '}
          <Link href="/register" className="font-medium text-primary hover:underline">
            {t('register_link')}
          </Link>
        </p>
        <p className="mt-2 text-center">
          <Link href="/" className="text-xs text-muted hover:text-text">
            {t('back_home')}
          </Link>
        </p>
      </div>
    </main>
  );
}
