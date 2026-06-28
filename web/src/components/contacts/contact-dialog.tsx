'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';

export interface Contact {
  id: string;
  partner_id: string | null;
  name: string;
  job_title: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
}
interface Partner { id: string; name: string }

export function ContactDialog({
  open,
  onClose,
  onSaved,
  contact,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  contact?: Contact | null;
}) {
  const t = useTranslations('contacts');
  const tc = useTranslations('common');
  const { success } = useToast();
  const [partners, setPartners] = useState<Partner[]>([]);
  const [form, setForm] = useState({
    partner_id: contact?.partner_id ?? '',
    name: contact?.name ?? '',
    job_title: contact?.job_title ?? '',
    email: contact?.email ?? '',
    phone: contact?.phone ?? '',
    notes: contact?.notes ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    api<{ data: Partner[] }>('/partners').then((r) => setPartners(r.data)).catch(() => {});
  }, [open]);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const body = {
      partner_id: form.partner_id || null,
      name: form.name,
      job_title: form.job_title || null,
      email: form.email || null,
      phone: form.phone || null,
      notes: form.notes || null,
    };
    try {
      if (contact?.id) {
        await api(`/contacts/${contact.id}`, { method: 'PUT', body });
        success(tc('updated'));
      } else {
        await api('/contacts', { method: 'POST', body });
        success(tc('created'));
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={contact?.id ? t('edit') : t('create')} className="max-w-xl">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="name">{t('name')}</Label>
            <Input id="name" value={form.name} onChange={(e) => set('name', e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="job">{t('job_title')}</Label>
            <Input id="job" value={form.job_title} onChange={(e) => set('job_title', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="partner">{t('customer')}</Label>
            <Select id="partner" value={form.partner_id} onChange={(e) => set('partner_id', e.target.value)}>
              <option value="">{t('none')}</option>
              {partners.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone">{t('phone')}</Label>
            <Input id="phone" dir="ltr" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          </div>
          <div className="space-y-1.5 col-span-2">
            <Label htmlFor="email">{t('email')}</Label>
            <Input id="email" type="email" dir="ltr" value={form.email} onChange={(e) => set('email', e.target.value)} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="notes">{t('notes')}</Label>
          <Input id="notes" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>

        {error && <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button type="submit" disabled={saving}>{t('save')}</Button>
        </div>
      </form>
    </Dialog>
  );
}
