'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowRight, Banknote, CalendarClock, Check, Landmark, User } from 'lucide-react';
import { formatRiyal, riyalToMinor } from '@/lib/money';

export interface PaymentSummaryItem { name: string; qty: number; unitPrice: string; lineTotal: number }
export interface PosPaymentMethod {
  id: string;
  name: string;
  name_en: string | null;
  settlement_type: 'cash' | 'bank';
  is_active: boolean;
  is_default: boolean;
}
export interface PosTender { payment_method_id: string; amount: number }

/** شاشة الدفع: وسائل مهيأة للمؤسسة + آجل محكوم بإعداد POS. */
export function PosPayment({
  totalMinor,
  items,
  customerName,
  paymentMethods,
  defaultPaymentMethodId,
  allowDeferredPayment,
  paymentMethodsLoading,
  paymentMethodsLoadError,
  paying,
  error,
  onBack,
  onConfirm,
}: {
  totalMinor: number;
  items: PaymentSummaryItem[];
  customerName: string;
  paymentMethods: PosPaymentMethod[];
  defaultPaymentMethodId: string | null;
  allowDeferredPayment: boolean;
  paymentMethodsLoading: boolean;
  paymentMethodsLoadError: string | null;
  paying: boolean;
  error: string | null;
  onBack: () => void;
  onConfirm: (tenders: PosTender[]) => void;
}) {
  const t = useTranslations('pos');
  const locale = useLocale();
  const [tenders, setTenders] = useState<Record<string, string>>({});
  const [selectedMethodId, setSelectedMethodId] = useState<string | null>(null);

  const resolvedDefaultId = useMemo(() => {
    const configured = paymentMethods.find((method) => method.id === defaultPaymentMethodId);
    return configured?.id ?? paymentMethods.find((method) => method.is_default)?.id ?? paymentMethods[0]?.id ?? null;
  }, [defaultPaymentMethodId, paymentMethods]);

  useEffect(() => {
    setSelectedMethodId((current) => paymentMethods.some((method) => method.id === current) ? current : resolvedDefaultId);
    setTenders((current) => Object.fromEntries(Object.entries(current).filter(([id]) => paymentMethods.some((method) => method.id === id))));
  }, [paymentMethods, resolvedDefaultId]);

  const set = (id: string, value: string) => {
    setSelectedMethodId(id);
    setTenders((current) => ({ ...current, [id]: value }));
  };

  const paidMinor = useMemo(
    () => Object.values(tenders).reduce((sum, value) => sum + riyalToMinor(value), 0),
    [tenders],
  );
  const remainingMinor = Math.max(0, totalMinor - paidMinor);
  const changeMinor = Math.max(0, paidMinor - totalMinor);
  const canConfirm = totalMinor > 0
    && !paymentMethodsLoadError
    && paymentMethods.length > 0
    && (allowDeferredPayment || paidMinor >= totalMinor);
  const quick = [totalMinor / 100, 50, 100, 200, 500];
  const selectedMethod = paymentMethods.find((method) => method.id === selectedMethodId) ?? null;

  function label(method: PosPaymentMethod): string {
    return locale === 'en' ? method.name_en || method.name : method.name;
  }

  function tenderPayload(): PosTender[] {
    return paymentMethods
      .map((method) => ({ payment_method_id: method.id, amount: riyalToMinor(tenders[method.id] ?? '') }))
      .filter((tender) => tender.amount > 0);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface px-3 py-2 sm:gap-3 sm:px-4 sm:py-2.5">
        <button
          onClick={onBack}
          className="flex h-10 items-center gap-2 rounded-lg border border-border px-3 text-[13px] font-semibold text-text hover:bg-background focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <ArrowRight className="h-4 w-4" strokeWidth={2} />
          {t('back_to_cart')}
        </button>
        <div className="flex-1" />
        <div className="hidden items-center gap-1.5 text-xs text-muted sm:flex">
          {t('cart')} ‹ <b className="text-primary-hover">{t('payment')}</b> ‹ {t('receipt')}
        </div>
        <div className="text-sm font-bold text-text sm:hidden">{t('payment')}</div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[340px_1fr]">
        <aside className="hidden flex-col border-b border-border bg-surface lg:flex lg:border-b-0 lg:border-e lg:overflow-y-auto">
          <div className="border-b border-border p-5">
            <div className="mb-1.5 text-xs font-semibold text-muted">{t('invoice_total')}</div>
            <div className="num text-3xl font-extrabold text-primary-hover">
              {formatRiyal(totalMinor / 100)}
            </div>
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold">
              <User className="h-3.5 w-3.5 text-muted" strokeWidth={1.7} />
              {customerName}
            </div>
          </div>
          <div className="flex-1 p-4">
            {items.map((item, index) => (
              <div key={index} className="flex items-center justify-between border-b border-border py-2 text-[12.5px] last:border-0">
                <div>
                  <div className="font-semibold">{item.name}</div>
                  <span className="num text-[11px] text-muted">{item.qty} × {item.unitPrice}</span>
                </div>
                <div className="num font-bold">{formatRiyal(item.lineTotal / 100)}</div>
              </div>
            ))}
          </div>
        </aside>

        <main className="flex min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain p-3 sm:p-5 lg:gap-5 lg:p-7">
          <section className="rounded-lg border border-border bg-surface p-3 lg:hidden">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold text-muted">{t('invoice_total')}</div>
                <div className="num mt-0.5 text-2xl font-extrabold text-primary-hover">
                  {formatRiyal(totalMinor / 100)}
                </div>
              </div>
              <div className="flex min-w-0 max-w-[55%] items-center gap-1.5 rounded-lg bg-background px-2.5 py-2 text-xs font-semibold">
                <User className="h-3.5 w-3.5 shrink-0 text-muted" strokeWidth={1.7} />
                <span className="truncate">{customerName}</span>
              </div>
            </div>
            <details className="mt-2 border-t border-border pt-2">
              <summary className="cursor-pointer select-none text-xs font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                {t('cart')} ({items.length})
              </summary>
              <div className="mt-2 max-h-36 overflow-y-auto pe-1">
                {items.map((item, index) => (
                  <div key={index} className="flex items-center justify-between gap-3 border-b border-border py-2 text-xs last:border-0">
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{item.name}</div>
                      <span className="num text-[10px] text-muted">{item.qty} × {item.unitPrice}</span>
                    </div>
                    <div className="num shrink-0 font-bold">{formatRiyal(item.lineTotal / 100)}</div>
                  </div>
                ))}
              </div>
            </details>
          </section>

          <div>
            <div className="mb-2 text-sm font-bold lg:mb-3">{t('payment_methods')}</div>
            {paymentMethodsLoading ? (
              <p className="rounded-lg border border-border bg-surface px-3 py-3 text-sm text-muted">{t('payment_methods_loading')}</p>
            ) : paymentMethods.length === 0 ? (
              <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-3 text-sm text-text">{t('payment_methods_empty')}</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
                {paymentMethods.map((method) => {
                  const selected = selectedMethodId === method.id;
                  const applied = riyalToMinor(tenders[method.id] ?? '') > 0;
                  const Icon = method.settlement_type === 'cash' ? Banknote : Landmark;
                  return (
                    <div
                      key={method.id}
                      className={'rounded-lg border-[1.5px] bg-surface p-3 sm:p-4 ' + (selected || applied ? 'border-primary bg-primary-soft' : 'border-border')}
                    >
                      <div className="mb-2 flex items-center justify-between sm:mb-2.5">
                        <div className={'grid h-8 w-8 place-items-center rounded-lg sm:h-9 sm:w-9 ' + (selected || applied ? 'bg-primary text-white' : 'bg-background text-muted')}>
                          <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
                        </div>
                        {applied && (
                          <div className="grid h-5 w-5 place-items-center rounded-md bg-primary text-white">
                            <Check className="h-3 w-3" strokeWidth={3} />
                          </div>
                        )}
                      </div>
                      <div className="mb-1.5 truncate text-xs font-bold sm:mb-2 sm:text-[13px]" title={label(method)}>{label(method)}</div>
                      <input
                        aria-label={label(method)}
                        value={tenders[method.id] ?? ''}
                        onFocus={() => setSelectedMethodId(method.id)}
                        onChange={(event) => set(method.id, event.target.value)}
                        inputMode="decimal"
                        placeholder="0.00"
                        className="num w-full rounded-lg border border-border bg-background px-2 py-2 text-center text-sm font-bold text-text outline-none focus:border-primary focus:bg-surface focus-visible:ring-2 focus-visible:ring-primary/40"
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {allowDeferredPayment ? (
            <div className="rounded-lg border border-border bg-background px-3 py-2.5 text-xs text-muted">
              <CalendarClock className="me-1.5 inline h-3.5 w-3.5" strokeWidth={1.7} />
              {t('deferred_payment')}
            </div>
          ) : (
            <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-xs text-text">
              {t('deferred_payment_disabled')}
            </div>
          )}

          <div>
            <div className="mb-2 text-sm font-bold lg:mb-2.5">{t('quick_amounts')}</div>
            <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
              {quick.map((amount, index) => (
                <button
                  key={index}
                  onClick={() => selectedMethod && set(selectedMethod.id, amount.toFixed(2))}
                  disabled={!selectedMethod}
                  className={
                    'num min-h-10 rounded-lg border px-2 py-2 text-[13px] font-bold focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50 sm:px-4 ' +
                    (index === 0 ? 'col-span-2 sm:col-auto ' : '') +
                    (index === 0 ? 'border-primary bg-primary-soft text-primary-hover' : 'border-border bg-background text-text hover:border-primary')
                  }
                >
                  {index === 0 ? t('exact_amount') : amount}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <div className="min-w-0 rounded-lg border border-border bg-surface p-2.5 sm:p-4">
              <div className="mb-1 text-[10px] font-semibold text-muted sm:mb-1.5 sm:text-[11px]">{t('paid')}</div>
              <div className="num truncate text-sm font-extrabold text-positive sm:text-lg" title={formatRiyal(paidMinor / 100)}>{formatRiyal(paidMinor / 100)}</div>
            </div>
            <div className="min-w-0 rounded-lg border border-border bg-surface p-2.5 sm:p-4">
              <div className="mb-1 text-[10px] font-semibold text-muted sm:mb-1.5 sm:text-[11px]">{t('remaining')}</div>
              <div className="num truncate text-sm font-extrabold text-negative sm:text-lg" title={formatRiyal(remainingMinor / 100)}>{formatRiyal(remainingMinor / 100)}</div>
            </div>
            <div className="min-w-0 rounded-lg border border-border bg-surface p-2.5 sm:p-4">
              <div className="mb-1 text-[10px] font-semibold text-muted sm:mb-1.5 sm:text-[11px]">{t('change')}</div>
              <div className="num truncate text-sm font-extrabold text-primary-hover sm:text-lg" title={formatRiyal(changeMinor / 100)}>{formatRiyal(changeMinor / 100)}</div>
            </div>
          </div>

          {(error ?? paymentMethodsLoadError) && <p className="rounded-lg bg-negative/10 px-3 py-2 text-xs text-negative">{error ?? paymentMethodsLoadError}</p>}
        </main>
      </div>

      <footer className="flex shrink-0 border-t border-border bg-surface px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:p-4">
        <button
          onClick={() => onConfirm(tenderPayload())}
          disabled={!canConfirm || paying || paymentMethodsLoading}
          className="flex min-h-12 flex-1 items-center justify-center gap-2.5 rounded-lg bg-primary px-4 py-3 text-base font-bold text-white focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50"
        >
          <Check className="h-5 w-5" strokeWidth={2.2} />
          {t('confirm_payment')}
        </button>
      </footer>
    </div>
  );
}
