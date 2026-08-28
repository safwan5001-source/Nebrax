'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CircleAlert, Minus, Plus, Repeat2 } from 'lucide-react';
import { PosDialog } from '@/components/pos/pos-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { api, ApiError } from '@/lib/api';
import { formatRiyal, riyalToMinor } from '@/lib/money';

type SurplusMethod = 'credit' | 'cash';
type TenderKey = 'cash' | 'card' | 'transfer' | 'credit';

export interface PosExchangeReplacementLine {
  productId: string | null;
  description: string;
  price: string;
  qty: number;
  tax: number;
  discount: string;
}

interface ReturnableInvoice { id: string; number: string; invoice_date: string | null; customer_name: string | null; total: string }
interface ReturnableLine { source_line_id: string; description: string | null; remaining: number; remaining_total: string }
interface ReturnableInvoiceDetail { id: string; number: string; customer_name: string | null; lines: ReturnableLine[] }
interface ExchangeQuote { return_total: string; exchange_surplus_policy: 'customer_credit_only' | 'allow_cash_refund'; cash_allowed: boolean; cash_block_reason: string | null }

export function PosExchangeDialog({
  open,
  sessionId,
  replacementItems,
  replacementTotalMinor,
  taxInclusive,
  onClose,
  onExchanged,
}: {
  open: boolean;
  sessionId: string | null;
  replacementItems: PosExchangeReplacementLine[];
  replacementTotalMinor: number;
  taxInclusive: boolean;
  onClose: () => void;
  onExchanged: (replacementNumber: string) => void;
}) {
  const t = useTranslations('pos');
  const tc = useTranslations('common');
  const [invoices, setInvoices] = useState<ReturnableInvoice[]>([]);
  const [selected, setSelected] = useState<ReturnableInvoice | null>(null);
  const [detail, setDetail] = useState<ReturnableInvoiceDetail | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [quote, setQuote] = useState<ExchangeQuote | null>(null);
  const [surplusMethod, setSurplusMethod] = useState<SurplusMethod>('credit');
  const [tenders, setTenders] = useState<Record<TenderKey, string>>({ cash: '', card: '', transfer: '', credit: '' });
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosenItems = useMemo(() => detail?.lines
    .filter((line) => (quantities[line.source_line_id] ?? 0) > 0)
    .map((line) => ({ source_line_id: line.source_line_id, quantity: quantities[line.source_line_id] ?? 0 })) ?? [], [detail, quantities]);
  const hasReturnItems = chosenItems.length > 0;
  const returnTotalMinor = quote ? riyalToMinor(quote.return_total) : 0;
  const surplusMinor = Math.max(0, returnTotalMinor - replacementTotalMinor);
  const dueMinor = Math.max(0, replacementTotalMinor - returnTotalMinor);
  const tenderMinor = useMemo(() => (Object.keys(tenders) as TenderKey[]).reduce((sum, key) => sum + riyalToMinor(tenders[key]), 0), [tenders]);
  const cashUnavailable = surplusMinor > 0 && quote !== null && !quote.cash_allowed;
  const cashBlocked = surplusMethod === 'cash' && cashUnavailable;
  const canSubmit = replacementItems.length > 0 && hasReturnItems && quote !== null && !quoting && !cashBlocked && (dueMinor === 0 || tenderMinor >= dueMinor);

  useEffect(() => {
    if (!open || !sessionId) return;
    let cancelled = false;
    setLoadingInvoices(true); setError(null); setInvoices([]); setSelected(null); setDetail(null); setQuantities({}); setQuote(null); setSurplusMethod('credit'); setTenders({ cash: '', card: '', transfer: '', credit: '' });
    api<{ data: ReturnableInvoice[] }>(`/pos/returnable-invoices?pos_session_id=${encodeURIComponent(sessionId)}`)
      .then((result) => { if (!cancelled) setInvoices(result.data); })
      .catch((err) => { if (!cancelled) setError(err instanceof ApiError ? err.message : tc('loadFailed')); })
      .finally(() => { if (!cancelled) setLoadingInvoices(false); });
    return () => { cancelled = true; };
  }, [open, sessionId, tc]);

  useEffect(() => {
    if (!sessionId || !selected || !hasReturnItems) { setQuote(null); return; }
    let cancelled = false;
    setQuoting(true); setError(null);
    const returnItems = chosenItems;
    api<{ data: ExchangeQuote }>('/pos/exchanges/quote', {
      method: 'POST',
      body: { pos_session_id: sessionId, original_invoice_id: selected.id, return_items: returnItems, cash_surplus_amount: Math.max(0, returnTotalMinor - replacementTotalMinor) },
    })
      .then((result) => { if (!cancelled) setQuote(result.data); })
      .catch((err) => { if (!cancelled) { setQuote(null); setError(err instanceof ApiError ? err.message : tc('saveFailed')); } })
      .finally(() => { if (!cancelled) setQuoting(false); });
    return () => { cancelled = true; };
  }, [chosenItems, hasReturnItems, replacementTotalMinor, returnTotalMinor, selected, sessionId, tc]);

  async function chooseInvoice(invoice: ReturnableInvoice) {
    if (!sessionId) return;
    setSelected(invoice); setDetail(null); setQuantities({}); setQuote(null); setError(null); setLoadingDetail(true);
    try {
      const result = await api<{ data: ReturnableInvoiceDetail }>(`/pos/returnable-invoices/${invoice.id}?pos_session_id=${encodeURIComponent(sessionId)}`);
      setDetail(result.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('loadFailed'));
    } finally {
      setLoadingDetail(false);
    }
  }

  function changeQuantity(line: ReturnableLine, delta: number) {
    setQuantities((previous) => ({ ...previous, [line.source_line_id]: Math.min(line.remaining, Math.max(0, (previous[line.source_line_id] ?? 0) + delta)) }));
  }

  async function submit() {
    if (!sessionId || !selected || !canSubmit) return;
    setSubmitting(true); setError(null);
    try {
      const result = await api<{ data: { replacement_invoice: { number: string } } }>('/pos/exchanges', {
        method: 'POST',
        body: {
          pos_session_id: sessionId,
          original_invoice_id: selected.id,
          return_items: chosenItems,
          surplus_refund_method: surplusMinor > 0 ? surplusMethod : 'credit',
          replacement: {
            tax_inclusive: taxInclusive,
            items: replacementItems.map((line) => ({ product_id: line.productId, description: line.description, quantity: line.qty, unit_price: riyalToMinor(line.price), tax_rate: line.tax, discount: riyalToMinor(line.discount) })),
            tenders: { cash: riyalToMinor(tenders.cash), card: riyalToMinor(tenders.card), transfer: riyalToMinor(tenders.transfer), credit: riyalToMinor(tenders.credit) },
          },
        },
      });
      onExchanged(result.data.replacement_invoice.number);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  const policyLabel = quote?.exchange_surplus_policy === 'allow_cash_refund' ? t('exchange_policy_allow_cash') : t('exchange_policy_credit_only');

  return (
    <PosDialog open={open} onClose={onClose} title={t('exchange_title')} className="max-w-[min(56rem,calc(100vw-2rem))]">
      <div className="space-y-4">
        <p className="rounded bg-primary-soft px-3 py-2 text-xs leading-relaxed text-text">{t('exchange_hint')}</p>
        {error && <p role="alert" className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}
        {replacementItems.length === 0 ? <p className="rounded border border-dashed border-border px-3 py-7 text-center text-sm text-muted">{t('exchange_cart_required')}</p> : <section className="space-y-2 rounded border border-border p-3" aria-label={t('exchange_replacement_items')}>
          <h3 className="text-sm font-semibold text-text">{t('exchange_replacement_items')}</h3>
          <div className="max-h-28 divide-y divide-border overflow-y-auto">
            {replacementItems.map((line, index) => <div key={`${line.productId ?? 'line'}-${index}`} className="flex items-center justify-between gap-3 py-2 text-xs"><span className="min-w-0 truncate text-text">{line.description} · <span className="num">{line.qty}</span></span><span className="num shrink-0 font-semibold text-text">{formatRiyal(replacementLineTotal(line, taxInclusive))}</span></div>)}
          </div>
          <div className="flex items-center justify-between border-t border-border pt-2 text-sm"><span className="text-muted">{t('exchange_replacement_total')}</span><b className="num text-text">{formatRiyal(replacementTotalMinor / 100)}</b></div>
        </section>}

        {!selected && <section className="space-y-2" aria-label={t('exchange_invoices')}>
          <h3 className="text-sm font-semibold text-text">{t('exchange_invoices')}</h3>
          {loadingInvoices ? <Skeleton className="h-32 w-full" /> : invoices.length === 0 ? <p className="rounded border border-dashed border-border px-3 py-7 text-center text-sm text-muted">{t('return_no_invoices')}</p> : <div className="max-h-60 divide-y divide-border overflow-y-auto rounded border border-border">
            {invoices.map((invoice) => <button key={invoice.id} type="button" onClick={() => chooseInvoice(invoice)} className="flex w-full items-center justify-between gap-3 px-3 py-3 text-start hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><span className="min-w-0"><b className="num block text-sm text-text">{invoice.number}</b><span className="block truncate text-xs text-muted">{invoice.customer_name ?? t('return_unknown_customer')} · {invoice.invoice_date ?? '—'}</span></span><span className="num shrink-0 text-sm font-semibold text-text">{formatRiyal(invoice.total)}</span></button>)}
          </div>}
        </section>}

        {selected && <>
          <div className="flex items-center justify-between gap-3 rounded border border-border bg-background px-3 py-2.5"><div className="min-w-0"><b className="num block text-sm text-text">{selected.number}</b><span className="block truncate text-xs text-muted">{t('exchange_customer_from_invoice', { customer: selected.customer_name ?? t('return_unknown_customer') })}</span></div><Button type="button" variant="ghost" size="sm" onClick={() => { setSelected(null); setDetail(null); setQuantities({}); setQuote(null); }}>{t('return_change_invoice')}</Button></div>
          {loadingDetail || !detail ? <Skeleton className="h-40 w-full" /> : <section className="space-y-2" aria-label={t('exchange_return_items')}><h3 className="text-sm font-semibold text-text">{t('exchange_return_items')}</h3><div className="divide-y divide-border rounded border border-border">{detail.lines.map((line) => { const quantity = quantities[line.source_line_id] ?? 0; return <div key={line.source_line_id} className="flex items-center gap-3 px-3 py-3"><div className="min-w-0 flex-1"><b className="block truncate text-sm text-text">{line.description ?? '—'}</b><span className="text-xs text-muted">{t('return_remaining', { count: line.remaining })} · <span className="num">{formatRiyal(line.remaining_total)}</span></span></div>{line.remaining > 0 ? <div className="flex shrink-0 items-center gap-1.5" aria-label={t('return_quantity')}><Button type="button" variant="outline" size="icon" onClick={() => changeQuantity(line, -1)} disabled={quantity === 0} aria-label={t('return_decrease')}><Minus className="h-3.5 w-3.5" /></Button><span className="num w-6 text-center text-sm font-semibold" aria-live="polite">{quantity}</span><Button type="button" variant="outline" size="icon" onClick={() => changeQuantity(line, 1)} disabled={quantity >= line.remaining} aria-label={t('return_increase')}><Plus className="h-3.5 w-3.5" /></Button></div> : <span className="text-xs text-muted">{t('return_fully_returned')}</span>}</div>; })}</div></section>}

          {quote && <section className="space-y-3 rounded border border-border p-3" aria-label={t('exchange_settlement')}>
            <div className="grid gap-2 sm:grid-cols-3"><Amount label={t('exchange_return_total')} value={formatRiyal(quote.return_total)} /><Amount label={t('exchange_replacement_total')} value={formatRiyal(replacementTotalMinor / 100)} /><Amount label={surplusMinor > 0 ? t('exchange_surplus') : t('exchange_due')} value={formatRiyal((surplusMinor || dueMinor) / 100)} emphasis /></div>
            {surplusMinor > 0 && <><h3 className="text-sm font-semibold text-text">{t('exchange_surplus_method')}</h3><div className="grid gap-2 sm:grid-cols-2"><button type="button" onClick={() => setSurplusMethod('credit')} className={`rounded border px-3 py-2.5 text-start text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${surplusMethod === 'credit' ? 'border-primary bg-primary-soft text-primary-hover' : 'border-border bg-surface text-text'}`}><b className="block">{t('return_credit')}</b><span className="text-xs text-muted">{t('exchange_policy_credit_only')}</span></button><button type="button" onClick={() => setSurplusMethod('cash')} disabled={cashUnavailable} aria-describedby={cashUnavailable ? 'exchange-cash-reason' : undefined} className={`rounded border px-3 py-2.5 text-start text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${surplusMethod === 'cash' ? 'border-primary bg-primary-soft text-primary-hover' : 'border-border bg-surface text-text'} disabled:cursor-not-allowed disabled:opacity-50`}><b className="block">{t('return_cash')}</b><span className="text-xs text-muted">{t('exchange_policy_label', { policy: policyLabel })}</span></button></div>{cashUnavailable && <p id="exchange-cash-reason" role="alert" className="flex gap-2 rounded bg-warning/10 px-3 py-2 text-xs text-text"><CircleAlert className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />{quote.cash_block_reason}</p>}</>}
            {dueMinor > 0 && <div className="space-y-2"><h3 className="text-sm font-semibold text-text">{t('exchange_collect_difference')}</h3><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{(['cash', 'card', 'transfer', 'credit'] as TenderKey[]).map((key) => <div key={key} className="space-y-1"><Label htmlFor={`exchange-${key}`}>{t(`method_${key}`)}</Label><Input id={`exchange-${key}`} value={tenders[key]} onChange={(event) => setTenders((current) => ({ ...current, [key]: event.target.value }))} inputMode="decimal" placeholder="0.00" /></div>)}</div>{tenderMinor < dueMinor && <p role="alert" className="text-xs text-warning">{t('exchange_remaining_difference', { amount: formatRiyal((dueMinor - tenderMinor) / 100) })}</p>}</div>}
          </section>}
          <div className="flex flex-col gap-3 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs text-muted">{t('exchange_action_total')}</p><p className="num text-xl font-bold text-text">{quoting ? t('return_calculating') : quote ? formatRiyal((surplusMinor || dueMinor) / 100) : '—'}</p></div><div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>{tc('cancel')}</Button><Button type="button" onClick={submit} disabled={!canSubmit || submitting}><Repeat2 className="h-4 w-4" aria-hidden="true" />{submitting ? t('exchange_submitting') : t('exchange_confirm')}</Button></div></div>
        </>}
      </div>
    </PosDialog>
  );
}

function Amount({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return <div className="rounded bg-background px-3 py-2"><p className="text-xs text-muted">{label}</p><p className={`num text-sm font-bold ${emphasis ? 'text-primary-hover' : 'text-text'}`}>{value}</p></div>;
}

function replacementLineTotal(line: PosExchangeReplacementLine, taxInclusive: boolean): number {
  const gross = line.qty * riyalToMinor(line.price);
  const discount = Math.min(Math.max(0, riyalToMinor(line.discount)), gross);
  const base = gross - discount;
  if (taxInclusive) return base / 100;

  return (base + Math.round((base * line.tax) / 100)) / 100;
}
