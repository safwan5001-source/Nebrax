'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
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

interface SourceDocument {
  id: string;
  number: string;
  partner_id: string;
  status: string;
  payment_status: string;
  remaining: string;
}

interface Partner { id: string; name: string }

interface PaymentMethod {
  id: string;
  name: string;
  settlement_type: 'cash' | 'bank';
  cash_bank_account_id: string | null;
  is_active: boolean;
  is_default: boolean;
}

interface CashBankAccount {
  id: string;
  account_id: string;
  name: string;
  type: 'cash' | 'bank';
  is_active: boolean;
  is_main: boolean;
}

interface Collector { id: string; name: string; employee_no: string }

type SubmitMode = 'draft' | 'post';
export type PaymentDocumentKind = 'invoice' | 'purchase';

interface DocumentPaymentFormProps {
  documentId: string;
  documentKind: PaymentDocumentKind;
}

const documentConfig = {
  invoice: {
    endpoint: 'invoices',
    direction: 'received' as const,
    translationNamespace: 'receiptVouchers',
    detailPath: (id: string) => `/invoices/${id}`,
    draftPath: (id: string) => `/receipt-vouchers/${id}`,
  },
  purchase: {
    endpoint: 'purchases',
    direction: 'paid' as const,
    translationNamespace: 'purchasePayments',
    detailPath: (id: string) => `/purchases/${id}`,
    draftPath: (id: string) => `/payments/${id}`,
  },
} as const;

