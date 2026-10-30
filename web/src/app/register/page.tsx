'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslations } from 'next-intl';
import { AlertCircle, Eye, EyeOff, LoaderCircle } from 'lucide-react';
import { AuthShell } from '@/components/auth/auth-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { register as registerTenant } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { isReservedTenantSlug, isTenantSubdomainHost, tenantHostFor, tenantHostSuffix } from '@/lib/tenant-domain';

const schema = z.object({
  company_name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().regex(/^5\d{8}$/),
  slug: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/).refine((value) => !isReservedTenantSlug(value), { message: 'reserved' }),
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
      const result = await registerTenant({
        company_name: values.company_name,
        slug: values.slug.toLowerCase(),
        email: values.email,
        password: values.password,
        phone: '+966' + values.phone.replace(/^0+/, ''),
      });

      // TENANT-PROVISIONING-E2E-1: التسجيل يصل من نطاق فرعي عام غير محسوم
      // (`test.{base}` — استثناء PR #845)، لا من نطاق المستأجر الجديد
      // (`{slug}.{base}`). البقاء على النطاق الحالي (SPA) كان يترك كل طلب
      // لاحق (بما فيه قائمة متاجر Commerce Workspace) يفشل مغلقاً 404 لأن
      // `test` لا يحسم مستأجراً حقيقياً أبداً. الانتقال هنا حصراً حين يكون
      // المتصفح فعلاً في وضع النطاقات الفرعية (`isTenantSubdomainHost`) —
      // في التطوير المحلي العادي (`localhost:3000` بلا نطاق فرعي) يبقى
      // السلوك الحالي (`router.replace`) كما هو تماماً، بلا أي تغيير.
      const targetHost = tenantHostFor(result.tenant.slug);
      const currentHost = typeof window !== 'undefined' ? window.location.hostname : null;
      if (
        result.handoffCode
        && currentHost !== null
        && isTenantSubdomainHost(currentHost)
        && currentHost.toLowerCase() !== targetHost
      ) {
        window.location.assign(
          `${window.location.protocol}//${targetHost}/auth/handoff?code=${encodeURIComponent(result.handoffCode)}`,
        );
        return;
      }

      router.replace('/dashboard');
    } catch (error) {
      setServerError(error instanceof ApiError ? error.message : t('error'));
    }
  }

  return (
    <AuthShell experience="register">
      <section className="ax-card" aria-labelledby="register-title">
        <header className="text-center lg:text-start">
          <h1 id="register-title" className="font-bold tracking-tight text-text">
            {t('title')}
          </h1>
          <p className="mt-1.5 text-sm text-muted">{t('subtitle')}</p>
        </header>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-7 space-y-4">
          <fieldset className="ax-group">
            <legend>{t('section_company')}</legend>
            <div>
              <label htmlFor="register-name" className="mb-1.5 block text-sm font-semibold text-text">
                {t('company_name')} <span className="text-muted" aria-hidden="true">*</span>
              </label>
              <Input
                id="register-name"
                autoComplete="organization"
                className="ax-input"
                placeholder={t('company_name_ph')}
                aria-invalid={Boolean(errors.company_name)}
                aria-describedby={errors.company_name ? 'register-name-error' : undefined}
                {...register('company_name')}
              />
              {errors.company_name && <p id="register-name-error" className="mt-1.5 text-xs text-negative" role="alert">{t('field_required')}</p>}
            </div>

            <div>
              <label htmlFor="register-slug" className="mb-1.5 block text-sm font-semibold text-text">
                {t('slug')} <span className="text-muted" aria-hidden="true">*</span>
              </label>
              <div data-invalid={Boolean(errors.slug) || undefined} className="ax-affix flex" dir="ltr">
                <input
                  id="register-slug"
                  className="h-full w-full bg-transparent px-3 text-text placeholder:text-muted focus:outline-none"
                  autoComplete="off"
                  spellCheck="false"
                  placeholder="myaccount"
                  aria-invalid={Boolean(errors.slug)}
                  aria-describedby={errors.slug ? 'register-slug-error' : 'register-slug-hint'}
                  {...register('slug')}
                />
                <span className="flex shrink-0 items-center border-s px-3 text-sm text-muted">{tenantHostSuffix()}</span>
              </div>
              {errors.slug ? <p id="register-slug-error" className="mt-1.5 text-xs text-negative" role="alert">{errors.slug.message === 'reserved' ? t('slug_reserved') : t('slug_invalid')}</p> : <p id="register-slug-hint" className="mt-1.5 text-xs text-muted">{t('slug_hint')}</p>}
            </div>
          </fieldset>

          <fieldset className="ax-group">
            <legend>{t('section_account')}</legend>
            <div>
              <label htmlFor="register-email" className="mb-1.5 block text-sm font-semibold text-text">
                {t('email')} <span className="text-muted" aria-hidden="true">*</span>
              </label>
              <Input
                id="register-email"
                type="email"
                dir="ltr"
                autoComplete="email"
                className="ax-input"
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
              <div data-invalid={Boolean(errors.phone) || undefined} className="ax-affix flex">
                <span className="flex shrink-0 items-center gap-1.5 border-e px-2.5 text-sm text-muted" dir="ltr" aria-label={`${t('phone_country')} +966`}>
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
                  className="num h-full w-full bg-transparent px-3 text-text placeholder:text-muted focus:outline-none"
                  placeholder="5X XXX XXXX"
                  aria-invalid={Boolean(errors.phone)}
                  aria-describedby={errors.phone ? 'register-phone-error' : undefined}
                  {...register('phone')}
                />
              </div>
              {errors.phone && <p id="register-phone-error" className="mt-1.5 text-xs text-negative" role="alert">{t('phone_invalid')}</p>}
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
                  className="ax-input ps-12"
                  placeholder={t('password')}
                  aria-invalid={Boolean(errors.password)}
                  aria-describedby={errors.password ? 'register-password-error' : password ? 'register-password-strength' : undefined}
                  {...register('password')}
                />
                <button
                  type="button"
                  onClick={() => setShowPw((visible) => !visible)}
                  aria-label={showPw ? t('hide_pw') : t('show_pw')}
                  className="absolute start-0 top-0 flex h-[50px] w-12 items-center justify-center rounded-s-xl text-muted transition-colors hover:text-text"
                >
                  {showPw ? <EyeOff className="h-[18px] w-[18px]" strokeWidth={1.7} /> : <Eye className="h-[18px] w-[18px]" strokeWidth={1.7} />}
                </button>
              </div>
              {errors.password ? (
                <p id="register-password-error" className="mt-1.5 text-xs text-negative" role="alert">{t('password_hint')}</p>
              ) : password ? (
                <div id="register-password-strength" className="ax-strength mt-2 flex min-h-4 items-center justify-between gap-3 text-xs text-muted" aria-live="polite">
                  <span className="flex flex-1 gap-1" aria-hidden="true">
                    {[1, 2, 3, 4].map((segment) => <i key={segment} className={`h-1.5 flex-1 bg-border ${segment <= passwordScore ? 'bg-primary' : ''}`} />)}
                  </span>
                  <span>{password ? `${t('password_strength')}: ${passwordLabels[Math.max(passwordScore - 1, 0)]}` : ''}</span>
                </div>
              ) : (
                <p className="mt-1.5 text-xs text-muted">{t('password_hint')}</p>
              )}
            </div>
          </fieldset>

          {serverError && (
            <p className="ax-alert" role="alert">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              {serverError}
            </p>
          )}

          <Button type="submit" className="ax-submit w-full" disabled={isSubmitting} aria-busy={isSubmitting}>
            {isSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {isSubmitting ? t('submitting') : t('submit')}
          </Button>
        </form>
      </section>

      <footer className="pt-6 text-center">
        <p className="text-sm text-muted">
          {t('have_account')}{' '}
          <Link href="/login" className="ax-link">
            {t('login_link')}
          </Link>
        </p>
        <Link href="/" className="mt-2 inline-flex min-h-11 items-center text-xs text-muted hover:text-text hover:underline">
          {t('back_home')}
        </Link>
      </footer>
    </AuthShell>
  );
}
