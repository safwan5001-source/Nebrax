'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, CheckCircle2, ClipboardList, FileText, History, Pencil, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { currentUser } from '@/lib/auth';
import { DELIVERY_NOTE_PERMISSIONS, hasPermission, type DeliveryNote, statusTone } from '@/lib/delivery-notes';

export default function DeliveryNoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations('deliveryNotes');
  const tc = useTranslations('common');
  const { success } = useToast();
  const user = currentUser();
  const [note, setNote] = useState<DeliveryNote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'confirm' | 'cancel' | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  const canManage = hasPermission(user?.permissions, user?.role, DELIVERY_NOTE_PERMISSIONS.manage);
  const canConfirm = hasPermission(user?.permissions, user?.role, DELIVERY_NOTE_PERMISSIONS.confirm);
  const canCancel = hasPermission(user?.permissions, user?.role, DELIVERY_NOTE_PERMISSIONS.cancel);
  const canInvoice = hasPermission(user?.permissions, user?.role, DELIVERY_NOTE_PERMISSIONS.invoice);
  const canViewInvoices = hasPermission(user?.permissions, user?.role, 'invoices.view');
  const statusLabel = (value: string) => value === 'draft' ? t('statusDraft') : value === 'confirmed' ? t('statusConfirmed') : t('statusCancelled');
  const eventLabel = (value: string) => value === 'created' ? t('eventCreated') : value === 'updated' ? t('eventUpdated') : value === 'confirmed' ? t('eventConfirmed') : value === 'sales_invoice_draft_created' ? t('eventSalesInvoiceDraft') : t('eventCancelled');

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    api<{ data: DeliveryNote }>(`/delivery-notes/${id}`)
      .then((result) => setNote(result.data))
      .catch((caught) => setError(caught instanceof ApiError ? caught.message : tc('saveFailed')))
      .finally(() => setLoading(false));
  }, [id, tc]);

  useEffect(() => { load(); }, [load]);

  async function confirm(): Promise<void> {
    if (!note) return;
    setBusy('confirm');
    setError(null);
    try {
      const result = await api<{ data: DeliveryNote }>(`/delivery-notes/${note.id}/confirm`, { method: 'POST', body: { expected_version: note.version } });
      setNote(result.data);
      success(t('confirmed'));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : tc('saveFailed'));
    } finally {
      setBusy(null);
    }
  }

  async function cancel(): Promise<void> {
    if (!note || !cancelReason.trim()) return;
    setBusy('cancel');
    setError(null);
    try {
      const result = await api<{ data: DeliveryNote }>(`/delivery-notes/${note.id}/cancel`, {
        method: 'POST', body: { expected_version: note.version, reason: cancelReason.trim() },
      });
      setNote(result.data);
      setCancelOpen(false);
      setCancelReason('');
      success(t('cancelled'));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : tc('saveFailed'));
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <div className="space-y-4" aria-busy="true"><div className="h-10 w-72 animate-pulse rounded bg-muted" /><div className="h-72 animate-pulse rounded bg-muted" /></div>;
  if (!note) return <section role="alert" className="rounded border border-negative/30 bg-negative/10 p-5 text-negative"><p>{error ?? t('notFound')}</p><Button asChild variant="outline" className="mt-3"><Link href="/delivery-notes">{t('backToList')}</Link></Button></section>;

  const isDraft = note.status === 'draft';
  const isCancelled = note.status === 'cancelled';
  const isConfirmed = note.status === 'confirmed';
  const displayQuantity = (line: DeliveryNote['lines'][number]) => line.quantity_numerator && line.quantity_denominator ? `${line.quantity_numerator}/${line.quantity_denominator}` : String(line.quantity);

  return <div className="space-y-5">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 items-center gap-3"><Button asChild variant="ghost" size="icon" aria-label={t('back')}><Link href="/delivery-notes"><ArrowRight className="h-4 w-4" strokeWidth={1.7} /></Link></Button><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h1 className="num text-xl font-semibold text-text">{note.number}</h1><Badge tone={statusTone(note.status)}>{statusLabel(note.status)}</Badge></div><p className="mt-1 text-sm text-muted">{t('deliveryDate')}: <span dir="ltr" className="num">{note.delivery_date}</span></p></div></div>
      <div className="flex flex-wrap gap-2">
        {isDraft && canManage && <Button asChild variant="outline"><Link href={`/delivery-notes/${note.id}/edit`}><Pencil className="h-4 w-4" strokeWidth={1.7} />{t('edit')}</Link></Button>}
        {isDraft && canConfirm && <Button disabled={busy !== null} onClick={confirm}><CheckCircle2 className="h-4 w-4" strokeWidth={1.7} />{busy === 'confirm' ? t('saving') : t('confirm')}</Button>}
        {isConfirmed && canInvoice && (note.invoice_draft ? (canViewInvoices && <Button asChild variant="outline"><Link href={`/invoices/${note.invoice_draft.invoice_id}`}><FileText className="h-4 w-4" strokeWidth={1.7} />{t('invoiceDraftOpenInvoice')}</Link></Button>) : <Button asChild variant="outline"><Link href={`/delivery-notes/invoice-draft?notes=${note.id}`}><FileText className="h-4 w-4" strokeWidth={1.7} />{t('invoiceDraftAction')}</Link></Button>)}
        {!isCancelled && canCancel && <Button variant="danger" disabled={busy !== null} onClick={() => setCancelOpen(true)}><XCircle className="h-4 w-4" strokeWidth={1.7} />{t('cancel')}</Button>}
      </div>
    </div>

    {error && <p role="alert" className="rounded border border-negative/30 bg-negative/10 p-3 text-sm text-negative">{error}</p>}
    {note.status === 'confirmed' && <div className="rounded border border-positive/30 bg-positive/10 p-3 text-sm text-positive">{t('confirmedReadOnly')}</div>}
    {note.invoice_draft && <div className="flex flex-col gap-2 rounded border border-primary/25 bg-primary-soft/40 p-3 text-sm sm:flex-row sm:items-center sm:justify-between"><span>{t('invoiceDraftAlreadyLinked', { number: note.invoice_draft.number ?? '—' })}</span>{canViewInvoices && <Button asChild size="sm" variant="outline"><Link href={`/invoices/${note.invoice_draft.invoice_id}`}>{t('invoiceDraftOpenInvoice')}</Link></Button>}</div>}
    {isCancelled && <div className="rounded border border-negative/30 bg-negative/10 p-3 text-sm text-negative"><strong>{t('cancellationReason')}:</strong> {note.cancellation_reason}</div>}

    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2"><CardHeader><CardTitle>{t('header')}</CardTitle></CardHeader><CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2"><div><p className="text-xs text-muted">{t('customer')}</p><p className="mt-1 font-medium text-text">{note.customer?.name ?? '—'}</p></div><div><p className="text-xs text-muted">{t('warehouse')}</p><p className="mt-1 font-medium text-text">{note.warehouse?.name ?? '—'}</p></div><div><p className="text-xs text-muted">{t('externalReference')}</p><p className="mt-1 text-text">{note.external_reference ?? '—'}</p></div><div><p className="text-xs text-muted">{t('deliveryDate')}</p><p className="num mt-1 text-text" dir="ltr">{note.delivery_date}</p></div>{note.notes && <div className="sm:col-span-2"><p className="text-xs text-muted">{t('notes')}</p><p className="mt-1 whitespace-pre-wrap text-sm text-text">{note.notes}</p></div>}</CardContent></Card>
      <Card><CardHeader><CardTitle>{t('documentState')}</CardTitle></CardHeader><CardContent className="space-y-3 text-sm"><div className="flex items-center justify-between"><span className="text-muted">{t('status')}</span><Badge tone={statusTone(note.status)}>{statusLabel(note.status)}</Badge></div><div className="flex items-center justify-between"><span className="text-muted">{t('version')}</span><span className="num text-text">{note.version}</span></div>{note.confirmed_at && <div><p className="text-muted">{t('confirmedAt')}</p><p className="num mt-1 text-text" dir="ltr">{new Date(note.confirmed_at).toLocaleString()}</p></div>}{note.cancelled_at && <div><p className="text-muted">{t('cancelledAt')}</p><p className="num mt-1 text-text" dir="ltr">{new Date(note.cancelled_at).toLocaleString()}</p></div>}</CardContent></Card>
    </div>

    <Card><CardHeader><CardTitle>{t('lines')}</CardTitle></CardHeader><CardContent className="space-y-3"><div className="hidden grid-cols-12 gap-3 border-b border-border pb-2 text-xs font-medium text-muted md:grid"><div className="col-span-6">{t('product')}</div><div className="col-span-2">{t('unit')}</div><div className="col-span-2 text-end">{t('quantity')}</div><div className="col-span-2">{t('description')}</div></div>{note.lines.map((line) => <div key={line.id ?? `${line.product_id}-${line.line_number}`} className="grid grid-cols-1 gap-2 rounded border border-border p-3 md:grid-cols-12 md:items-center md:gap-3 md:border-0 md:p-0"><div className="md:col-span-6"><p className="font-medium text-text">{line.product_name}</p>{line.product_sku && <p className="num mt-0.5 text-xs text-muted">{line.product_sku}</p>}</div><div className="md:col-span-2"><span className="text-muted md:hidden">{t('unit')}: </span>{line.unit_name}</div><div className="num text-end text-text md:col-span-2">{displayQuantity(line)}</div><div className="text-sm text-muted md:col-span-2">{line.description ?? '—'}</div></div>)}</CardContent></Card>

    <Card><CardHeader><CardTitle className="flex items-center gap-2"><History className="h-4 w-4 text-primary" strokeWidth={1.7} />{t('history')}</CardTitle></CardHeader><CardContent>{note.events?.length ? <ol className="space-y-4 border-s border-border ps-4">{note.events.map((event) => <li key={event.id} className="relative"><span className="absolute -start-[1.35rem] top-1.5 h-2.5 w-2.5 rounded-full bg-primary" /><div className="flex flex-wrap items-center gap-2"><strong className="text-sm text-text">{eventLabel(event.event)}</strong><span className="text-xs text-muted">{event.actor_name ?? t('systemActor')}</span><time className="num text-xs text-muted" dir="ltr">{new Date(event.occurred_at).toLocaleString()}</time></div>{event.reason && <p className="mt-1 text-sm text-muted">{event.reason}</p>}</li>)}</ol> : <p className="text-sm text-muted">{t('noHistory')}</p>}</CardContent></Card>

    <Dialog open={cancelOpen} onClose={() => setCancelOpen(false)} title={t('cancelTitle')}><div className="space-y-4"><p className="text-sm text-muted">{t('cancelHint')}</p><div className="space-y-1.5"><Label htmlFor="cancel-reason">{t('cancellationReason')}</Label><Textarea id="cancel-reason" value={cancelReason} maxLength={500} onChange={(event) => setCancelReason(event.target.value)} aria-invalid={!cancelReason.trim() || undefined} /></div><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setCancelOpen(false)}>{tc('cancel')}</Button><Button variant="danger" disabled={busy === 'cancel' || !cancelReason.trim()} onClick={cancel}>{busy === 'cancel' ? t('saving') : t('cancel')}</Button></div></div></Dialog>
  </div>;
}
