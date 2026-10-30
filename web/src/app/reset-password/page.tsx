'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { AuthShell } from '@/components/auth/auth-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { ApiError, api } from '@/lib/api';

export default function ResetPasswordPage() {
  const t = useTranslations('login'); const params = useSearchParams(); const router = useRouter();
  const [password, setPassword] = useState(''); const [confirmation, setConfirmation] = useState(''); const [error, setError] = useState<string | null>(null); const [done, setDone] = useState(false);
  async function submit(event: React.FormEvent) { event.preventDefault(); setError(null); if (password !== confirmation) { setError(t('password_mismatch')); return; } try { await api('/reset-password', { method: 'POST', body: { token: params.get('token') ?? '', password, password_confirmation: confirmation } }); setDone(true); setTimeout(() => router.replace('/login'), 1200); } catch (e) { setError(e instanceof ApiError ? e.message : t('error')); } }
  return <AuthShell experience="recovery"><section className="ax-card"><h1 className="text-center font-bold text-text lg:text-start">{t('reset_title')}</h1>{done ? <p className="ax-status mt-5" role="status"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />{t('reset_success')}</p> : <form onSubmit={submit} className="mt-7 space-y-4"><label className="block text-sm font-semibold text-text">{t('new_password')}<Input className="ax-input mt-1.5" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={e => setPassword(e.target.value)} /></label><label className="block text-sm font-semibold text-text">{t('confirm_password')}<Input className="ax-input mt-1.5" type="password" autoComplete="new-password" minLength={8} required value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label>{error && <p className="ax-alert" role="alert"><AlertCircle className="h-4 w-4" aria-hidden="true" />{error}</p>}<Button className="ax-submit w-full" type="submit">{t('reset_submit')}</Button></form>}</section></AuthShell>;
}
