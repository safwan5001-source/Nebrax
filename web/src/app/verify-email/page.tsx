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
  return <AuthShell experience="recovery"><section className="ax-card text-center lg:text-start"><h1 className="font-bold text-text">{t('verify_title')}</h1><p className="mt-4 text-sm text-muted" role="status">{message}</p><Link href="/login" className="ax-link mt-5 inline-flex min-h-11 items-center text-sm">{t('back_login')}</Link></section></AuthShell>;
}
