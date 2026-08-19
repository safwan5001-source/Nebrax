'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslations } from 'next-intl';
import { Eye, EyeOff, LoaderCircle } from 'lucide-react';
import { AuthShell } from '@/components/auth/auth-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { login } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { enableDemo } from '@/lib/demo';

const schema = z.object({
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
      await login(values.email, values.password);
      router.replace('/dashboard');
    } catch (error) {
      setServerError(error instanceof ApiError ? error.message : t('error'));
    }
  }

  function enterDemo() {
    enableDemo();
    router.replace('/dashboard');
  }

  return (
    <AuthShell>
      <section className="border border-border bg-surface p-5 shadow-sm sm:p-8" aria-labelledby="login-title">
        <header className="text-center">
          <h1 id="login-title" className="text-2xl font-bold tracking-tight text-text sm:text-[1.7rem]">
            {t('title')}
          </h1>
          <p className="mt-1.5 text-sm text-muted">{t('subtitle')}</p>
        </header>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-7 space-y-4">
          <div>
            <label htmlFor="login-email" className="mb-1.5 block text-sm font-semibold text-text">
              {t('email')} <span className="text-muted" aria-hidden="true">*</span>
            </label>
            <Input
              id="login-email"
              type="email"
              dir="ltr"
              autoComplete="email"
              className="h-12 text-base"
              placeholder="name@company.com"
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? 'login-email-error' : undefined}
              {...register('email')}
            />
            {errors.email && <p id="login-email-error" className="mt-1.5 text-xs text-negative" role="alert">{t('email_invalid')}</p>}
          </div>

          <div>
            <label htmlFor="login-password" className="mb-1.5 block text-sm font-semibold text-text">
              {t('password')} <span className="text-muted" aria-hidden="true">*</span>
            </label>
            <div className="relative">
              <Input
                id="login-password"
                type={showPw ? 'text' : 'password'}
                dir="auto"
                autoComplete="current-password"
                className="h-12 ps-11 text-base"
                placeholder={t('password')}
                aria-invalid={Boolean(errors.password)}
                aria-describedby={errors.password ? 'login-password-error' : undefined}
                {...register('password')}
              />
              <button
                type="button"
                onClick={() => setShowPw((visible) => !visible)}
                aria-label={showPw ? t('hide_pw') : t('show_pw')}
                className="absolute start-0 top-0 flex h-12 w-11 items-center justify-center text-muted transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                {showPw ? <EyeOff className="h-[18px] w-[18px]" strokeWidth={1.7} /> : <Eye className="h-[18px] w-[18px]" strokeWidth={1.7} />}
              </button>
            </div>
            {errors.password && <p id="login-password-error" className="mt-1.5 text-xs text-negative" role="alert">{t('password_invalid')}</p>}
          </div>

          {serverError && <p className="border border-negative/20 bg-negative/10 px-3 py-2 text-xs text-negative" role="alert">{serverError}</p>}

          <Button type="submit" className="h-12 w-full text-base" disabled={isSubmitting} aria-busy={isSubmitting}>
            {isSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {isSubmitting ? t('submitting') : t('submit')}
          </Button>
        </form>

        <div className="my-5 flex items-center gap-3 text-xs text-muted" aria-hidden="true">
          <span className="h-px flex-1 bg-border" />
          <span>{t('or')}</span>
          <span className="h-px flex-1 bg-border" />
        </div>
        <Button type="button" variant="outline" className="h-11 w-full" onClick={enterDemo} disabled={isSubmitting}>
          {t('demo')}
        </Button>
        <p className="mt-2 text-center text-xs text-muted">{t('demo_hint')}</p>
      </section>

      <footer className="pt-5 text-center">
        <p className="text-sm text-muted">
          {t('no_account')}{' '}
          <Link href="/register" className="font-semibold text-primary hover:text-primary-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
            {t('register_link')}
          </Link>
        </p>
        <Link href="/" className="mt-2 inline-block text-xs text-muted hover:text-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
          {t('back_home')}
        </Link>
      </footer>
    </AuthShell>
  );
}
