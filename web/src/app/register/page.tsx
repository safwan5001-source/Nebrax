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
import { register as registerTenant } from '@/lib/auth';
import { ApiError } from '@/lib/api';

const schema = z.object({
  company_name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(6),
  slug: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/),
  password: z.string().min(8),
});

type FormValues = z.infer<typeof schema>;

export default function RegisterPage() {
  const t = useTranslations('register');
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
      await registerTenant({
        company_name: values.company_name,
        slug: values.slug,
        email: values.email,
        password: values.password,
        phone: '+966' + values.phone.replace(/^0+/, ''),
      });
      router.replace('/dashboard');
    } catch (e) {
      setServerError(e instanceof ApiError ? e.message : t('error'));
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-background p-4">
      <div className="absolute end-4 top-4 flex items-center gap-1">
        <LangToggle />
        <ThemeToggle />
      </div>

      <div className="w-full max-w-md py-10">
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
            {/* الاسم التجاري */}
            <Input
              aria-label={t('company_name')}
              className="h-11 text-base"
              placeholder={t('company_name') + ' *'}
              {...register('company_name')}
            />
            {/* البريد الإلكتروني */}
            <Input
              aria-label={t('email')}
              type="email"
              dir="ltr"
              className="h-11 text-base"
              placeholder={t('email') + ' *'}
              {...register('email')}
            />
            {/* رقم الجوال مع مفتاح الدولة */}
            <div className="flex h-11 items-center overflow-hidden rounded border border-border bg-surface focus-within:ring-2 focus-within:ring-primary/40">
              <span className="shrink-0 border-e border-border bg-background px-3 text-sm text-muted" dir="ltr">
                🇸🇦 +966
              </span>
              <input
                aria-label={t('phone')}
                dir="ltr"
                inputMode="numeric"
                className="num h-full w-full bg-transparent px-3 text-base text-text placeholder:text-muted focus:outline-none"
                placeholder={t('phone') + ' *'}
                {...register('phone')}
              />
            </div>
            {errors.phone && <p className="text-xs text-negative">{t('phone_invalid')}</p>}
            {/* صفحة الدخول (المعرّف) بلاحقة نطاق */}
            <div className="flex h-11 items-center overflow-hidden rounded border border-border bg-surface focus-within:ring-2 focus-within:ring-primary/40">
              <span className="shrink-0 border-e border-border bg-background px-3 text-sm text-muted" dir="ltr">
                .nebrax.app
              </span>
              <input
                aria-label={t('slug')}
                dir="ltr"
                className="h-full w-full bg-transparent px-3 text-base text-text placeholder:text-muted focus:outline-none"
                placeholder={t('slug') + ' *'}
                {...register('slug')}
              />
            </div>
            {errors.slug && <p className="text-xs text-negative">{t('slug_invalid')}</p>}
            {/* كلمة المرور */}
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
            {errors.password && <p className="text-xs text-negative">{t('password_hint')}</p>}

            {serverError && (
              <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{serverError}</p>
            )}

            <Button type="submit" className="h-11 w-full text-base" disabled={isSubmitting}>
              {t('submit')}
            </Button>
            <p className="text-center text-[11px] text-muted">{t('terms')}</p>
          </form>
        </div>

        {/* روابط أسفل البطاقة */}
        <p className="mt-6 text-center text-sm text-muted">
          {t('have_account')}{' '}
          <Link href="/login" className="font-medium text-primary hover:underline">
            {t('login_link')}
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
