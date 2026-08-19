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

export interface Appointment {
  id: string;
  partner_id: string | null;
  invoice_id?: string | null;
  invoice?: { id: string; number: string } | null;
  title: string;
  appointment_at: string | null;
  duration_minutes: number | null;
  status: string;
  location: string | null;
  notes: string | null;
}
interface Partner { id: string; name: string }
interface InitialInvoice { id: string; partnerId: string; number: string }

const toLocalInput = (iso: string | null) => (iso ? iso.slice(0, 16) : '');

export function AppointmentDialog({
  open,
  onClose,
  onSaved,
  appointment,
  initialInvoice,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  appointment?: Appointment | null;
  initialInvoice?: InitialInvoice | null;
}) {
  const t = useTranslations('appointments');
  const tc = useTranslations('common');
  const { success } = useToast();
  const [partners, setPartners] = useState<Partner[]>([]);
  const initialForm = () => ({
    partner_id: initialInvoice?.partnerId ?? appointment?.partner_id ?? '',
    invoice_id: initialInvoice?.id ?? appointment?.invoice_id ?? '',
    title: appointment?.title ?? (initialInvoice ? `${t('invoice_appointment_title')} ${initialInvoice.number}` : ''),
    appointment_at: toLocalInput(appointment?.appointment_at ?? null),
    duration_minutes: appointment?.duration_minutes ? String(appointment.duration_minutes) : '',
    status: appointment?.status ?? 'scheduled',
    location: appointment?.location ?? '',
    notes: appointment?.notes ?? '',
  });
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(initialForm());
    setError(null);
    api<{ data: Partner[] }>('/partners').then((r) => setPartners(r.data)).catch(() => {});
  // يعاد ضبط النموذج فقط عند فتحه أو تبدّل مصدره؛ لا يعيد ضبط الكتابة أثناء التحرير.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, appointment?.id, initialInvoice?.id]);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const body = {
      partner_id: initialInvoice?.partnerId ?? (form.partner_id || null),
      invoice_id: initialInvoice?.id ?? (form.invoice_id || null),
      title: form.title,
      appointment_at: form.appointment_at || null,
      duration_minutes: form.duration_minutes ? Number(form.duration_minutes) : null,
      status: form.status,
      location: form.location || null,
      notes: form.notes || null,
    };
    try {
      if (appointment?.id) {
        await api(`/appointments/${appointment.id}`, { method: 'PUT', body });
        success(tc('updated'));
      } else {
        await api('/appointments', { method: 'POST', body });
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

  const linkedInvoice = initialInvoice?.number ?? appointment?.invoice?.number;

  return (
    <Dialog open={open} onClose={onClose} title={appointment?.id ? t('edit') : t('create')} className="max-w-xl">
      <form onSubmit={submit} className="space-y-3">
        {linkedInvoice && <div className="rounded border border-border bg-muted/40 px-3 py-2.5 text-sm"><span className="text-muted">{t('source_invoice')}</span><span className="num ms-2 font-medium text-text">{linkedInvoice}</span></div>}
        <div className="space-y-1.5">
          <Label htmlFor="title">{t('title')}</Label>
          <Input id="title" value={form.title} onChange={(e) => set('title', e.target.value)} required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="partner">{t('customer')}</Label>
            {initialInvoice ? <Input id="partner" value={partners.find((partner) => partner.id === initialInvoice.partnerId)?.name ?? t('linked_customer')} disabled /> : <Select id="partner" value={form.partner_id} onChange={(e) => set('partner_id', e.target.value)}><option value="">{t('none')}</option>{partners.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}</Select>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="status">{t('status')}</Label>
            <Select id="status" value={form.status} onChange={(e) => set('status', e.target.value)}><option value="scheduled">{t('scheduled')}</option><option value="done">{t('done')}</option><option value="cancelled">{t('cancelled')}</option></Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="when">{t('when')}</Label>
            <Input id="when" type="datetime-local" dir="ltr" value={form.appointment_at} onChange={(e) => set('appointment_at', e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dur">{t('duration')}</Label>
            <Input id="dur" className="num text-end" type="number" min={0} max={1440} value={form.duration_minutes} onChange={(e) => set('duration_minutes', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="loc">{t('location')}</Label>
            <Input id="loc" value={form.location} onChange={(e) => set('location', e.target.value)} />
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
