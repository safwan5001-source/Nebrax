'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, CheckCircle2, Clock, LoaderCircle, LockKeyhole, XCircle } from 'lucide-react';
import { LangToggle } from '@/components/layout/lang-toggle';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LtrNumber } from '@/components/ui/ltr-number';
import { PaymentBrandRow } from '@/components/payments/payment-brand-mark';
import {
  PayLinkError,
  fetchPayLink,
  fetchPayLinkStatus,
  formatPayAmount,
  idempotencyKeyFor,
  isSafeCheckoutUrl,
  minorToRiyalText,
  parseRiyalToMinor,
  startPayAttempt,
  type PayLinkPayment,
  type PayLinkView,
} from '@/lib/pay-link';

/**
 * صفحة الدفع العامة (PAY-H2-03a): ملخص ما يُدفع ثم تحويل إلى صفحة الدفع **المستضافة لدى المزوّد** (لا حقول بطاقة هنا — SAQ A). مرجعا التصميم: صفحة فاتورة
 * Stripe المستضافة (هوية المنشأة أعلى، مبلغ كبير، إجراء رئيسي واحد، «مدعوم من») وTap Checkout (عمود واحد متماثل بين الجوال والحاسوب).
 *
 * الحالات: تحميل · مفتوح (كامل/جزئي) · مدفوع · جزئي رُحّل · بانتظار التأكيد · مكتمل/ملغى/منتهٍ/غير متاح · رابط غير صالح (404 موحّد) · خطأ مؤقت.
 * بعد العودة من المزوّد تُستطلَع الحالة (كل 4 ثوانٍ، حتى 5 دقائق) فيظهر «مدفوع» دون أن يعتمد على معاملات الرجوع من المزوّد (ليست حقيقة). لا حفظ للرمز ولا للمبلغ
 * إلا مفتاح منع التكرار في sessionStorage (يمنع محاولة ثانية عند التحديث). الأرقام تُعرض LTR داخل النص العربي.
 */
type Phase =
  | { kind: 'loading' }
  | { kind: 'not_found' }
  | { kind: 'error' }
  | { kind: 'view'; view: PayLinkView };

const POLL_MS = 4000;
const POLL_MAX_MS = 5 * 60 * 1000;

