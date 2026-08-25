'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FieldGrid, FieldSpan, FormActions, FormAlert, FormPage, FormSection } from '@/components/nebrax';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NumberPreviewField } from '@/components/ui/number-preview-field';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { useNumberPreview } from '@/lib/use-number-preview';
import { formatRiyal, riyalToMinor } from '@/lib/money';

interface Partner { id: string; name: string; type: string }
interface Invoice { id: string; number: string; remaining: string; payment_status: string; status: string; partner_id: string }
interface Payment { status: string; direction: string; partner_id: string; method: string; reference?: string | null; payment_date: string; amount: string; notes?: string | null; invoice_id?: string | null; allocations?: { allocatable_id: string }[] }

export default function ReceiptVoucherFormPage() {
  const t = useTranslations('receiptVouchers');
  const tc = useTranslations('common');
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get('edit');
  const { success } = useToast();
  const [partners, setPartners] = useState<Partner[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [partnerId, setPartnerId] = useState('');
  const [invoiceId, setInvoiceId] = useState('');
  const [method, setMethod] = useState('cash');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { number: suggestedNumber, loading: loadingNumber } = useNumberPreview('payment', { seriesKey: 'received', date, enabled: !editId });

  const customers = useMemo(() => partners.filter((partner) => ['customer', 'both'].includes(partner.type)), [partners]);

  const loadInvoices = useCallback(async (customerId: string) => {
    if (!customerId) { setInvoices([]); return; }
    try {
      const response = await api<{ data: Invoice[] }>('/invoices');
      setInvoices(response.data.filter((invoice) => invoice.partner_id === customerId && invoice.status === 'posted' && invoice.payment_status !== 'paid'));
    } catch {
      setInvoices([]);
    }
  }, []);

  useEffect(() => {
    setDate(new Date().toISOString().slice(0, 10));
    api<{ data: Partner[] }>('/partners?type=customer').then((response) => setPartners(response.data)).catch(() => setPartners([]));
  }, []);

  useEffect(() => { loadInvoices(partnerId); }, [partnerId, loadInvoices]);

  useEffect(() => {
    if (!editId) return;
    api<{ data: Payment }>(`/payments/${editId}`).then(async (response) => {
      const payment = response.data;
      if (payment.direction !== 'received' || payment.status !== 'draft') {
        setError(t('edit_draft_only'));
        return;
      }
      setPartnerId(payment.partner_id);
      setMethod(payment.method);
      setAmount(String(payment.amount));
      setDate(payment.payment_date);
      setReference(payment.reference ?? '');
      setNotes(payment.notes ?? '');
      await loadInvoices(payment.partner_id);
      setInvoiceId(payment.invoice_id ?? payment.allocations?.[0]?.allocatable_id ?? '');
    }).catch((err) => setError(err instanceof ApiError ? err.message : t('load_failed')));
  }, [editId, loadInvoices, t]);

  function selectInvoice(id: string) {
    setInvoiceId(id);
    const invoice = invoices.find((candidate) => candidate.id === id);
    if (invoice) setAmount(String(invoice.remaining));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const minor = riyalToMinor(amount);
    if (!partnerId || minor <= 0) { setError(tc('saveFailed')); return; }

    setSaving(true);
    setError(null);
    const body: Record<string, unknown> = {
      partner_id: partnerId,
      direction: 'received',
      method,
      amount: minor,
      payment_date: date || undefined,
      reference: reference.trim() || undefined,
      notes: notes.trim() || undefined,
    };
    if (invoiceId) body.invoice_id = invoiceId;

    try {
      const path = editId ? `/payments/${editId}` : '/payments';
      const response = await api<{ data: { id: string } }>(path, { method: editId ? 'PUT' : 'POST', body });
      success(editId ? t('draft_updated') : t('draft_saved'));
      router.push(`/receipt-vouchers/${response.data.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <FormPage
        width="narrow"
        backHref="/receipt-vouchers"
        backLabel={t('back')}
        title={t(editId ? 'edit_title' : 'new_title')}
        description={t('subtitle')}
        status={<Badge tone="muted">{t('draft')}</Badge>}
        actions={
          <FormActions
            secondary={<Button asChild type="button" variant="outline"><Link href='/receipt-vouchers'>{tc('cancel')}</Link></Button>}
            primary={<Button type="submit" disabled={saving || !partnerId}>{saving ? t('saving') : t('save_draft')}</Button>}
          />
        }
      >
        <FormSection title={t('detail_title')}>
          <FieldGrid>
            {!editId && <NumberPreviewField id="receipt-voucher-number" label={t('number')} number={suggestedNumber} loading={loadingNumber} />}
            <div className="space-y-2"><Label htmlFor="customer">{t('customer')}</Label><Select id="customer" value={partnerId} onChange={(event) => { setPartnerId(event.target.value); setInvoiceId(''); }} required><option value="" disabled>{t('choose_customer')}</option>{customers.map((partner) => <option key={partner.id} value={partner.id}>{partner.name}</option>)}</Select></div>
            <div className="space-y-2"><Label htmlFor="date">{t('date')}</Label><Input id="date" type="date" dir="ltr" value={date} onChange={(event) => setDate(event.target.value)} required /></div>
            <div className="space-y-2"><Label htmlFor="method">{t('method')}</Label><Select id="method" value={method} onChange={(event) => setMethod(event.target.value)}><option value="cash">{t('cash')}</option><option value="bank">{t('bank')}</option></Select></div>
            <div className="space-y-2"><Label htmlFor="reference">{t('reference')}</Label><Input id="reference" value={reference} onChange={(event) => setReference(event.target.value)} placeholder={t('reference_hint')} /></div>
            <FieldSpan className="space-y-2"><Label htmlFor="invoice">{t('invoice')}</Label><Select id="invoice" value={invoiceId} onChange={(event) => selectInvoice(event.target.value)} disabled={!partnerId}><option value="">{t('on_account')}</option>{invoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.number} — {t('remaining')}: {formatRiyal(invoice.remaining)}</option>)}</Select>{partnerId && invoices.length === 0 && <p className="text-xs text-muted">{t('invoice_not_found')}</p>}</FieldSpan>
            <div className="space-y-2"><Label htmlFor="amount">{t('amount')}</Label><Input id="amount" inputMode="decimal" dir="ltr" className="num text-end" value={amount} onChange={(event) => setAmount(event.target.value)} required /></div>
            <FieldSpan className="space-y-2"><Label htmlFor="notes">{t('notes')}</Label><textarea id="notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={t('notes_placeholder')} rows={4} className="flex min-h-[6rem] w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none placeholder:text-muted focus:border-primary focus:ring-2 focus:ring-primary/20" /></FieldSpan>
          </FieldGrid>
        </FormSection>

        {error && <FormAlert>{error}</FormAlert>}
      </FormPage>
    </form>
  );
}
