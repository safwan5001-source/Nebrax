'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CircleAlert, Minus, Plus, RotateCcw } from 'lucide-react';
import { PosDialog } from '@/components/pos/pos-dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api, ApiError } from '@/lib/api';
import { formatRiyal } from '@/lib/money';
import { PosCheckoutAttemptController } from '@/lib/pos-checkout-attempt';

type RefundMethod = 'cash' | 'credit';

interface ReturnableInvoice {
  id: string;
  number: string;
  invoice_date: string | null;
  customer_name: string | null;
  total: string;
  cash_refund_policy: 'original_cash_only' | 'allow_any_pos_sale';
  cash_refund_available: string;
}
interface ReturnableLine {
  source_line_id: string;
  description: string | null;
  quantity: number;
  returned: number;
  remaining: number;
  line_total: string;
  returned_total: string;
  remaining_total: string;
}
interface ReturnableInvoiceDetail {
  id: string;
  number: string;
  customer_name: string | null;
  total: string;
  lines: ReturnableLine[];
}
interface Quote { total: string; cash_allowed: boolean; cash_block_reason: string | null }

export function PosReturnDialog({
  open,
  sessionId,
  onClose,
  onReturned,
}: {
  open: boolean;
  sessionId: string | null;
  onClose: () => void;
  onReturned: (number: string) => void;
}) {
  const t = useTranslations('pos');
  const tc = useTranslations('common');
  const [invoices, setInvoices] = useState<ReturnableInvoice[]>([]);
  const [selected, setSelected] = useState<ReturnableInvoice | null>(null);
  const [detail, setDetail] = useState<ReturnableInvoiceDetail | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [method, setMethod] = useState<RefundMethod>('cash');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // مفتاح محاولة مرتجع ثابت لكل فاتورة مختارة: يبقى نفسه عبر إعادة محاولة
  // فشلت، ولا يتجدد إلا بعد نجاح أو تغيير الفاتورة (نية منطقية جديدة).
  const returnAttemptRef = useRef(new PosCheckoutAttemptController());

  const chosenItems = useMemo(() => detail?.lines
    .filter((line) => (quantities[line.source_line_id] ?? 0) > 0)
    .map((line) => ({ source_line_id: line.source_line_id, quantity: quantities[line.source_line_id] ?? 0 })) ?? [], [detail, quantities]);
  const hasItems = chosenItems.length > 0;
  const cashBlocked = method === 'cash' && hasItems && quote !== null && !quote.cash_allowed;
  const policyLabel = selected?.cash_refund_policy === 'allow_any_pos_sale'
    ? t('return_policy_allow_any')
    : t('return_policy_original_cash');

  useEffect(() => {
    if (!open || !sessionId) return;
    let cancelled = false;
    setLoadingInvoices(true);
    setError(null);
    setSelected(null); setDetail(null); setQuantities({}); setQuote(null); setMethod('cash');
    returnAttemptRef.current.reset();
    api<{ data: ReturnableInvoice[] }>(`/pos/returnable-invoices?pos_session_id=${encodeURIComponent(sessionId)}`)
      .then((result) => { if (!cancelled) setInvoices(result.data); })
      .catch((err) => { if (!cancelled) setError(err instanceof ApiError ? err.message : tc('loadFailed')); })
      .finally(() => { if (!cancelled) setLoadingInvoices(false); });
    return () => { cancelled = true; };
  }, [open, sessionId, tc]);

  useEffect(() => {
    if (!sessionId || !selected || !hasItems) { setQuote(null); return; }
    let cancelled = false;
    setQuoting(true);
    setError(null);
    api<{ data: Quote }>('/pos/returns/quote', {
      method: 'POST',
      body: { pos_session_id: sessionId, original_invoice_id: selected.id, payment_type: method, items: chosenItems },
    })
      .then((result) => { if (!cancelled) setQuote(result.data); })
      .catch((err) => { if (!cancelled) { setQuote(null); setError(err instanceof ApiError ? err.message : tc('saveFailed')); } })
      .finally(() => { if (!cancelled) setQuoting(false); });
    return () => { cancelled = true; };
  }, [chosenItems, hasItems, method, selected, sessionId, tc]);

  async function chooseInvoice(invoice: ReturnableInvoice) {
    if (!sessionId) return;
    setSelected(invoice); setDetail(null); setQuantities({}); setQuote(null); setError(null); setLoadingDetail(true);
    // فاتورة أخرى = نية مرتجع منطقية جديدة، لا إعادة محاولة لنفس الطلب.
    returnAttemptRef.current.reset();
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
    setQuantities((previous) => ({
      ...previous,
      [line.source_line_id]: Math.min(line.remaining, Math.max(0, (previous[line.source_line_id] ?? 0) + delta)),
    }));
  }

  async function submit() {
    if (!sessionId || !selected || !hasItems || cashBlocked || quoting) return;
    setSubmitting(true); setError(null);
    // مفتاح ثابت طوال محاولات هذا المرتجع: يحمي من مرتجع مضاعف إن ضاعت
    // الاستجابة الأولى ثم أعاد الكاشير الإرسال (double-submit/retry).
    const idempotencyKey = returnAttemptRef.current.ensure();
    try {
      const result = await api<{ data: { number: string } }>('/pos/returns', {
        method: 'POST',
        body: { idempotency_key: idempotencyKey, pos_session_id: sessionId, original_invoice_id: selected.id, payment_type: method, items: chosenItems },
      });
      returnAttemptRef.current.resetAfterSuccess();
      onReturned(result.data.number);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PosDialog open={open} onClose={onClose} title={t('return_title')} className="max-w-[min(48rem,calc(100vw-2rem))]">
      <div className="space-y-4">
        <p className="rounded bg-primary-soft px-3 py-2 text-xs leading-relaxed text-text">{t('return_hint')}</p>
        {error && <p role="alert" className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}

        {!selected && (
          <section className="space-y-2" aria-label={t('return_invoices')}>
            <h3 className="text-sm font-semibold text-text">{t('return_invoices')}</h3>
            {loadingInvoices ? <Skeleton className="h-32 w-full" /> : invoices.length === 0 ? (
              <p className="rounded border border-dashed border-border px-3 py-7 text-center text-sm text-muted">{t('return_no_invoices')}</p>
            ) : (
              <div className="max-h-80 divide-y divide-border overflow-y-auto rounded border border-border">
                {invoices.map((invoice) => (
                  <button key={invoice.id} type="button" onClick={() => chooseInvoice(invoice)} className="flex w-full items-center justify-between gap-3 px-3 py-3 text-start hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                    <span className="min-w-0"><b className="num block text-sm text-text">{invoice.number}</b><span className="block truncate text-xs text-muted">{invoice.customer_name ?? t('return_unknown_customer')} · {invoice.invoice_date ?? '—'}</span></span>
                    <span className="num shrink-0 text-sm font-semibold text-text">{formatRiyal(invoice.total)}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {selected && (
          <>
            <div className="flex items-center justify-between gap-3 rounded border border-border bg-background px-3 py-2.5">
              <div className="min-w-0"><b className="num block text-sm text-text">{selected.number}</b><span className="block truncate text-xs text-muted">{selected.customer_name ?? t('return_unknown_customer')}</span></div>
              <Button type="button" variant="ghost" size="sm" onClick={() => { setSelected(null); setDetail(null); setQuantities({}); setQuote(null); }}>{t('return_change_invoice')}</Button>
            </div>

            {loadingDetail || !detail ? <Skeleton className="h-48 w-full" /> : (
              <section className="space-y-2" aria-label={t('return_items')}>
                <h3 className="text-sm font-semibold text-text">{t('return_items')}</h3>
                <div className="divide-y divide-border rounded border border-border">
                  {detail.lines.map((line) => {
                    const quantity = quantities[line.source_line_id] ?? 0;
                    const selectable = line.remaining > 0;
                    return <div key={line.source_line_id} className="flex items-center gap-3 px-3 py-3">
                      <div className="min-w-0 flex-1"><b className="block truncate text-sm text-text">{line.description ?? '—'}</b><span className="text-xs text-muted">{t('return_remaining', { count: line.remaining })} · <span className="num">{formatRiyal(line.remaining_total)}</span></span></div>
                      {selectable ? <div className="flex shrink-0 items-center gap-1.5" aria-label={t('return_quantity')}>
                        <Button type="button" variant="outline" size="icon" onClick={() => changeQuantity(line, -1)} disabled={quantity === 0} aria-label={t('return_decrease')}><Minus className="h-3.5 w-3.5" /></Button>
                        <span className="num w-6 text-center text-sm font-semibold" aria-live="polite">{quantity}</span>
                        <Button type="button" variant="outline" size="icon" onClick={() => changeQuantity(line, 1)} disabled={quantity >= line.remaining} aria-label={t('return_increase')}><Plus className="h-3.5 w-3.5" /></Button>
                      </div> : <span className="text-xs text-muted">{t('return_fully_returned')}</span>}
                    </div>;
                  })}
                </div>
              </section>
            )}

            {detail && <section className="space-y-2 rounded border border-border p-3" aria-label={t('return_refund_method')}>
              <h3 className="text-sm font-semibold text-text">{t('return_refund_method')}</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                <button type="button" onClick={() => setMethod('cash')} disabled={cashBlocked} aria-describedby={cashBlocked ? 'cash-refund-reason' : undefined} className={`rounded border px-3 py-2.5 text-start text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${method === 'cash' ? 'border-primary bg-primary-soft text-primary-hover' : 'border-border bg-surface text-text'} disabled:cursor-not-allowed disabled:opacity-50`}>
                  <b className="block">{t('return_cash')}</b><span className="text-xs text-muted">{t('return_cash_policy', { policy: policyLabel, amount: formatRiyal(selected.cash_refund_available) })}</span>
                </button>
                <button type="button" onClick={() => setMethod('credit')} className={`rounded border px-3 py-2.5 text-start text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${method === 'credit' ? 'border-primary bg-primary-soft text-primary-hover' : 'border-border bg-surface text-text'}`}>
                  <b className="block">{t('return_credit')}</b><span className="text-xs text-muted">{t('return_credit_hint')}</span>
                </button>
              </div>
              {cashBlocked && <p id="cash-refund-reason" role="alert" className="flex gap-2 rounded bg-warning/10 px-3 py-2 text-xs text-text"><CircleAlert className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />{quote?.cash_block_reason}</p>}
            </section>}

            <div className="flex flex-col gap-3 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
              <div><p className="text-xs text-muted">{t('return_total')}</p><p className="num text-xl font-bold text-text">{quoting ? t('return_calculating') : quote ? formatRiyal(quote.total) : '—'}</p></div>
              <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>{tc('cancel')}</Button><Button type="button" onClick={submit} disabled={!hasItems || !quote || quoting || submitting || cashBlocked}><RotateCcw className="h-4 w-4" aria-hidden="true" />{submitting ? t('return_submitting') : t('return_confirm')}</Button></div>
            </div>
          </>
        )}
      </div>
    </PosDialog>
  );
}
