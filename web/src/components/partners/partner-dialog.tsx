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

export interface Partner {
  id: string;
  name: string;
  type: string;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
}

export function PartnerDialog({
  open,
  onClose,
  onSaved,
  partner,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  partner?: Partner | null;
}) {
  const tp = useTranslations('partners');
  const tc = useTranslations('common');
  const { success } = useToast();
  const [form, setForm] = useState<Partner>(
    partner ?? { id: '', name: '', type: 'customer', email: '', phone: '', city: '' }
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (k: keyof Partner, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const body = {
      name: form.name,
      type: form.type,
      email: form.email || null,
      phone: form.phone || null,
      city: form.city || null,
    };
    try {
      if (partner?.id) {
        await api(`/partners/${partner.id}`, { method: 'PUT', body });
        success(tc('updated'));
      } else {
        await api('/partners', { method: 'POST', body });
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
    <Dialog open={open} onClose={onClose} title={partner?.id ? tp('edit') : tp('add')}>
      <form onSubmit={submit} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="name">{tp('name')}</Label>
          <Input id="name" value={form.name} onChange={(e) => set('name', e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="type">{tp('type')}</Label>
          <Select id="type" value={form.type} onChange={(e) => set('type', e.target.value)}>
            <option value="customer">{tp('customer')}</option>
            <option value="supplier">{tp('supplier')}</option>
            <option value="both">{tp('both')}</option>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="email">{tp('email')}</Label>
            <Input id="email" type="email" dir="ltr" value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone">{tp('phone')}</Label>
            <Input id="phone" dir="ltr" value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="city">{tp('city')}</Label>
          <Input id="city" value={form.city ?? ''} onChange={(e) => set('city', e.target.value)} />
        </div>

        {error && <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {tp('cancel')}
          </Button>
          <Button type="submit" disabled={saving}>
            {tp('save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
