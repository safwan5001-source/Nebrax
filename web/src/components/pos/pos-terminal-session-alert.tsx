'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { api } from '@/lib/api';
import { formatRiyal } from '@/lib/money';
import { usePosTerminals, useTerminalErrorText } from '@/components/pos/pos-terminal-pay';
import {
  escalationSummary, holdsPayment, isApproved, isPending, knownFailure, needsCompensation, statusTone,
  type PosTerminalRequest,
} from '@/modules/pos-terminals/contract';

/**
 * تنبيه جلسة POS لعمليات جهاز الدفع المعلّقة. وضعان:
 * - `attention` (لافتة POS الدائمة): عمليات تعويض لم تُحل فقط — لا تُزعج الكاشير بطلب جارٍ طبيعي.
 * - `blocking` (حوار الإقفال): كل ما يمنع الإقفال (معلّق/موافقة قائمة/تعويض).
 * لا تجاوز يدوي هنا (قرار المالك: الخيار A): الإجراءات المتاحة إعادة المحاولة والإلغاء فقط، ومعها تصعيد آمن للمدير.
 */
export function PosTerminalSessionAlert({
  sessionId, mode, enabled = true, pollMs = 0, reloadKey = 0, onChanged, className = '',
}: {
  sessionId: string;
  mode: 'attention' | 'blocking';
  enabled?: boolean;
  /** استعلام دوري (للافتة الدائمة)؛ 0 = مرة واحدة ثم عند `reloadKey`. */
  pollMs?: number;
  reloadKey?: number;
  onChanged?: () => void;
  className?: string;
}) {
  const t = useTranslations('posTerminals');
  const askConfirm = useConfirm();
  const errorText = useTerminalErrorText();
  const terminalsState = usePosTerminals(enabled);
  const [requests, setRequests] = useState<PosTerminalRequest[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);

  const load = useCallback(() => {
    if (!enabled) return;
    api<{ data: PosTerminalRequest[] }>(`/pos-sessions/${sessionId}/terminal-requests`)
      .then((res) => { if (live.current) setRequests(res.data ?? []); })
      .catch(() => { /* بلا ضجيج: غياب الصلاحية/الشبكة لا يُسقط الشاشة؛ الخادم يمنع الإقفال على أي حال */ });
  }, [enabled, sessionId]);

  useEffect(() => { load(); }, [load, reloadKey]);
  useEffect(() => {
    if (!enabled || pollMs <= 0) return;
    const timer = setInterval(load, pollMs);
    return () => clearInterval(timer);
  }, [enabled, pollMs, load]);

  const shown = requests.filter((request) => (mode === 'attention' ? needsCompensation(request.status) : holdsPayment(request.status)));
  if (!enabled || shown.length === 0) return null;

  async function act(request: PosTerminalRequest, action: 'cancel' | 'void') {
    if (action === 'void' && isApproved(request.status) && !(await askConfirm({ message: t('confirm_void'), tone: 'danger' }))) return;
    setBusyId(request.id); setError(null);
    try {
      await api(`/pos/terminal-requests/${request.id}/${action}`, { method: 'POST' });
      load(); onChanged?.();
    } catch (err) { setError(errorText(err)); } finally { if (live.current) setBusyId(null); }
  }

  const compensation = shown.filter((request) => needsCompensation(request.status));

  return (
    <section role="alert" className={`space-y-2 rounded-md border border-negative/40 bg-negative/5 p-3 text-xs text-text ${className}`} data-testid="pos-terminal-session-alert" data-mode={mode}>
      <p className="flex items-start gap-1.5 text-sm font-bold text-negative">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} aria-hidden />
        {compensation.length > 0 ? t('alert_compensation_title', { count: compensation.length }) : t('alert_blocking_title', { count: shown.length })}
      </p>
      <p className="leading-relaxed">{compensation.length > 0 ? t('alert_compensation_body') : t('alert_blocking_body')}</p>
      {compensation.length > 0 && <p className="leading-relaxed text-muted">{t('alert_escalation')}</p>}
      <ul className="space-y-2">
        {shown.map((request) => {
          const terminal = terminalsState.terminals.find((item) => item.id === request.pos_payment_terminal_id) ?? null;
          return (
            <li key={request.id} className="space-y-1.5 rounded-md border border-border bg-surface p-2.5" data-testid="pos-terminal-alert-row">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={statusTone(request.status)}>{t(`status.${request.status}`)}</Badge>
                <span className="num font-semibold">{formatRiyal(Number(request.amount))}</span>
                {terminal && <span className="text-muted">{terminal.name}</span>}
                {terminal?.simulated && <Badge tone="warning">{t('simulated')}</Badge>}
              </div>
              {needsCompensation(request.status) && knownFailure(request.last_void_error) && <p className="text-muted">{t(`failure.${knownFailure(request.last_void_error)}`)}</p>}
              <div className="flex flex-wrap gap-2">
                {isPending(request.status) && (
                  <button type="button" disabled={busyId === request.id} onClick={() => void act(request, 'cancel')} className="min-h-10 rounded-md border border-border px-3 font-semibold hover:bg-background focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50">{t('cancel_request')}</button>
                )}
                {isApproved(request.status) && (
                  <button type="button" disabled={busyId === request.id} onClick={() => void act(request, 'void')} className="min-h-10 rounded-md border border-negative/50 px-3 font-semibold text-negative hover:bg-negative/5 focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50">{t('void_approval')}</button>
                )}
                {needsCompensation(request.status) && (
                  <>
                    <button type="button" disabled={busyId === request.id} onClick={() => void act(request, 'void')} className="min-h-10 rounded-md bg-negative px-3 font-semibold text-white focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50" data-testid="pos-terminal-alert-retry-void">{t('retry_void')}</button>
                    <button type="button" onClick={() => void navigator.clipboard?.writeText(escalationSummary(request, terminal?.name ?? null)).catch(() => {})} className="min-h-10 rounded-md border border-border px-3 font-semibold hover:bg-background focus-visible:ring-2 focus-visible:ring-primary/40">{t('copy_for_manager')}</button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {error && <p role="alert" className="rounded-md bg-negative/10 px-3 py-2 text-negative">{error}</p>}
    </section>
  );
}
