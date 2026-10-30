'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { AuthShell } from '@/components/auth/auth-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
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
  return <AuthShell experience="recovery"><section className="ax-card">
    <h1 className="text-center font-bold text-text lg:text-start">{t('forgot_title')}</h1>
    {done
      ? <p className="ax-status mt-5" role="status"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />{t('forgot_success')}</p>
      : <p className="mt-2 text-center text-sm text-muted lg:text-start">{t('forgot_subtitle')}</p>}
    {!done && <form onSubmit={submit} className="mt-7 space-y-4"><label className="block text-sm font-semibold text-text" htmlFor="forgot-email">{t('email')}</label><Input id="forgot-email" className="ax-input" type="email" dir="ltr" autoComplete="email" placeholder="name@company.com" required value={email} onChange={e => setEmail(e.target.value)} /><Button className="ax-submit w-full" type="submit">{t('forgot_submit')}</Button>{error && <p className="ax-alert" role="alert"><AlertCircle className="h-4 w-4" aria-hidden="true" />{error}</p>}</form>}
    <Link href="/login" className="ax-link mt-5 flex min-h-11 items-center justify-center text-sm">{t('back_login')}</Link>
  </section></AuthShell>;
}
