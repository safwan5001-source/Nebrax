'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { AuthShell } from '@/components/auth/auth-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api';

export default function ForgotPasswordPage() {
  const t = useTranslations('login');
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(null);
    try { await api('/forgot-password', { method: 'POST', body: { email } }); setDone(true); }
    catch (e) { setError(e instanceof ApiError ? e.message : t('error')); }
  }
  return <AuthShell><section className="border border-border bg-surface p-5 shadow-sm sm:p-8">
    <h1 className="text-center text-2xl font-bold text-text">{t('forgot_title')}</h1>
    <p className="mt-2 text-center text-sm text-muted">{done ? t('forgot_success') : t('forgot_subtitle')}</p>
    {!done && <form onSubmit={submit} className="mt-7 space-y-4"><label className="block text-sm font-semibold text-text" htmlFor="forgot-email">{t('email')}</label><Input id="forgot-email" type="email" dir="ltr" required value={email} onChange={e => setEmail(e.target.value)} /><Button className="h-12 w-full" type="submit">{t('forgot_submit')}</Button>{error && <p className="text-sm text-negative" role="alert">{error}</p>}</form>}
    <Link href="/login" className="mt-5 block text-center text-sm font-semibold text-primary hover:underline">{t('back_login')}</Link>
  </section></AuthShell>;
}
