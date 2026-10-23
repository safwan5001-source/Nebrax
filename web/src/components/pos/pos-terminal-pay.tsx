'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, CircleX, CreditCard, Loader2, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { api, ApiError } from '@/lib/api';
import { formatRiyal } from '@/lib/money';
import {
  attemptFingerprint, escalationSummary, holdsPayment, isApproved, isPending, isRetryable, knownFailure, knownReason,
  needsCompensation, reasonOf, statusTone, usableTerminals,
  type PosPaymentTerminal, type PosTerminalRequest, type TerminalProvider,
} from '@/modules/pos-terminals/contract';

const POLL_MS = 2500;

export interface PosTerminalsState {
  loading: boolean;
  terminals: PosPaymentTerminal[];
  providers: TerminalProvider[];
}

/** قراءة الأجهزة مرة عند التفعيل. فشلها (صلاحية/شبكة) = لا أجهزة، بلا ضجيج: الدفع اليدوي يبقى كما كان إلا حيث تشترط الوسيلة الجهاز. */
export function usePosTerminals(enabled: boolean): PosTerminalsState {
  const [state, setState] = useState<PosTerminalsState>({ loading: enabled, terminals: [], providers: [] });
  useEffect(() => {
    if (!enabled) { setState({ loading: false, terminals: [], providers: [] }); return; }
    let live = true;
    api<{ data: PosPaymentTerminal[]; meta?: { providers?: TerminalProvider[] } }>('/pos-payment-terminals')
      .then((res) => { if (live) setState({ loading: false, terminals: res.data ?? [], providers: res.meta?.providers ?? [] }); })
      .catch(() => { if (live) setState({ loading: false, terminals: [], providers: [] }); });
    return () => { live = false; };
  }, [enabled]);
  return state;
}

export function amountToMinor(amount: number | string): number {
  return Math.round(Number(amount) * 100);
}

/** مفاتيح نصوص الخطأ: السبب المعروف أولاً، وإلا رسالة الخادم، وإلا عامّ. */
export function useTerminalErrorText(): (err: unknown) => string {
  const t = useTranslations('posTerminals');
  return useCallback((err: unknown) => {
    const reason = knownReason(reasonOf(err));
    if (reason) return t(`errors.${reason}`);
    return err instanceof ApiError && err.message ? err.message : t('errors.generic');
  }, [t]);
}

/**
 * لوحة «الدفع عبر جهاز البطاقة» لوسيلة بنكية في شاشة الدفع. الحالة (الطلب) مرفوعة إلى الأب لأن البيع يستهلك الموافقة.
 * لا تقيُّد مالياً هنا: البيع نفسه يمرّ بالمسار القائم (A11/A12)، واللوحة تجمع موافقة مؤكدة من الجهاز فقط.
 */
