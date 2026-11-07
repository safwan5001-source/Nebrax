'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslations } from 'next-intl';
import { AlertCircle, Eye, EyeOff, LoaderCircle } from 'lucide-react';
import { AuthShell } from '@/components/auth/auth-shell';
import { DemoLoginButton } from '@/components/auth/demo-login-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { checkStoredSession, landingPathFor, login } from '@/lib/auth';
import { isDemo } from '@/lib/demo';
import { ApiError } from '@/lib/api';
import { startDemoSession } from '@/lib/demo-session';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  remember: z.boolean().optional(),
});

type FormValues = z.infer<typeof schema>;

export default function LoginPage() {
  const t = useTranslations('login');
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [showPw, setShowPw] = useState(false);
  // الدخول التجريبي والحقيقي متنافيان. المرجع متزامن (يقرؤه استمرار `await login()`)، والحالة لتعطيل الواجهة.
  const demoStartedRef = useRef(false);
  const [demoStarted, setDemoStarted] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  // جلسة محفوظة صالحة: لا نعرض نموذج الدخول — نتحقق عبر /me ثم نحوّل. التسابق: أي تفاعل (دخول/معاينة) يُبطل النتيجة.
  const interactedRef = useRef(false);
  const [restoring, setRestoring] = useState(false);
  const routerRef = useRef(router);
  routerRef.current = router;
  useEffect(() => {
    if (isDemo() || !localStorage.getItem('token')) return;
    let cancelled = false;
    setRestoring(true);
    checkStoredSession().then((result) => {
      if (cancelled || interactedRef.current) return;
      if (result.status === 'valid') routerRef.current.replace(landingPathFor(result.user.role));
      else setRestoring(false);
    });
    return () => { cancelled = true; };
  }, []);

  function onDemoStart() {
    interactedRef.current = true;
    demoStartedRef.current = true;
    setDemoStarted(true);
  }

  async function onSubmit(values: FormValues) {
    interactedRef.current = true;
    if (demoStartedRef.current) return; // اختار المستخدم المعاينة: لا تسجيل دخول حقيقي بعدها
    setServerError(null);
    try {
      const user = await login(values.email, values.password, values.remember === true);
      if (demoStartedRef.current) {
        // بدأت المعاينة أثناء الطلب المعلّق (الواجهة تمنعه، وهذا شبكة أمان للتسابق): `login()` كتب للتوّ توكن
        // الحساب الحقيقي ومستخدمه، فتُمسح وتُعاد المعاينة نظيفة بدل أن تنتهي الجلسة على المستأجر الحقيقي.
        startDemoSession();
        return;
      }
      // دور الخدمة الذاتية بلا صلاحياتٍ على شاشات الإدارة — بوابته المخصَّصة.
      router.replace(landingPathFor(user.role));
    } catch (error) {
      if (demoStartedRef.current) return; // فشل طلب متأخر لا يُظهر خطأً فوق المعاينة
      setServerError(error instanceof ApiError ? error.message : t('error'));
    }
  }

  if (restoring) {
    return (
      <AuthShell experience="login">
        <div role="status" aria-live="polite" className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
          <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
          {t('restoring')}
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell experience="login">
      <section className="ax-card" aria-labelledby="login-title">
        <header className="text-center lg:text-start">
          <h1 id="login-title" className="font-bold tracking-tight text-text">
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
              className="ax-input"
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
                className="ax-input ps-12"
                placeholder={t('password')}
                aria-invalid={Boolean(errors.password)}
                aria-describedby={errors.password ? 'login-password-error' : undefined}
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
            {errors.password && <p id="login-password-error" className="mt-1.5 text-xs text-negative" role="alert">{t('password_invalid')}</p>}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-text">
              <input type="checkbox" className="ax-check" {...register('remember')} />
              {t('remember')}
            </label>
            <Link href="/forgot-password" className="ax-link inline-flex min-h-11 items-center text-sm">
              {t('forgot_link')}
            </Link>
          </div>

          {serverError && (
            <p className="ax-alert" role="alert">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              {serverError}
            </p>
          )}

          <Button type="submit" className="ax-submit w-full" disabled={isSubmitting || demoStarted} aria-busy={isSubmitting}>
            {isSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {isSubmitting ? t('submitting') : t('submit')}
          </Button>
        </form>

        <DemoLoginButton disabled={isSubmitting || demoStarted} onStart={onDemoStart} />
      </section>

      <footer className="pt-6 text-center">
        <p className="text-sm text-muted">
          {t('no_account')}{' '}
          <Link href="/register" className="ax-link">
            {t('register_link')}
          </Link>
        </p>
        <Link href="/" className="mt-2 inline-flex min-h-11 items-center text-xs text-muted hover:text-text hover:underline">
          {t('back_home')}
        </Link>
      </footer>
    </AuthShell>
  );
}
