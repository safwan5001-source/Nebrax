'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';

export function UserDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('users');
  const tc = useTranslations('common');
  const { success } = useToast();
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'staff' });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api('/users', { method: 'POST', body: form });
      success(tc('created'));
      setForm({ name: '', email: '', password: '', role: 'staff' });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t('add')}>
      <form onSubmit={submit} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="uname">{t('name')}</Label>
          <Input id="uname" value={form.name} onChange={(e) => set('name', e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="uemail">{t('email')}</Label>
          <Input id="uemail" type="email" dir="ltr" value={form.email} onChange={(e) => set('email', e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="upass">{t('password')}</Label>
          <Input id="upass" type="password" dir="ltr" value={form.password} onChange={(e) => set('password', e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="urole">{t('role')}</Label>
          <Select id="urole" value={form.role} onChange={(e) => set('role', e.target.value)}>
            <option value="admin">{t('roles.admin')}</option>
            <option value="accountant">{t('roles.accountant')}</option>
            <option value="staff">{t('roles.staff')}</option>
          </Select>
        </div>

        {error && <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="submit" disabled={saving}>
            {t('save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
