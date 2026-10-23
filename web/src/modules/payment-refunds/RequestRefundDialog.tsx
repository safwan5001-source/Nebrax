'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { formatPayAmount } from '@/lib/pay-link';
import { apiErrorCode } from '@/modules/payments/gateways/contract';
import { autoAllocate, knownError, maxRefundable, newIdempotencyKey, parseMajorToMinor, type RefundContext, type RefundRow } from './contract';

/**
 * طلب استرداد (PAY-H3-01e، `payment_refunds.request`): يقرأ سياق الدفعة من الخادم (السعة والمانع والمصادر المؤهَّلة)، ويقترح التخصيص تلقائياً على الأقدم
 * (يُعرض ولا يُخفى)، ويرسل بمفتاح منع تكرار ثابت لمحاولة النموذج الواحدة. **الطلب لا يُخرج مالاً**: يحتاج اعتماداً من مستخدم آخر. الخادم حاسم في كل سقف.
 */
export function RequestRefundDialog({ attemptId, onClose, onDone }: { attemptId: string; onClose: () => void; onDone: (refund: RefundRow) => void }) {
  const t = useTranslations('paymentRefunds');
  const toast = useToast();
  const [ctx, setCtx] = useState<RefundContext | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef(newIdempotencyKey());

  useEffect(() => {
    let live = true;
    api<{ data: RefundContext }>(`/payment-attempts/${attemptId}/refund-context`)
      .then((res) => { if (live) setCtx(res.data); })
      .catch(() => { if (live) setLoadFailed(true); });
    return () => { live = false; };
  }, [attemptId]);

  const minor = parseMajorToMinor(amount);
  const max = ctx ? maxRefundable(ctx) : 0;
  const allocations = useMemo(() => (ctx && minor !== null ? autoAllocate(ctx.sources, minor) : null), [ctx, minor]);
  const overMax = minor !== null && minor > max;
  const valid = ctx?.eligible === true && minor !== null && !overMax && allocations !== null;

  async function submit() {
    if (!ctx || minor === null || allocations === null) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api<{ data: RefundRow }>('/payment-refunds', {
        method: 'POST',
        body: { payment_attempt_id: attemptId, amount_minor: minor, idempotency_key: key.current, allocations },
      });
      toast.success(t('request_done'));
      onDone(res.data);
    } catch (e) {
      setError(t(`error_${knownError(apiErrorCode(e))}` as 'error_unknown'));
      setSaving(false);
    }
  }

  return (
    <Dialog open title={t('request_title')} onClose={onClose} closeLabel={t('close')}>
      <div className="space-y-4">
        <p className="text-sm leading-6 text-muted">{t('request_intro')}</p>
        {loadFailed && <p role="alert" className="text-sm text-negative">{t('load_failed')}</p>}
        {!loadFailed && !ctx && <p role="status" className="text-sm text-muted">{t('loading')}</p>}
        {ctx && !ctx.eligible && (
          <p role="alert" className="rounded border border-negative/30 bg-negative/5 p-3 text-sm leading-6 text-negative">
            {t(`error_${knownError(ctx.blocker?.code)}` as 'error_unknown')}
          </p>
        )}
        {ctx && ctx.eligible && (
          <>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div><dt className="text-xs text-muted">{t('captured')}</dt><dd><bdi dir="ltr">{formatPayAmount(ctx.captured_minor, ctx.currency)}</bdi></dd></div>
              <div><dt className="text-xs text-muted">{t('already_refunded')}</dt><dd><bdi dir="ltr">{formatPayAmount(ctx.refunded_minor, ctx.currency)}</bdi></dd></div>
              <div className="col-span-2"><dt className="text-xs text-muted">{t('max_refundable')}</dt><dd className="font-medium"><bdi dir="ltr">{formatPayAmount(max, ctx.currency)}</bdi></dd></div>
            </dl>
            {ctx.sources.length === 0 ? (
              <p role="note" className="text-sm leading-6 text-muted">{t('no_sources')}</p>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="rf-amount">{t('amount')} ({ctx.currency})</Label>
                  <Input id="rf-amount" inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={overMax || (amount !== '' && minor === null)} aria-describedby="rf-amount-hint" />
                  <p id="rf-amount-hint" className="text-xs text-muted">{overMax ? t('amount_over', { max: formatPayAmount(max, ctx.currency) }) : t('amount_hint')}</p>
                </div>
                {allocations && (
                  <section aria-labelledby="rf-alloc" className="space-y-2">
                    <h3 id="rf-alloc" className="text-sm font-semibold">{t('allocation')}</h3>
                    <ul className="divide-y divide-border rounded border border-border text-sm">
                      {allocations.map((a) => {
                        const source = ctx.sources.find((s) => s.id === a.source_id);
                        return (
                          <li key={a.source_id} className="flex items-center justify-between gap-3 px-3 py-2">
                            <span>{t(a.source_type === 'credit_note' ? 'source_credit_note' : 'source_sales_return')} · <bdi dir="ltr">{source?.number ?? '—'}</bdi></span>
                            <bdi dir="ltr">{formatPayAmount(a.amount_minor, ctx.currency)}</bdi>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                )}
                {minor !== null && !overMax && allocations === null && <p role="alert" className="text-sm text-negative">{t('allocation_short')}</p>}
              </>
            )}
          </>
        )}
        {error && <p role="alert" className="text-sm text-negative">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>{t('cancel')}</Button>
          <Button onClick={() => void submit()} disabled={saving || !valid} aria-busy={saving}>{saving ? t('request_saving') : t('request_submit')}</Button>
        </div>
      </div>
    </Dialog>
  );
}
