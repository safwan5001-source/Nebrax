'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { AuthShell } from '@/components/auth/auth-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api';

export default function ResetPasswordPage() {
  const t = useTranslations('login'); const params = useSearchParams(); const router = useRouter();
  const [password, setPassword] = useState(''); const [confirmation, setConfirmation] = useState(''); const [error, setError] = useState<string | null>(null); const [done, setDone] = useState(false);
  async function submit(event: React.FormEvent) { event.preventDefault(); setError(null); if (password !== confirmation) { setError(t('password_mismatch')); return; } try { await api('/reset-password', { method: 'POST', body: { token: params.get('token') ?? '', password, password_confirmation: confirmation } }); setDone(true); setTimeout(() => router.replace('/login'), 1200); } catch (e) { setError(e instanceof ApiError ? e.message : t('error')); } }
  return <AuthShell><section className="border border-border bg-surface p-5 shadow-sm sm:p-8"><h1 className="text-center text-2xl font-bold text-text">{t('reset_title')}</h1>{done ? <p className="mt-4 text-center text-sm text-muted">{t('reset_success')}</p> : <form onSubmit={submit} className="mt-7 space-y-4"><label className="block text-sm font-semibold text-text">{t('new_password')}<Input className="mt-1" type="password" minLength={8} required value={password} onChange={e => setPassword(e.target.value)} /></label><label className="block text-sm font-semibold text-text">{t('confirm_password')}<Input className="mt-1" type="password" minLength={8} required value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label>{error && <p className="text-sm text-negative" role="alert">{error}</p>}<Button className="h-12 w-full" type="submit">{t('reset_submit')}</Button></form>}</section></AuthShell>;
}