export function PayLinkPage({
  token,
  navigate = (url: string) => window.location.assign(url),
}: {
  token: string;
  /** وجهة التحويل إلى صفحة المزوّد — قابلة للحقن للاختبار فقط. */
  navigate?: (url: string) => void;
}) {
  const t = useTranslations('payLink');
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [payment, setPayment] = useState<PayLinkPayment>('none');
  const [amountText, setAmountText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [attemptError, setAttemptError] = useState<string | null>(null);
  const alive = useRef(true);

  const load = useCallback(async () => {
    setPhase({ kind: 'loading' });
    try {
      const view = await fetchPayLink(token);
      if (!alive.current) return;
      setPhase({ kind: 'view', view });
      const status = await fetchPayLinkStatus(token).catch(() => null);
      if (alive.current && status) setPayment(status.payment);
    } catch (e) {
      if (!alive.current) return;
      setPhase(e instanceof PayLinkError && e.status === 404 ? { kind: 'not_found' } : { kind: 'error' });
    }
  }, [token]);

  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, [load]);

  // استطلاع الحالة بعد بدء الدفع أو حين تكون دفعة قيد المعالجة (مرجع الحقيقة الوحيد لدى الصفحة).
  useEffect(() => {
    if (phase.kind !== 'view' || payment !== 'pending') return;
    const started = Date.now();
    const timer = setInterval(async () => {
      if (Date.now() - started > POLL_MAX_MS) return clearInterval(timer);
      const status = await fetchPayLinkStatus(token).catch(() => null);
      if (!alive.current || !status) return;
      setPayment(status.payment);
      if (status.payment !== 'pending') {
        clearInterval(timer);
        if (status.payment === 'paid' || status.payment === 'partially_paid') void load();
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [phase.kind, payment, token, load]);

  const view = phase.kind === 'view' ? phase.view : null;
  const due = view?.amount_due_minor ?? 0;
  const currency = view?.currency ?? 'SAR';

  // المبلغ المطلوب: فارغ ⇒ كامل المستحق (لا حقل للرابط غير الجزئي).
  let requestedMinor: number | undefined;
  let amountError: string | null = null;
  if (view?.allow_partial && amountText.trim() !== '') {
    const parsed = parseRiyalToMinor(amountText);
    if (parsed === null) amountError = t('partial_invalid');
    else if (parsed > due) amountError = t('partial_exceeds');
    else requestedMinor = parsed === due ? undefined : parsed;
  }

  async function onPay() {
    if (submitting || amountError) return;
    setSubmitting(true);
    setAttemptError(null);
    try {
      const storage = typeof window !== 'undefined' ? window.sessionStorage : null;
      const key = idempotencyKeyFor(token, requestedMinor, storage);
      const attempt = await startPayAttempt(token, key, requestedMinor);
      if (!isSafeCheckoutUrl(attempt.checkout_url)) throw new PayLinkError(0, 'unknown');
      setPayment('pending'); // عند العودة من المزوّد تبدأ الصفحة باستطلاع الحالة
      navigate(attempt.checkout_url);
    } catch (e) {
      const code = e instanceof PayLinkError ? e.code : 'unknown';
      setAttemptError(code);
      setSubmitting(false);
      if (code === 'payment_captured' || code === 'active_attempt_exists') setPayment('pending');
    }
  }

  return (
    <main className="min-h-screen bg-background px-4 pb-10 pt-16 sm:pt-20" aria-labelledby="pay-title">
      <div className="absolute end-4 top-4 flex items-center gap-1">
        <LangToggle />
        <ThemeToggle />
      </div>

      <div className="mx-auto w-full max-w-md space-y-4">
        {phase.kind === 'loading' && (
          <section role="status" aria-live="polite" className="rounded border border-border bg-surface p-6 text-center text-sm text-muted">
            <LoaderCircle className="mx-auto mb-3 h-5 w-5 animate-spin" aria-hidden />
            {t('loading')}
          </section>
        )}

        {phase.kind === 'not_found' && <Notice tone="negative" icon="x" title={t('not_found_title')} body={t('not_found_body')} />}

        {phase.kind === 'error' && (
          <Notice tone="warning" icon="alert" title={t('error_title')} body={t('error_body')}>
            <Button variant="outline" onClick={() => void load()}>{t('retry')}</Button>
          </Notice>
        )}

        {view && view.status !== 'open' && (
          <Notice
            tone={view.status === 'completed' ? 'positive' : 'muted'}
            icon={view.status === 'completed' ? 'check' : 'x'}
            title={t(`state_${view.status}_title` as 'state_completed_title')}
            body={t(`state_${view.status}_body` as 'state_completed_body')}
          />
        )}

        {view && view.status === 'open' && (payment === 'paid') && (
          <Notice tone="positive" icon="check" title={t('state_paid_title')} body={t('state_paid_body')} />
        )}

        {view && view.status === 'open' && payment !== 'paid' && (
          <>
            {payment === 'pending' && <Notice tone="warning" icon="clock" title={t('state_pending_title')} body={t('state_pending_body')} live />}
            {payment === 'partially_paid' && <Notice tone="positive" icon="check" title={t('state_partial_title')} body={t('state_partial_body')} />}

            <section className="rounded border border-border bg-surface p-6" aria-labelledby="pay-title">
              <p className="text-sm text-muted">{t('pay_to')}</p>
              <h1 id="pay-title" className="mt-0.5 text-lg font-semibold text-text">{view.merchant}</h1>

              <div className="mt-6">
                <p className="text-sm text-muted">{t('amount_due')}</p>
                <p className="mt-1 text-3xl font-semibold text-text" data-testid="pay-amount-due">
                  <LtrNumber>{formatPayAmount(due, currency)}</LtrNumber>
                </p>
                <p className="mt-2 text-sm text-muted">
                  {t('invoice')} <bdi dir="ltr">{view.invoice_number}</bdi>
                </p>
              </div>

              {view.allow_partial && (
                <div className="mt-6 space-y-2 border-t border-border pt-4">
                  <Label htmlFor="pay-amount">{t('partial_label')}</Label>
                  <Input
                    id="pay-amount"
                    inputMode="decimal"
                    autoComplete="off"
                    dir="ltr"
                    className="text-start"
                    placeholder={minorToRiyalText(due)}
                    value={amountText}
                    aria-invalid={amountError ? true : undefined}
                    aria-describedby="pay-amount-hint"
                    onChange={(e) => setAmountText(e.target.value)}
                  />
                  <p id="pay-amount-hint" className={amountError ? 'text-sm text-negative' : 'text-sm text-muted'} role={amountError ? 'alert' : undefined}>
                    {amountError ?? t('partial_hint', { max: formatPayAmount(due, currency) })}
                  </p>
                </div>
              )}

              {attemptError && (
                <p role="alert" className="mt-4 flex items-start gap-2 text-sm text-negative">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span>{t(`attempt_error_${knownAttemptError(attemptError)}` as 'attempt_error_unknown')}</span>
                </p>
              )}

              <Button
                className="mt-6 h-12 w-full text-base"
                onClick={() => void onPay()}
                disabled={submitting || amountError !== null || payment === 'pending'}
                aria-busy={submitting}
              >
                {submitting ? (
                  <>
                    <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
                    {t('paying')}
                  </>
                ) : (
                  t('pay_button_amount', { amount: formatPayAmount(requestedMinor ?? due, currency) })
                )}
              </Button>

              {view.payment_methods && view.payment_methods.length > 0 && (
                <div className="mt-4 space-y-1.5">
                  <p className="text-xs text-muted">{t('accepted')}</p>
                  <PaymentBrandRow enabled={view.payment_methods} label={t('accepted')} />
                </div>
              )}

              <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-muted">
                <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>{t('secure_note')}</span>
              </p>
            </section>
          </>
        )}

        <p className="text-center text-xs text-muted">{t('powered')}</p>
      </div>
    </main>
  );
}

const KNOWN_ATTEMPT_ERRORS = [
  'active_attempt_exists', 'payment_captured', 'request_not_open', 'request_expired', 'invoice_not_payable', 'partial_not_allowed',
  'amount_exceeds_remaining', 'invalid_amount', 'amount_below_minimum', 'payment_unavailable', 'too_many_requests', 'network',
] as const;

function knownAttemptError(code: string): string {
  return (KNOWN_ATTEMPT_ERRORS as readonly string[]).includes(code) ? code : 'unknown';
}

function Notice({
  tone, icon, title, body, live = false, children,
}: {
  tone: 'positive' | 'negative' | 'warning' | 'muted';
  icon: 'check' | 'x' | 'alert' | 'clock';
  title: string;
  body: string;
  live?: boolean;
  children?: React.ReactNode;
}) {
  const color = { positive: 'text-positive', negative: 'text-negative', warning: 'text-warning', muted: 'text-muted' }[tone];
  const Icon = { check: CheckCircle2, x: XCircle, alert: AlertTriangle, clock: Clock }[icon];
  return (
    <section className="rounded border border-border bg-surface p-6 text-center" role={live ? 'status' : undefined} aria-live={live ? 'polite' : undefined}>
      <Icon className={`mx-auto h-8 w-8 ${color}`} aria-hidden />
      <h2 className="mt-3 text-base font-semibold text-text">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-muted">{body}</p>
      {children && <div className="mt-4">{children}</div>}
    </section>
  );
}
