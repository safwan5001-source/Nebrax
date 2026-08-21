'use client';

import { FormEvent, useState } from 'react';
import { KeyRound, Mail } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ApiError, api } from '@/lib/api';
import { persistUser, type AuthUser } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';

export function AccountSecurityCard({ user, onUserChanged }: { user: AuthUser | null; onUserChanged: (user: AuthUser) => void }) {
  const t = useTranslations('settings');
  const { success, error } = useToast();
  const [dialog, setDialog] = useState<'email' | 'password' | null>(null);
  const [email, setEmail] = useState(user?.email ?? '');
  const [emailPassword, setEmailPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [saving, setSaving] = useState(false);

  function close(): void {
    setDialog(null);
    setEmailPassword('');
    setCurrentPassword('');
    setPassword('');
    setConfirmation('');
  }

  async function updateEmail(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await api<{ user: AuthUser }>('/account/email', { method: 'PUT', body: { email, current_password: emailPassword } });
      persistUser(response.user);
      onUserChanged(response.user);
      success(t('email_updated'), t('sessions_revoked'));
      close();
    } catch (err) {
      error(t('email_update_failed'), err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  async function updatePassword(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (password !== confirmation) {
      error(t('passwords_do_not_match'));
      return;
    }

    setSaving(true);
    try {
      await api('/account/password', { method: 'PUT', body: { current_password: currentPassword, password, password_confirmation: confirmation } });
      success(t('password_updated'), t('sessions_revoked'));
      close();
    } catch (err) {
      error(t('password_update_failed'), err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base"><KeyRound className="h-4 w-4 text-muted" strokeWidth={1.7} aria-hidden="true" />{t('security')}</CardTitle>
            <p className="text-sm text-muted">{t('security_hint')}</p>
          </div>
        </CardHeader>
        <CardContent className="divide-y divide-border rounded border border-border">
          <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0"><p className="font-medium text-text">{t('email_address')}</p><p className="truncate text-sm text-muted">{user?.email}</p></div>
            <Button variant="outline" size="sm" onClick={() => { setEmail(user?.email ?? ''); setDialog('email'); }}>{t('change_email')}</Button>
          </div>
          <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div><p className="font-medium text-text">{t('password')}</p><p className="text-sm text-muted">{t('password_hint')}</p></div>
            <Button variant="outline" size="sm" onClick={() => setDialog('password')}>{t('change_password')}</Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialog === 'email'} onClose={close} title={t('change_email')}>
        <form className="space-y-4" onSubmit={updateEmail}>
          <p className="text-sm text-muted">{t('change_email_hint')}</p>
          <Field label={t('new_email')} type="email" value={email} onChange={setEmail} autoComplete="email" />
          <Field label={t('current_password')} type="password" value={emailPassword} onChange={setEmailPassword} autoComplete="current-password" />
          <p className="text-xs text-muted">{t('sessions_revoked')}</p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button type="button" variant="outline" onClick={close}>{t('cancel')}</Button><Button type="submit" disabled={saving}>{saving ? t('saving') : t('save_changes')}</Button></div>
        </form>
      </Dialog>

      <Dialog open={dialog === 'password'} onClose={close} title={t('change_password')}>
        <form className="space-y-4" onSubmit={updatePassword}>
          <p className="text-sm text-muted">{t('change_password_hint')}</p>
          <Field label={t('current_password')} type="password" value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" />
          <Field label={t('new_password')} type="password" value={password} onChange={setPassword} autoComplete="new-password" minLength={8} />
          <Field label={t('confirm_password')} type="password" value={confirmation} onChange={setConfirmation} autoComplete="new-password" minLength={8} />
          <p className="text-xs text-muted">{t('sessions_revoked')}</p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button type="button" variant="outline" onClick={close}>{t('cancel')}</Button><Button type="submit" disabled={saving}>{saving ? t('saving') : t('save_changes')}</Button></div>
        </form>
      </Dialog>
    </>
  );
}

function Field({ label, type, value, onChange, autoComplete, minLength }: { label: string; type: 'email' | 'password'; value: string; onChange: (value: string) => void; autoComplete: string; minLength?: number }) {
  return (
    <label className="block space-y-1.5 text-sm font-medium text-text">
      <span>{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} autoComplete={autoComplete} minLength={minLength} required className="h-10 w-full rounded border border-border bg-background px-3 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-primary/40" />
    </label>
  );
}
