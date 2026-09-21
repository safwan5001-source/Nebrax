'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AuthShell } from '@/components/auth/auth-shell';
import { ApiError, api, setToken } from '@/lib/api';
import { notifyAuthSessionChanged, persistUser, type AuthUser } from '@/lib/auth';

/**
 * TENANT-PROVISIONING-E2E-1 — تستهلك رمز الانتقال أحادي الاستخدام الصادر من
 * `/register` بعد الانتقال الكامل (cross-origin) إلى نطاق المستأجر الفعلي.
 * `localStorage` مقصورة على أصل هذه الصفحة (نطاق المستأجر) ولا صلة لها بما
 * خزّنته صفحة التسجيل على النطاق العام — فهذه الصفحة هي من يُنشئ الجلسة هنا،
 * لا تستوردها. فشل الاستبدال (رمز منتهٍ/مستهلَك/من نطاق آخر) يُعامَل بلا
 * كشف تفصيلي، ويُحيل إلى الدخول العادي.
 */
export default function AuthHandoffPage() {
  const t = useTranslations('login');
  const router = useRouter();
  const params = useSearchParams();
  const [message, setMessage] = useState(t('handoff_loading'));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const code = params.get('code');
    if (!code) {
      setMessage(t('handoff_failed'));
      setFailed(true);
      return;
    }

    let cancelled = false;
    void api<{ token: string; user: AuthUser }>('/auth/handoff', { method: 'POST', body: { code } })
      .then((res) => {
        if (cancelled) return;
        setToken(res.token);
        persistUser(res.user);
        notifyAuthSessionChanged();
        router.replace('/dashboard');
      })
      .catch((error) => {
        if (cancelled) return;
        setMessage(error instanceof ApiError ? error.message : t('handoff_failed'));
        setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [params, router, t]);

  return (
    <AuthShell>
      <section className="border border-border bg-surface p-5 text-center shadow-sm sm:p-8">
        <h1 className="text-2xl font-bold text-text">{t('handoff_title')}</h1>
        <p className="mt-4 text-sm text-muted" role="status">
          {message}
        </p>
        {failed ? (
          <Link href="/login" className="mt-5 inline-block text-sm font-semibold text-primary hover:underline">
            {t('back_login')}
          </Link>
        ) : null}
      </section>
    </AuthShell>
  );
}