export function PosTerminalPay({
  sessionId, posDeviceId, methodId, amountMinor, maxMinor, required, disabled, terminalsState, request, onRequest: report,
}: {
  sessionId: string;
  posDeviceId: string | null;
  methodId: string;
  amountMinor: number;
  /** سقف المبلغ المقبول لهذه الوسيلة (المتبقي بعد الوسائل الأخرى)؛ فوقه يُرفض الإرسال محلياً (الخادم يرفض أيضاً). */
  maxMinor: number;
  required: boolean;
  disabled: boolean;
  terminalsState: PosTerminalsState;
  request: PosTerminalRequest | null;
  onRequest: (methodId: string, request: PosTerminalRequest | null) => void;
}) {
  const onRequest = useCallback((next: PosTerminalRequest | null) => report(methodId, next), [report, methodId]);
  const t = useTranslations('posTerminals');
  const askConfirm = useConfirm();
  const errorText = useTerminalErrorText();
  const usable = useMemo(() => usableTerminals(terminalsState.terminals, posDeviceId), [terminalsState.terminals, posDeviceId]);
  const [terminalId, setTerminalId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pollWarn, setPollWarn] = useState(false);
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);

  const effectiveTerminalId = request?.pos_payment_terminal_id ?? (usable.find((terminal) => terminal.id === terminalId)?.id ?? usable[0]?.id ?? '');
  const terminal = terminalsState.terminals.find((item) => item.id === effectiveTerminalId) ?? null;
  const status = request?.status ?? null;

  // استعلام دوري ما دام الطلب معلّقاً. تعذّر الوصول إلى الجهاز لحظياً لا يُسقط الطلب: يبقى معلّقاً ويُعرض تنبيه خفيف.
  useEffect(() => {
    if (!request || !isPending(request.status)) { setPollWarn(false); return; }
    const id = request.id;
    const timer = setInterval(() => {
      api<{ data: PosTerminalRequest }>(`/pos/terminal-requests/${id}`)
        .then((res) => { if (live.current) { setPollWarn(false); onRequest(res.data); } })
        .catch(() => { if (live.current) setPollWarn(true); });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [request, onRequest]);

  async function run(action: () => Promise<PosTerminalRequest | null>) {
    setBusy(true); setError(null);
    try { onRequest(await action()); }
    catch (err) { setError(errorText(err)); }
    finally { if (live.current) setBusy(false); }
  }

  function send() {
    if (!effectiveTerminalId || amountMinor <= 0 || amountMinor > maxMinor) return;
    const fingerprint = attemptFingerprint({ sessionId, terminalId: effectiveTerminalId, methodId, amountMinor });
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, key: crypto.randomUUID() };
    const key = attempt.current.key;
    void run(async () => {
      const res = await api<{ data: PosTerminalRequest }>('/pos/terminal-requests', {
        method: 'POST',
        body: {
          pos_session_id: sessionId,
          pos_payment_terminal_id: effectiveTerminalId,
          payment_method_id: methodId,
          amount: amountMinor / 100,
          idempotency_key: key,
        },
      });
      attempt.current = null;
      return res.data;
    });
  }

  function cancel() {
    if (!request) return;
    void run(async () => (await api<{ data: PosTerminalRequest }>(`/pos/terminal-requests/${request.id}/cancel`, { method: 'POST' })).data);
  }

  async function voidApproval() {
    if (!request) return;
    if (!(await askConfirm({ message: t('confirm_void'), tone: 'danger' }))) return;
    void run(async () => (await api<{ data: PosTerminalRequest }>(`/pos/terminal-requests/${request.id}/void`, { method: 'POST' })).data);
  }

  function copySummary() {
    if (!request) return;
    void navigator.clipboard?.writeText(escalationSummary(request, terminal?.name ?? null)).catch(() => {});
  }

  if (terminalsState.loading) {
    return <p className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted">{t('loading')}</p>;
  }
  if (usable.length === 0 && !request) {
    return required
      ? <p role="alert" className="rounded-md border border-negative/40 bg-negative/5 px-3 py-2 text-xs font-semibold text-negative" data-testid="pos-terminal-required-unavailable">{t('required_unavailable')}</p>
      : null;
  }

  const simulated = terminal?.simulated === true;
  const waiting = status !== null && isPending(status);

  return (
    <section className="space-y-2 rounded-md border border-border bg-surface p-3" aria-label={t('panel_title')} data-testid="pos-terminal-panel" data-status={status ?? 'idle'}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-bold text-text"><CreditCard className="h-4 w-4 text-muted" strokeWidth={1.7} aria-hidden />{t('panel_title')}</div>
        {simulated && <Badge tone="warning" data-testid="pos-terminal-simulated">{t('simulated')}</Badge>}
      </div>
      {required && <p className="text-[11px] text-muted">{t('required_note')}</p>}
      {simulated && <p className="text-[11px] text-warning" role="note">{t('simulated_note')}</p>}

      {!request && (
        <>
          {usable.length > 1 && (
            <select
              aria-label={t('choose_terminal')}
              value={effectiveTerminalId}
              disabled={disabled || busy}
              onChange={(event) => setTerminalId(event.target.value)}
              className="min-h-11 w-full rounded-md border border-border bg-background px-2 text-sm text-text focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {usable.map((item) => <option key={item.id} value={item.id}>{item.name}{item.simulated ? ` — ${t('simulated')}` : ''}</option>)}
            </select>
          )}
          {usable.length === 1 && terminal && <p className="text-xs text-muted">{t('terminal_label', { name: terminal.name })}</p>}
          <button
            type="button"
            onClick={send}
            disabled={disabled || busy || amountMinor <= 0 || amountMinor > maxMinor}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-bold text-white touch-manipulation focus-visible:ring-2 focus-visible:ring-primary/40 disabled:pointer-events-none disabled:opacity-50"
            data-testid="pos-terminal-send"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CreditCard className="h-4 w-4" aria-hidden />}
            {amountMinor > 0 ? t('send_amount', { amount: formatRiyal(amountMinor / 100) }) : t('enter_amount')}
          </button>
        </>
      )}

      {request && status && (
        <div className="space-y-2" role="status" aria-live="polite">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={statusTone(status)}>{t(`status.${status}`)}</Badge>
            <span className="num text-xs font-semibold text-text">{formatRiyal(Number(request.amount))}</span>
            {terminal && <span className="text-xs text-muted">{terminal.name}</span>}
          </div>

          {waiting && (
            <p className="flex items-center gap-2 text-xs text-text"><Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />{t('waiting_customer')}</p>
          )}
          {waiting && pollWarn && <p className="text-[11px] text-warning" role="alert">{t('poll_warning')}</p>}
          {request.failure_code === 'start_unconfirmed' && waiting && <p className="text-[11px] text-warning">{t('failure.start_unconfirmed')}</p>}

          {isApproved(status) && (
            <div className="space-y-1 rounded-md bg-positive/10 px-3 py-2 text-xs text-text" data-testid="pos-terminal-approved">
              <p className="flex items-center gap-1.5 font-semibold text-positive"><CheckCircle2 className="h-4 w-4" aria-hidden />{t('approved_ready')}</p>
              {(request.last4 || request.approval_code) && (
                <p className="num text-muted">
                  {request.last4 ? t('card_last4', { last4: request.last4 }) : null}
                  {request.last4 && request.approval_code ? ' · ' : null}
                  {request.approval_code ? t('approval_code', { code: request.approval_code }) : null}
                </p>
              )}
              {simulated && <p className="text-warning">{t('simulated_approval')}</p>}
            </div>
          )}

          {isRetryable(status) && (
            <p className="flex items-start gap-1.5 text-xs text-text">
              <CircleX className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
              <span>{knownFailure(request.failure_code) ? t(`failure.${knownFailure(request.failure_code)}`) : t(`status_hint.${status}`)}</span>
            </p>
          )}

          {needsCompensation(status) && (
            <div role="alert" className="space-y-2 rounded-md border border-negative/40 bg-negative/5 px-3 py-2 text-xs text-text" data-testid="pos-terminal-compensation">
              <p className="flex items-start gap-1.5 font-semibold text-negative"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{t('compensation_title')}</p>
              <p>{t('compensation_body')}</p>
              {knownFailure(request.last_void_error) && <p className="text-muted">{t(`failure.${knownFailure(request.last_void_error)}`)}</p>}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {waiting && (
              <button type="button" onClick={cancel} disabled={disabled || busy} className="min-h-11 rounded-md border border-border px-3 text-sm font-semibold text-text touch-manipulation hover:bg-background focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50" data-testid="pos-terminal-cancel">{t('cancel_request')}</button>
            )}
            {isApproved(status) && (
              <button type="button" onClick={() => void voidApproval()} disabled={disabled || busy} className="min-h-11 rounded-md border border-negative/50 px-3 text-sm font-semibold text-negative touch-manipulation hover:bg-negative/5 focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50" data-testid="pos-terminal-void">{t('void_approval')}</button>
            )}
            {needsCompensation(status) && (
              <>
                <button type="button" onClick={() => void run(async () => (await api<{ data: PosTerminalRequest }>(`/pos/terminal-requests/${request.id}/void`, { method: 'POST' })).data)} disabled={busy} className="min-h-11 rounded-md bg-negative px-3 text-sm font-semibold text-white touch-manipulation focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50" data-testid="pos-terminal-retry-void">{t('retry_void')}</button>
                <button type="button" onClick={copySummary} className="min-h-11 rounded-md border border-border px-3 text-sm font-semibold text-text touch-manipulation hover:bg-background focus-visible:ring-2 focus-visible:ring-primary/40">{t('copy_for_manager')}</button>
              </>
            )}
            {isRetryable(status) && (
              <button type="button" onClick={() => { setError(null); onRequest(null); }} disabled={disabled || busy} className="min-h-11 rounded-md bg-primary px-3 text-sm font-semibold text-white touch-manipulation focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50" data-testid="pos-terminal-retry">{t('try_again')}</button>
            )}
          </div>
          {holdsPayment(status) && <p className="text-[11px] text-muted">{t('amount_locked')}</p>}
        </div>
      )}

      {error && <p role="alert" className="rounded-md bg-negative/10 px-3 py-2 text-xs text-negative" data-testid="pos-terminal-error">{error}</p>}
    </section>
  );
}
