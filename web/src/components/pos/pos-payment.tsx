'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowRight, Banknote, CreditCard, Landmark, CalendarClock, Check, Printer, User } from 'lucide-react';
import { formatRiyal, riyalToMinor } from '@/lib/money';

export interface PaymentSummaryItem { name: string; qty: number; unitPrice: string; lineTotal: number }

const METHODS = [
  { key: 'cash', icon: Banknote },
  { key: 'card', icon: CreditCard },
  { key: 'transfer', icon: Landmark },
  { key: 'credit', icon: CalendarClock },
] as const;

type MethodKey = (typeof METHODS)[number]['key'];

/** شاشة الدفع: طرق متعددة قابلة للتفعيل معاً + مبالغ سريعة + حساب حيّ. */
export function PosPayment({
  totalMinor,
  items,
  customerName,
  paying,
  error,
  onBack,
  onConfirm,
}: {
  totalMinor: number;
  items: PaymentSummaryItem[];
  customerName: string;
  paying: boolean;
  error: string | null;
  onBack: () => void;
  onConfirm: (tenders: Record<MethodKey, number>) => void;
}) {
  const t = useTranslations('pos');
  const [tenders, setTenders] = useState<Record<MethodKey, string>>({ cash: '', card: '', transfer: '', credit: '' });

  const set = (k: MethodKey, v: string) => setTenders((s) => ({ ...s, [k]: v }));

  const paidMinor = useMemo(
    () => (Object.keys(tenders) as MethodKey[]).reduce((s, k) => s + riyalToMinor(tenders[k]), 0),
    [tenders],
  );
  const remainingMinor = Math.max(0, totalMinor - paidMinor);
  const changeMinor = Math.max(0, paidMinor - totalMinor);
  const canConfirm = paidMinor >= totalMinor && totalMinor > 0;

  const quick = [totalMinor / 100, 50, 100, 200, 500];

  return (
    <div className="flex h-full flex-col">
      {/* شريط الخطوات */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border bg-surface px-4 py-2.5">
        <button
          onClick={onBack}
          className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-[13px] font-semibold text-text hover:bg-background"
        >
          <ArrowRight className="h-4 w-4" strokeWidth={2} />
          {t('back_to_cart')}
        </button>
        <div className="flex-1" />
        <div className="flex items-center gap-1.5 text-xs text-muted">
          {t('cart')} ‹ <b className="text-primary-hover">{t('payment')}</b> ‹ {t('receipt')}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[340px_1fr] lg:overflow-hidden">
        {/* ملخّص الفاتورة */}
        <aside className="flex flex-col border-b border-border bg-surface lg:border-b-0 lg:border-e lg:overflow-y-auto">
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
            {items.map((it, i) => (
              <div key={i} className="flex items-center justify-between border-b border-border py-2 text-[12.5px] last:border-0">
                <div>
                  <div className="font-semibold">{it.name}</div>
                  <span className="num text-[11px] text-muted">{it.qty} × {it.unitPrice}</span>
                </div>
                <div className="num font-bold">{formatRiyal(it.lineTotal / 100)}</div>
              </div>
            ))}
          </div>
        </aside>

        {/* طرق الدفع */}
        <main className="flex flex-col gap-5 overflow-y-auto p-5 lg:p-7">
          <div>
            <div className="mb-3 text-sm font-bold">{t('payment_methods')}</div>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {METHODS.map(({ key, icon: Icon }) => {
                const on = riyalToMinor(tenders[key]) > 0;
                return (
                  <div
                    key={key}
                    className={
                      'rounded-2xl border-[1.5px] bg-surface p-4 ' +
                      (on ? 'border-primary bg-primary-soft' : 'border-border')
                    }
                  >
                    <div className="mb-2.5 flex items-center justify-between">
                      <div className={'grid h-9 w-9 place-items-center rounded-[10px] ' + (on ? 'bg-primary text-white' : 'bg-background text-muted')}>
                        <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
                      </div>
                      {on && (
                        <div className="grid h-5 w-5 place-items-center rounded-md bg-primary text-white">
                          <Check className="h-3 w-3" strokeWidth={3} />
                        </div>
                      )}
                    </div>
                    <div className="mb-2 text-[13px] font-bold">{t(`method_${key}`)}</div>
                    <input
                      value={tenders[key]}
                      onChange={(e) => set(key, e.target.value)}
                      inputMode="decimal"
                      placeholder="0.00"
                      className="num w-full rounded-lg border border-border bg-background px-2.5 py-2 text-center text-sm font-bold text-text outline-none focus:border-primary focus:bg-surface"
                    />
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <div className="mb-2.5 text-sm font-bold">{t('quick_amounts')}</div>
            <div className="flex flex-wrap gap-2">
              {quick.map((q, i) => (
                <button
                  key={i}
                  onClick={() => set('cash', (q).toFixed(2))}
                  className={
                    'num rounded-lg border px-4 py-2 text-[13px] font-bold ' +
                    (i === 0 ? 'border-primary bg-primary-soft text-primary-hover' : 'border-border bg-background text-text hover:border-primary')
                  }
                >
                  {i === 0 ? t('exact_amount') : q}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl border border-border bg-surface p-4">
              <div className="mb-1.5 text-[11px] font-semibold text-muted">{t('paid')}</div>
              <div className="num text-lg font-extrabold text-positive">{formatRiyal(paidMinor / 100)}</div>
            </div>
            <div className="rounded-2xl border border-border bg-surface p-4">
              <div className="mb-1.5 text-[11px] font-semibold text-muted">{t('remaining')}</div>
              <div className="num text-lg font-extrabold text-negative">{formatRiyal(remainingMinor / 100)}</div>
            </div>
            <div className="rounded-2xl border border-border bg-surface p-4">
              <div className="mb-1.5 text-[11px] font-semibold text-muted">{t('change')}</div>
              <div className="num text-lg font-extrabold text-primary-hover">{formatRiyal(changeMinor / 100)}</div>
            </div>
          </div>

          {error && <p className="rounded-lg bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}
        </main>
      </div>

      {/* التذييل: تأكيد الدفع */}
      <footer className="flex shrink-0 gap-3 border-t border-border bg-surface p-4">
        <button className="flex items-center gap-2 rounded-xl border border-border px-5 py-3 text-[13.5px] font-semibold text-text hover:bg-background">
          <Printer className="h-4 w-4" strokeWidth={1.8} />
          {t('preprint')}
        </button>
        <button
          onClick={() => onConfirm({ cash: riyalToMinor(tenders.cash), card: riyalToMinor(tenders.card), transfer: riyalToMinor(tenders.transfer), credit: riyalToMinor(tenders.credit) })}
          disabled={!canConfirm || paying}
          className="flex flex-1 items-center justify-center gap-2.5 rounded-xl bg-primary py-3 text-base font-bold text-white disabled:opacity-50"
        >
          <Check className="h-5 w-5" strokeWidth={2.2} />
          {t('confirm_payment')}
        </button>
      </footer>
    </div>
  );
}
