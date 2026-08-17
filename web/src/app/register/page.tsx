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
import { register as registerTenant } from '@/lib/auth';
import { ApiError } from '@/lib/api';

const schema = z.object({
  company_name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().regex(/^5\d{8}$/),
  slug: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/),
  password: z.string().min(8),
});

type FormValues = z.infer<typeof schema>;

function SaudiFlag() {
  return (
    <svg className="h-4 w-6 shrink-0 rounded-[2px] shadow-[0_0_0_1px_rgb(0_0_0_/_0.1)]" viewBox="0 0 28 18" aria-hidden="true" focusable="false">
      <rect width="28" height="18" rx="1.5" fill="var(--flag-saudi)" />
      <path d="M6.2 5.7h15.6M7.4 8.1h13.2M8.3 10.4h11.4" stroke="var(--flag-mark)" strokeWidth="1.25" strokeLinecap="round" />
      <path d="M7.2 13.5c4.45.76 9.12.76 13.6 0" stroke="var(--flag-mark)" strokeWidth="1.15" strokeLinecap="round" />
    </svg>
  );
}

export default function RegisterPage() {
  const t = useTranslations('register');
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [showPw, setShowPw] = useState(false);
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });
  const password = watch('password', '');
  const passwordScore = [password.length >= 8, /[A-Z]/.test(password), /\d/.test(password), /[^A-Za-z0-9]/.test(password)].filter(Boolean).length;
  const passwordLabels = [t('strength_weak'), t('strength_fair'), t('strength_good'), t('strength_strong')];

  async function onSubmit(values: FormValues) {
    setServerError(null);
    try {
      await registerTenant({
        company_name: values.company_name,
        slug: values.slug,
        email: values.email,
        password: values.password,
        phone: '+966' + values.phone.replace(/^0+/, ''),
      });
      router.replace('/dashboard');
    } catch (error) {
      setServerError(error instanceof ApiError ? error.message : t('error'));
    }
  }

  return (
    <AuthShell>
      <section className="border border-border bg-surface p-5 shadow-sm sm:p-8" aria-labelledby="register-title">
        <header className="text-center">
          <h1 id="register-title" className="text-2xl font-bold tracking-tight text-text sm:text-[1.7rem]">
            {t('title')}
          </h1>
          <p className="mt-1.5 text-sm text-muted">{t('subtitle')}</p>
        </header>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-7 space-y-4">
          <div>
            <label htmlFor="register-name" className="mb-1.5 block text-sm font-semibold text-text">
              {t('company_name')} <span className="text-muted" aria-hidden="true">*</span>
            </label>
            <Input
              id="register-name"
              autoComplete="organization"
              className="h-12 text-base"
              placeholder={t('company_name_ph')}
              aria-invalid={Boolean(errors.company_name)}
              aria-describedby={errors.company_name ? 'register-name-error' : undefined}
              {...register('company_name')}
            />
            {errors.company_name && <p id="register-name-error" className="mt-1.5 text-xs text-negative" role="alert">{t('field_required')}</p>}
          </div>

          <div>
            <label htmlFor="register-email" className="mb-1.5 block text-sm font-semibold text-text">
              {t('email')} <span className="text-muted" aria-hidden="true">*</span>
            </label>
            <Input
              id="register-email"
              type="email"
              dir="ltr"
              autoComplete="email"
              className="h-12 text-base"
              placeholder="name@company.com"
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? 'register-email-error' : undefined}
              {...register('email')}
            />
            {errors.email && <p id="register-email-error" className="mt-1.5 text-xs text-negative" role="alert">{t('email_invalid')}</p>}
          </div>

          <div>
            <label htmlFor="register-phone" className="mb-1.5 block text-sm font-semibold text-text">
              {t('phone')} <span className="text-muted" aria-hidden="true">*</span>
            </label>
            <div className="flex h-12 overflow-hidden border border-border bg-surface transition-shadow focus-within:ring-2 focus-within:ring-primary/40">
              <span className="flex shrink-0 items-center gap-1.5 border-e border-border bg-background px-2.5 text-sm text-muted" dir="ltr" aria-label={`${t('phone_country')} +966`}>
                <SaudiFlag />
                <span className="font-semibold text-text" lang="ar" dir="rtl">{t('phone_country')}</span>
                <span>+966</span>
              </span>
              <input
                id="register-phone"
                dir="ltr"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                maxLength={9}
                className="num h-full w-full bg-transparent px-3 text-base text-text placeholder:text-muted focus:outline-none"
                placeholder="5X XXX XXXX"
                aria-invalid={Boolean(errors.phone)}
                aria-describedby={errors.phone ? 'register-phone-error' : undefined}
                {...register('phone')}
              />
            </div>
            {errors.phone && <p id="register-phone-error" className="mt-1.5 text-xs text-negative" role="alert">{t('phone_invalid')}</p>}
          </div>

          <div>
            <label htmlFor="register-slug" className="mb-1.5 block text-sm font-semibold text-text">
              {t('slug')} <span className="text-muted" aria-hidden="true">*</span>
            </label>
            <div className="flex h-12 overflow-hidden border border-border bg-surface transition-shadow focus-within:ring-2 focus-within:ring-primary/40" dir="ltr">
              <input
                id="register-slug"
                className="h-full w-full bg-transparent px-3 text-base text-text placeholder:text-muted focus:outline-none"
                autoComplete="off"
                spellCheck="false"
                placeholder="myaccount"
                aria-invalid={Boolean(errors.slug)}
                aria-describedby={errors.slug ? 'register-slug-error' : 'register-slug-hint'}
                {...register('slug')}
              />
              <span className="flex shrink-0 items-center border-s border-border bg-background px-3 text-sm text-muted">.nebrax.app</span>
            </div>
            {errors.slug ? <p id="register-slug-error" className="mt-1.5 text-xs text-negative" role="alert">{t('slug_invalid')}</p> : <p id="register-slug-hint" className="mt-1.5 text-xs text-muted">{t('slug_hint')}</p>}
          </div>

          <div>
            <label htmlFor="register-password" className="mb-1.5 block text-sm font-semibold text-text">
              {t('password')} <span className="text-muted" aria-hidden="true">*</span>
            </label>
            <div className="relative">
              <Input
                id="register-password"
                type={showPw ? 'text' : 'password'}
                dir="auto"
                autoComplete="new-password"
                className="h-12 ps-11 text-base"
                placeholder={t('password')}
                aria-invalid={Boolean(errors.password)}
                aria-describedby={errors.password ? 'register-password-error' : 'register-password-strength'}
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
            {errors.password ? (
              <p id="register-password-error" className="mt-1.5 text-xs text-negative" role="alert">{t('password_hint')}</p>
            ) : (
              <div id="register-password-strength" className="mt-1.5 flex min-h-4 items-center justify-between gap-3 text-xs text-muted" aria-live="polite">
                <span className="flex flex-1 gap-1" aria-hidden="true">
                  {[1, 2, 3, 4].map((segment) => <i key={segment} className={`h-1 flex-1 bg-border ${segment <= passwordScore ? 'bg-primary' : ''}`} />)}
                </span>
                <span>{password ? `${t('password_strength')}: ${passwordLabels[Math.max(passwordScore - 1, 0)]}` : ''}</span>
              </div>
            )}
          </div>

          {serverError && <p className="border border-negative/20 bg-negative/10 px-3 py-2 text-xs text-negative" role="alert">{serverError}</p>}

          <p className="text-center text-xs leading-5 text-muted">{t('terms')}</p>
          <Button type="submit" className="h-12 w-full text-base" disabled={isSubmitting} aria-busy={isSubmitting}>
            {isSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {isSubmitting ? t('submitting') : t('submit')}
          </Button>
        </form>
      </section>

      <footer className="pt-5 text-center">
        <p className="text-sm text-muted">
          {t('have_account')}{' '}
          <Link href="/login" className="font-semibold text-primary hover:text-primary-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
            {t('login_link')}
          </Link>
        </p>
        <Link href="/" className="mt-2 inline-block text-xs text-muted hover:text-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
          {t('back_home')}
        </Link>
      </footer>
    </AuthShell>
  );
}
