'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, EyeOff, LoaderCircle, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { AuthShell } from '@/components/auth/auth-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { platformLogin } from '@/lib/platform-auth';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

type FormValues = z.infer<typeof schema>;

export default function PlatformLoginPage() {
  const t = useTranslations('platformLogin');
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues) {
    setServerError(null);
    try {
      await platformLogin(values.email, values.password);
      router.replace('/platform');
    } catch (error) {
      setServerError(error instanceof ApiError ? error.message : t('error'));
    }
  }

  return (
    <AuthShell>
      <section className="border border-border bg-surface p-5 shadow-sm sm:p-8" aria-labelledby="platform-login-title">
        <header className="text-center">
          <ShieldCheck className="mx-auto h-7 w-7 text-primary" strokeWidth={1.7} aria-hidden="true" />
          <h1 id="platform-login-title" className="mt-3 text-2xl font-bold tracking-tight text-text sm:text-[1.7rem]">
            {t('title')}
          </h1>
          <p className="mt-1.5 text-sm text-muted">{t('subtitle')}</p>
        </header>

        <p className="mt-5 border border-border bg-background px-3 py-2 text-xs leading-relaxed text-muted">
          {t('notice')}
        </p>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-5 space-y-4">
          <div>
            <label htmlFor="platform-login-email" className="mb-1.5 block text-sm font-semibold text-text">
              {t('email')} <span className="text-muted" aria-hidden="true">*</span>
            </label>
            <Input
              id="platform-login-email"
              type="email"
              dir="ltr"
              autoComplete="email"
              className="h-12 text-base"
              placeholder="ops@nebrax.sa"
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? 'platform-login-email-error' : undefined}
              {...register('email')}
            />
            {errors.email && <p id="platform-login-email-error" className="mt-1.5 text-xs text-negative" role="alert">{t('emailInvalid')}</p>}
          </div>

          <div>
            <label htmlFor="platform-login-password" className="mb-1.5 block text-sm font-semibold text-text">
              {t('password')} <span className="text-muted" aria-hidden="true">*</span>
            </label>
            <div className="relative">
              <Input
                id="platform-login-password"
                type={showPassword ? 'text' : 'password'}
                dir="auto"
                autoComplete="current-password"
                className="h-12 ps-11 text-base"
                placeholder={t('password')}
                aria-invalid={Boolean(errors.password)}
                aria-describedby={errors.password ? 'platform-login-password-error' : undefined}
                {...register('password')}
              />
              <button
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? t('hidePassword') : t('showPassword')}
                className="absolute start-0 top-0 flex h-12 w-11 items-center justify-center text-muted transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                {showPassword ? <EyeOff className="h-[18px] w-[18px]" strokeWidth={1.7} /> : <Eye className="h-[18px] w-[18px]" strokeWidth={1.7} />}
              </button>
            </div>
            {errors.password && <p id="platform-login-password-error" className="mt-1.5 text-xs text-negative" role="alert">{t('passwordRequired')}</p>}
          </div>

          {serverError && <p className="border border-negative/20 bg-negative/10 px-3 py-2 text-xs text-negative" role="alert">{serverError}</p>}

          <Button type="submit" className="h-12 w-full text-base" disabled={isSubmitting} aria-busy={isSubmitting}>
            {isSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {isSubmitting ? t('submitting') : t('submit')}
          </Button>
        </form>
      </section>

      <footer className="pt-5 text-center">
        <Link href="/login" className="text-sm font-semibold text-primary hover:text-primary-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
          {t('tenantLogin')}
        </Link>
      </footer>
    </AuthShell>
  );
}
