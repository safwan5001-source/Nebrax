'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AuthShell } from '@/components/auth/auth-shell';
import { ApiError, api } from '@/lib/api';

export default function VerifyEmailPage() {
  const t = useTranslations('login'); const params = useSearchParams(); const [message, setMessage] = useState(t('verify_loading'));
  useEffect(() => { void api('/email/verify', { method: 'POST', body: { token: params.get('token') ?? '' } }).then(() => setMessage(t('verify_success'))).catch(e => setMessage(e instanceof ApiError ? e.message : t('verify_failed'))); }, [params, t]);
  return <AuthShell><section className="border border-border bg-surface p-5 text-center shadow-sm sm:p-8"><h1 className="text-2xl font-bold text-text">{t('verify_title')}</h1><p className="mt-4 text-sm text-muted" role="status">{message}</p><Link href="/login" className="mt-5 inline-block text-sm font-semibold text-primary hover:underline">{t('back_login')}</Link></section></AuthShell>;
}
