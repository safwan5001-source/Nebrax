'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, FileText, Paperclip, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { currentUser } from '@/lib/auth';
import { formatRiyal, riyalToMinor } from '@/lib/money';

interface Partner { id: string; name: string; type: string }
interface OpenDocument { id: string; number: string; remaining: string; payment_status: string; status: string; partner_id: string }
interface PaymentMethod { id: string; name: string; settlement_type: 'cash' | 'bank'; cash_bank_account_id: string | null; is_active: boolean; is_default: boolean }
interface CashBankAccount { id: string; account_id: string; name: string; type: 'cash' | 'bank'; is_active: boolean; is_main: boolean }
interface Collector { id: string; name: string; employee_no: string }

type Direction = 'received' | 'paid';
type SubmitMode = 'draft' | 'post';

export function GeneralPaymentForm() {
  const t = useTranslations('paymentEntry');
  const tc = useTranslations('common');
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedPartnerId = searchParams.get('partner_id');
  const requestedDirection = searchParams.get('direction');
  const initialDirection: Direction = requestedDirection === 'paid' ? 'paid' : 'received';
  const { success } = useToast();
  const [partners, setPartners] = useState<Partner[]>([]);
  const [documents, setDocuments] = useState<OpenDocument[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [accounts, setAccounts] = useState<CashBankAccount[]>([]);
  const [collectors, setCollectors] = useState<Collector[]>([]);
  const [direction, setDirection] = useState<Direction>(initialDirection);
  const [partnerId, setPartnerId] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [cashAccountId, setCashAccountId] = useState('');
  const [collectorEmployeeId, setCollectorEmployeeId] = useState('');
  const [reference, setReference] = useState('');
  const [paymentDetails, setPaymentDetails] = useState('');
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<SubmitMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedMethod = methods.find((method) => method.id === paymentMethodId) ?? null;
  const selectedDocument = documents.find((document) => document.id === documentId) ?? null;
  const selectedPartner = partners.find((partner) => partner.id === partnerId) ?? null;
  const compatibleAccounts = useMemo(
    () => accounts.filter((account) => account.is_active && account.type === selectedMethod?.settlement_type),
    [accounts, selectedMethod?.settlement_type],
  );

  const resolveAccount = useCallback((method: PaymentMethod, candidates: CashBankAccount[]) => {
    const active = candidates.filter((account) => account.is_active && account.type === method.settlement_type);
    return active.find((account) => account.id === method.cash_bank_account_id) ?? active.find((account) => account.is_main) ?? active[0] ?? null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [partnersResponse, methodsResponse, accountsResponse, collectorsResponse] = await Promise.all([
          api<{ data: Partner[] }>('/partners'),
          api<{ data: PaymentMethod[] }>('/payment-methods'),
          api<{ data: CashBankAccount[] }>('/cash-bank-accounts'),
          api<{ data: Collector[] }>('/payments/collectors'),
        ]);
        if (cancelled) return;
        const activeMethods = methodsResponse.data.filter((method) => method.is_active);
        const defaultMethod = activeMethods.find((method) => method.is_default) ?? activeMethods[0] ?? null;
        const eligiblePrefilledPartner = requestedPartnerId && partnersResponse.data.some((partner) =>
          partner.id === requestedPartnerId && (initialDirection === 'received' ? ['customer', 'both'].includes(partner.type) : ['supplier', 'both'].includes(partner.type)),
        );
        setPartners(partnersResponse.data);
        setPartnerId(eligiblePrefilledPartner ? requestedPartnerId : '');
        setMethods(activeMethods);
        setAccounts(accountsResponse.data);
        setCollectors(collectorsResponse.data);
        setDate(new Date().toISOString().slice(0, 10));
        setPaymentMethodId(defaultMethod?.id ?? '');
        setCashAccountId(defaultMethod ? resolveAccount(defaultMethod, accountsResponse.data)?.account_id ?? '' : '');
        setCollectorEmployeeId(currentUser()?.employee_id ?? '');
      } catch (requestError) {
        if (!cancelled) setError(requestError instanceof ApiError ? requestError.message : t('load_failed'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [initialDirection, requestedPartnerId, resolveAccount, t]);

  useEffect(() => {
    let cancelled = false;
    setDocuments([]);
    setDocumentId('');
    setAmount('');
    if (!partnerId) return () => { cancelled = true; };
    const endpoint = direction === 'received' ? '/invoices' : '/purchases';
    api<{ data: OpenDocument[] }>(endpoint).then((response) => {
      if (cancelled) return;
      setDocuments(response.data.filter((document) => document.partner_id === partnerId && document.status === 'posted' && document.payment_status !== 'paid'));
    }).catch((requestError) => {
      if (!cancelled) setError(requestError instanceof ApiError ? requestError.message : t('load_failed'));
    });
    return () => { cancelled = true; };
  }, [direction, partnerId, t]);

  function selectMethod(id: string) {
    setPaymentMethodId(id);
    const method = methods.find((candidate) => candidate.id === id);
    setCashAccountId(method ? resolveAccount(method, accounts)?.account_id ?? '' : '');
  }

  function selectDocument(id: string) {
    setDocumentId(id);
    const document = documents.find((candidate) => candidate.id === id);
    if (document) setAmount(document.remaining);
  }

  function addFiles(nextFiles: FileList | null) {
    if (!nextFiles) return;
    setFiles((current) => [...current, ...Array.from(nextFiles)].slice(0, 10));
  }

  async function submit(mode: SubmitMode) {
    const amountMinor = riyalToMinor(amount);
    const remainingMinor = selectedDocument ? riyalToMinor(selectedDocument.remaining) : null;
    if (!partnerId || amountMinor <= 0 || (remainingMinor !== null && amountMinor > remainingMinor) || !paymentMethodId || !cashAccountId) {
      setError(tc('saveFailed'));
      return;
    }

    setSaving(mode);
    setError(null);
    const body = new FormData();
    body.append('partner_id', partnerId);
    body.append('direction', direction);
    body.append('payment_method_id', paymentMethodId);
    body.append('cash_account_id', cashAccountId);
    body.append('amount', String(amountMinor));
    body.append('payment_date', date);
    if (documentId) body.append(direction === 'received' ? 'invoice_id' : 'purchase_id', documentId);
    if (collectorEmployeeId) body.append('collector_employee_id', collectorEmployeeId);
    if (reference.trim()) body.append('reference', reference.trim());
    if (paymentDetails.trim()) body.append('payment_details', paymentDetails.trim());
    if (notes.trim()) body.append('notes', notes.trim());
    files.forEach((file) => body.append('attachments[]', file));

    try {
      const created = await api<{ data: { id: string } }>('/payments', { method: 'POST', body });
      if (mode === 'post') {
        await api(`/payments/${created.data.id}/post`, { method: 'POST' });
        success(t('confirm_success'));
        router.push(documentId ? (direction === 'received' ? `/invoices/${documentId}` : `/purchases/${documentId}`) : '/payments');
      } else {
        success(t('save_draft_success'));
        router.push(`/payments/${created.data.id}`);
      }
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : tc('saveFailed'));
    } finally {
      setSaving(null);
    }
  }

  if (loading) return <p className="text-sm text-muted">{t('loading')}</p>;

  const eligiblePartners = partners.filter((partner) => direction === 'received' ? ['customer', 'both'].includes(partner.type) : ['supplier', 'both'].includes(partner.type));

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.push('/payments')} aria-label={t('back')}><ArrowRight className="h-4 w-4" strokeWidth={1.7} /></Button>
          <div><h1 className="text-xl font-semibold text-text">{t('title')}</h1><p className="mt-1 text-sm text-muted">{t('subtitle')}</p></div>
        </div>
        <span className="rounded-md bg-muted px-3 py-1.5 text-sm text-muted">{t('draft')}</span>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle>{t('detail_title')}</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="general-payment-direction">{t('direction')}</Label><Select id="general-payment-direction" value={direction} onChange={(event) => { setDirection(event.target.value as Direction); setPartnerId(''); }}><option value="received">{t('received')}</option><option value="paid">{t('paid')}</option></Select></div>
              <div className="space-y-1.5"><Label htmlFor="general-payment-partner">{t('partner')}</Label><Select id="general-payment-partner" value={partnerId} onChange={(event) => setPartnerId(event.target.value)} required><option value="" disabled>{t('choose_partner')}</option>{eligiblePartners.map((partner) => <option key={partner.id} value={partner.id}>{partner.name}</option>)}</Select></div>
              <div className="space-y-1.5"><Label htmlFor="general-payment-document">{t('document')}</Label><Select id="general-payment-document" value={documentId} onChange={(event) => selectDocument(event.target.value)} disabled={!partnerId}><option value="">{t('on_account')}</option>{documents.map((document) => <option key={document.id} value={document.id}>{document.number} — {t('remaining')}: {formatRiyal(document.remaining)}</option>)}</Select></div>
              <div className="space-y-1.5"><Label htmlFor="general-payment-amount">{t('amount')}</Label><div className="flex rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-primary/40"><Input id="general-payment-amount" inputMode="decimal" className="num border-0 text-end shadow-none focus-visible:ring-0" value={amount} onChange={(event) => setAmount(event.target.value)} required /><span className="flex items-center border-s border-input px-3 font-medium text-muted" dir="ltr">SAR</span></div></div>
              <div className="space-y-1.5"><Label htmlFor="general-payment-date">{t('date')}</Label><Input id="general-payment-date" type="date" dir="ltr" value={date} onChange={(event) => setDate(event.target.value)} required /></div>
              <div className="space-y-1.5"><Label htmlFor="general-payment-method">{t('method')}</Label><Select id="general-payment-method" value={paymentMethodId} onChange={(event) => selectMethod(event.target.value)} required><option value="" disabled>{t('method')}</option>{methods.map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}</Select></div>
              <div className="space-y-1.5"><Label htmlFor="general-payment-account">{t('cash_account')}</Label><Select id="general-payment-account" value={cashAccountId} onChange={(event) => setCashAccountId(event.target.value)} required disabled={!selectedMethod}><option value="" disabled>{t('choose_cash_account')}</option>{compatibleAccounts.map((account) => <option key={account.id} value={account.account_id}>{account.name}</option>)}</Select></div>
              <div className="space-y-1.5"><Label htmlFor="general-payment-collector">{t('collector')}</Label><Select id="general-payment-collector" value={collectorEmployeeId} onChange={(event) => setCollectorEmployeeId(event.target.value)}><option value="">{t('choose_collector')}</option>{collectors.map((collector) => <option key={collector.id} value={collector.id}>{collector.name}{collector.employee_no ? ` — ${collector.employee_no}` : ''}</option>)}</Select></div>
              <div className="space-y-1.5"><Label htmlFor="general-payment-reference">{t('reference')}</Label><Input id="general-payment-reference" value={reference} onChange={(event) => setReference(event.target.value)} placeholder={t('reference_hint')} /></div>
              <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="general-payment-details">{t('payment_details')}</Label><textarea id="general-payment-details" rows={3} value={paymentDetails} onChange={(event) => setPaymentDetails(event.target.value)} placeholder={t('payment_details_placeholder')} className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-text outline-none transition focus-visible:ring-2 focus-visible:ring-primary/40" /></div>
              <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="general-payment-notes">{t('payment_notes')}</Label><textarea id="general-payment-notes" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={t('payment_notes_placeholder')} className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-text outline-none transition focus-visible:ring-2 focus-visible:ring-primary/40" /></div>
            </CardContent>
          </Card>

          <Card><CardHeader><CardTitle>{t('attachments')}</CardTitle></CardHeader><CardContent className="space-y-3"><label htmlFor="general-payment-attachments" className="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted/40 px-4 text-center transition hover:border-primary/50 focus-within:ring-2 focus-within:ring-primary/40"><Paperclip className="h-5 w-5 text-primary" strokeWidth={1.7} /><span className="text-sm font-medium text-text">{t('attachment_prompt')}</span><span className="text-xs text-muted">{t('attachment_hint')}</span><Input id="general-payment-attachments" type="file" multiple className="sr-only" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.jpg,.jpeg,.png,.gif,.zip" onChange={(event) => addFiles(event.target.files)} /></label>{files.length > 0 && <div className="space-y-1.5">{files.map((file, index) => <div key={`${file.name}-${index}`} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"><span className="truncate text-text">{file.name}</span><Button type="button" variant="ghost" size="icon" onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={t('remove_attachment')}><X className="h-4 w-4" strokeWidth={1.8} /></Button></div>)}</div>}</CardContent></Card>
        </div>

        <aside className="space-y-5"><Card><CardHeader><CardTitle>{t('summary')}</CardTitle></CardHeader><CardContent className="space-y-3"><div><p className="text-xs text-muted">{t('direction')}</p><p className="mt-1 text-sm font-medium text-text">{direction === 'received' ? t('received') : t('paid')}</p></div><div><p className="text-xs text-muted">{t('partner')}</p><p className="mt-1 text-sm font-medium text-text">{selectedPartner?.name ?? '—'}</p></div><div className="flex items-start gap-2 text-sm text-text"><FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted" strokeWidth={1.7} /><span className="num">{selectedDocument?.number ?? t('on_account')}</span></div>{selectedDocument && <div><p className="text-xs text-muted">{t('remaining')}</p><p className="num mt-1 text-base font-semibold text-text">{formatRiyal(selectedDocument.remaining)}</p></div>}<p className="border-t border-border pt-3 text-xs leading-5 text-muted">{t('summary_hint')}</p></CardContent></Card></aside>
      </div>

      {error && <p className="rounded-md bg-negative/10 px-4 py-3 text-sm text-negative">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" onClick={() => router.push('/payments')} disabled={saving !== null}>{t('back')}</Button><Button type="button" variant="outline" onClick={() => submit('draft')} disabled={saving !== null}>{saving === 'draft' ? t('save_draft') : t('save_draft')}</Button><Button type="button" onClick={() => submit('post')} disabled={saving !== null}>{saving === 'post' ? t('posting') : t('confirm')}</Button></div>
    </div>
  );
}
