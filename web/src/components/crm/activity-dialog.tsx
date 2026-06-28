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

export interface Activity {
  id: string;
  partner_id: string | null;
  type: string;
  subject: string;
  activity_at: string | null;
  status: string;
  notes: string | null;
}
interface Partner { id: string; name: string }

const toLocalInput = (iso: string | null) => (iso ? iso.slice(0, 16) : '');

export function ActivityDialog({
  open,
  onClose,
  onSaved,
  activity,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  activity?: Activity | null;
}) {
  const t = useTranslations('crm');
  const tc = useTranslations('common');
  const { success } = useToast();
  const [partners, setPartners] = useState<Partner[]>([]);
  const [form, setForm] = useState({
    partner_id: activity?.partner_id ?? '',
    type: activity?.type ?? 'note',
    subject: activity?.subject ?? '',
    activity_at: toLocalInput(activity?.activity_at ?? null),
    status: activity?.status ?? 'open',
    notes: activity?.notes ?? '',
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
      type: form.type,
      subject: form.subject,
      activity_at: form.activity_at || null,
      status: form.status,
      notes: form.notes || null,
    };
    try {
      if (activity?.id) {
        await api(`/crm-activities/${activity.id}`, { method: 'PUT', body });
        success(tc('updated'));
      } else {
        await api('/crm-activities', { method: 'POST', body });
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
    <Dialog open={open} onClose={onClose} title={activity?.id ? t('edit') : t('create')} className="max-w-xl">
      <form onSubmit={submit} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="subject">{t('subject')}</Label>
          <Input id="subject" value={form.subject} onChange={(e) => set('subject', e.target.value)} required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="type">{t('type')}</Label>
            <Select id="type" value={form.type} onChange={(e) => set('type', e.target.value)}>
              <option value="call">{t('call')}</option>
              <option value="meeting">{t('meeting')}</option>
              <option value="email">{t('email')}</option>
              <option value="note">{t('note')}</option>
              <option value="task">{t('task')}</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="status">{t('status')}</Label>
            <Select id="status" value={form.status} onChange={(e) => set('status', e.target.value)}>
              <option value="open">{t('open')}</option>
              <option value="done">{t('done')}</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="partner">{t('customer')}</Label>
            <Select id="partner" value={form.partner_id} onChange={(e) => set('partner_id', e.target.value)}>
              <option value="">{t('none')}</option>
              {partners.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="when">{t('when')}</Label>
            <Input id="when" type="datetime-local" dir="ltr" value={form.activity_at} onChange={(e) => set('activity_at', e.target.value)} required />
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