export function DocumentPaymentForm({ documentId, documentKind }: DocumentPaymentFormProps) {
  const config = documentConfig[documentKind];
  const t = useTranslations(config.translationNamespace);
  const tc = useTranslations('common');
  const router = useRouter();
  const { success } = useToast();
  const [document, setDocument] = useState<SourceDocument | null>(null);
  const [partnerName, setPartnerName] = useState('');
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [accounts, setAccounts] = useState<CashBankAccount[]>([]);
  const [collectors, setCollectors] = useState<Collector[]>([]);
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
  const compatibleAccounts = useMemo(
    () => accounts.filter((account) => account.is_active && account.type === selectedMethod?.settlement_type),
    [accounts, selectedMethod?.settlement_type],
  );
  const amountMinor = riyalToMinor(amount);
  const remainingMinor = riyalToMinor(document?.remaining ?? '0');

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
        const [documentResponse, partnersResponse, methodsResponse, accountsResponse, collectorsResponse] = await Promise.all([
          api<{ data: SourceDocument }>(`/${config.endpoint}/${documentId}`),
          api<{ data: Partner[] }>('/partners'),
          api<{ data: PaymentMethod[] }>('/payment-methods'),
          api<{ data: CashBankAccount[] }>('/cash-bank-accounts'),
          api<{ data: Collector[] }>('/payments/collectors'),
        ]);
        if (cancelled) return;

        const loadedDocument = documentResponse.data;
        if (loadedDocument.status !== 'posted' || loadedDocument.payment_status === 'paid') {
          setError(t('load_document_payment_failed'));
          return;
        }

        const activeMethods = methodsResponse.data.filter((method) => method.is_active);
        const defaultMethod = activeMethods.find((method) => method.is_default) ?? activeMethods[0] ?? null;
        const currentEmployeeId = currentUser()?.employee_id ?? '';
        setDocument(loadedDocument);
        setPartnerName(partnersResponse.data.find((partner) => partner.id === loadedDocument.partner_id)?.name ?? '—');
        setMethods(activeMethods);
        setAccounts(accountsResponse.data);
        setCollectors(collectorsResponse.data);
        setAmount(loadedDocument.remaining);
        setDate(new Date().toISOString().slice(0, 10));
        setPaymentMethodId(defaultMethod?.id ?? '');
        setCashAccountId(defaultMethod ? resolveAccount(defaultMethod, accountsResponse.data)?.account_id ?? '' : '');
        setCollectorEmployeeId(currentEmployeeId);
      } catch (requestError) {
        if (!cancelled) setError(requestError instanceof ApiError ? requestError.message : t('load_document_payment_failed'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [config.endpoint, documentId, resolveAccount, t]);

  function selectMethod(id: string) {
    setPaymentMethodId(id);
    const method = methods.find((candidate) => candidate.id === id);
    setCashAccountId(method ? resolveAccount(method, accounts)?.account_id ?? '' : '');
  }

  function addFiles(nextFiles: FileList | null) {
    if (!nextFiles) return;
    setFiles((current) => [...current, ...Array.from(nextFiles)].slice(0, 10));
  }

  async function submit(mode: SubmitMode) {
    if (!document || amountMinor <= 0 || amountMinor > remainingMinor || !paymentMethodId || !cashAccountId) {
      setError(tc('saveFailed'));
      return;
    }

    setSaving(mode);
    setError(null);
    const body = new FormData();
    body.append('partner_id', document.partner_id);
    body.append(documentKind === 'invoice' ? 'invoice_id' : 'purchase_id', document.id);
    body.append('direction', config.direction);
    body.append('payment_method_id', paymentMethodId);
    body.append('cash_account_id', cashAccountId);
    body.append('amount', String(amountMinor));
    body.append('payment_date', date);
    if (collectorEmployeeId) body.append('collector_employee_id', collectorEmployeeId);
    if (reference.trim()) body.append('reference', reference.trim());
    if (paymentDetails.trim()) body.append('payment_details', paymentDetails.trim());
    if (notes.trim()) body.append('notes', notes.trim());
    files.forEach((file) => body.append('attachments[]', file));

    try {
      const created = await api<{ data: { id: string } }>('/payments', { method: 'POST', body });
      if (mode === 'post') {
        await api(`/payments/${created.data.id}/post`, { method: 'POST' });
        success(t('confirm_document_payment_success'));
        router.push(config.detailPath(document.id));
      } else {
        success(t('save_draft_success'));
        router.push(config.draftPath(created.data.id));
      }
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : tc('saveFailed'));
    } finally {
      setSaving(null);
    }
  }

  if (loading) {
    return <p className="text-sm text-muted">{t('loading_document_payment')}</p>;
  }

  if (!document) {
    return <p className="rounded-md bg-negative/10 px-4 py-3 text-sm text-negative">{error ?? t('load_document_payment_failed')}</p>;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.push(config.detailPath(document.id))} aria-label={t('back')}>
            <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
          </Button>
          <div>
            <h1 className="text-xl font-semibold text-text">{t('document_payment_title')}</h1>
            <p className="mt-1 text-sm text-muted">{t('document_payment_subtitle')}</p>
          </div>
        </div>
        <span className="rounded-md bg-muted px-3 py-1.5 text-sm text-muted">{t('draft')}</span>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle>{t('detail_title')}</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="document-payment-amount">{t('amount')}</Label>
                <div className="flex rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-primary/40">
                  <Input id="document-payment-amount" inputMode="decimal" className="num border-0 text-end shadow-none focus-visible:ring-0" value={amount} onChange={(event) => setAmount(event.target.value)} required />
                  <span className="flex items-center border-s border-input px-3 font-medium text-muted" dir="ltr">SAR</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="document-payment-date">{t('date')}</Label>
                <Input id="document-payment-date" type="date" dir="ltr" value={date} onChange={(event) => setDate(event.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="document-payment-method">{t('method')}</Label>
                <Select id="document-payment-method" value={paymentMethodId} onChange={(event) => selectMethod(event.target.value)} required>
                  <option value="" disabled>{t('method')}</option>
                  {methods.map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="document-payment-account">{t('cash_account')}</Label>
                <Select id="document-payment-account" value={cashAccountId} onChange={(event) => setCashAccountId(event.target.value)} required disabled={!selectedMethod}>
                  <option value="" disabled>{t('choose_cash_account')}</option>
                  {compatibleAccounts.map((account) => <option key={account.id} value={account.account_id}>{account.name}</option>)}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="document-payment-collector">{t('collector')}</Label>
                <Select id="document-payment-collector" value={collectorEmployeeId} onChange={(event) => setCollectorEmployeeId(event.target.value)}>
                  <option value="">{t('choose_collector')}</option>
                  {collectors.map((collector) => <option key={collector.id} value={collector.id}>{collector.name}{collector.employee_no ? ` — ${collector.employee_no}` : ''}</option>)}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="document-payment-reference">{t('reference')}</Label>
                <Input id="document-payment-reference" value={reference} onChange={(event) => setReference(event.target.value)} placeholder={t('reference_hint')} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="document-payment-details">{t('payment_details')}</Label>
                <textarea id="document-payment-details" rows={3} value={paymentDetails} onChange={(event) => setPaymentDetails(event.target.value)} placeholder={t('payment_details_placeholder')} className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-text outline-none transition focus-visible:ring-2 focus-visible:ring-primary/40" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="document-payment-notes">{t('payment_notes')}</Label>
                <textarea id="document-payment-notes" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={t('payment_notes_placeholder')} className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-text outline-none transition focus-visible:ring-2 focus-visible:ring-primary/40" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>{t('attachments')}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <label htmlFor="document-payment-attachments" className="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted/40 px-4 text-center transition hover:border-primary/50 focus-within:ring-2 focus-within:ring-primary/40">
                <Paperclip className="h-5 w-5 text-primary" strokeWidth={1.7} />
                <span className="text-sm font-medium text-text">{t('attachment_prompt')}</span>
                <span className="text-xs text-muted">{t('attachment_hint')}</span>
                <Input id="document-payment-attachments" type="file" multiple className="sr-only" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.jpg,.jpeg,.png,.gif,.zip" onChange={(event) => addFiles(event.target.files)} />
              </label>
              {files.length > 0 && <div className="space-y-1.5">{files.map((file, index) => (
                <div key={`${file.name}-${index}`} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
                  <span className="truncate text-text">{file.name}</span>
                  <Button type="button" variant="ghost" size="icon" onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={t('remove_attachment')}>
                    <X className="h-4 w-4" strokeWidth={1.8} />
                  </Button>
                </div>
              ))}</div>}
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-5">
          <Card>
            <CardHeader><CardTitle>{t('document_summary')}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-start gap-2 text-sm text-text"><FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted" strokeWidth={1.7} /><span className="num">{document.number}</span></div>
              <div><p className="text-xs text-muted">{t('partner')}</p><p className="mt-1 text-sm font-medium text-text">{partnerName}</p></div>
              <div><p className="text-xs text-muted">{t('remaining')}</p><p className="num mt-1 text-base font-semibold text-text">{formatRiyal(document.remaining)}</p></div>
              <p className="border-t border-border pt-3 text-xs leading-5 text-muted">{t('document_payment_only')}</p>
            </CardContent>
          </Card>
        </aside>
      </div>

      {error && <p className="rounded-md bg-negative/10 px-4 py-3 text-sm text-negative">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.push(config.detailPath(document.id))} disabled={saving !== null}>{t('back')}</Button>
        <Button type="button" variant="outline" onClick={() => submit('draft')} disabled={saving !== null}>{saving === 'draft' ? t('save_draft') : t('save_draft')}</Button>
        <Button type="button" onClick={() => submit('post')} disabled={saving !== null}>{saving === 'post' ? t('posting') : t('confirm_document_payment')}</Button>
      </div>
    </div>
  );
}
