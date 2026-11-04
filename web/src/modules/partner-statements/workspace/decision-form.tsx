'use client';

/**
 * نموذج القرار الفردي: حقل السبب (يظهر ويصير إلزامياً وفق D-PS-16) + إقرار الفرق الخارج عن التسامح + إرسال عبر الطابور.
 * القواعد في `decision-rules.ts` (مرآة للخادم). مسودة **نص السبب فقط** تُحفظ محلياً (`reason-draft.ts`) وتُمسح عند النجاح. الإقرار لا يُفعَّل تلقائياً أبداً.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { formatMinor } from '../contract';
import { describeError } from '../errors';
import {
  MAX_REASON_LENGTH,
  acceptDifferenceRequired,
  blockingIssue,
  buildDecisionRequest,
  reasonLength,
  reasonRequired,
  type DecisionDraft,
} from './decision-rules';
import { clearReasonDraft, draftKey, loadReasonDraft, saveReasonDraft } from './reason-draft';
import type { QueueJob } from './decision-queue';
import type { DecisionAction, DecisionRequest, MatchRow, PairMember } from './types';

export interface DecisionFormProps {
  reconciliationId: string;
  runId: string;
  lineId: string;
  action: Exclude<DecisionAction, 'clear'>;
  row: Pick<MatchRow, 'outcome' | 'unit_key'>;
  unitKeys?: string[];
  pairMember?: PairMember | null;
  /** صافي الفرق المعروف (اقتراح المحرّك أو verify-set)؛ `null` = غير معروف. */
  netDifferenceMinor: number | null;
  toleranceMinor: number;
  disabled?: boolean;
  /** يمنع الإرسال لسبب خارجي (مجموعة لم يُتحقَّق منها…). */
  externalBlock?: string | null;
  /** مهمة الطابور الحالية لهذا السطر. */
  job: QueueJob | null;
  submitLabel: string;
  onSubmit: (request: DecisionRequest) => Promise<QueueJob>;
  onDone: (job: QueueJob) => void;
  onCancel?: () => void;
}

export function DecisionForm(props: DecisionFormProps) {
  const t = useTranslations('partnerStatements');
  const { action, row, unitKeys = [], pairMember = null, toleranceMinor, job } = props;
  const key = draftKey(props.reconciliationId, props.lineId, action);
  const [reason, setReason] = useState('');
  const [accept, setAccept] = useState(false);
  const [serverDifference, setServerDifference] = useState<number | null>(null);
  const [failure, setFailure] = useState<{ key: string; code: string | null; retrying: boolean } | null>(null);
  const submitting = useRef(false);
  // المفتاح النشط الآن: نموذج السطر السابق قد يُعاد استعماله لسطر آخر قبل اكتمال إرساله، فلا تُطبَّق نتيجته المتأخرة على السطر الجاري.
  const activeKey = useRef(key);
  activeKey.current = key;

  // استرجاع مسودة السبب (نص فقط) عند فتح النموذج.
  useEffect(() => {
    setReason(loadReasonDraft(key));
    setAccept(false);
    setServerDifference(null);
    setFailure(null);
  }, [key]);

  const net = props.netDifferenceMinor ?? serverDifference;

  // إقرار الفرق يخص **هذه** المجموعة وهذا الفرق: أي تغيير في الوحدات أو العضو أو الفرق المعروف يُسقطه فيُطلب إقرار جديد (يبقى نص السبب).
  const acceptScope = `${[...unitKeys].sort().join('|')}#${pairMember ?? ''}#${net ?? ''}`;
  useEffect(() => setAccept(false), [acceptScope]);
  const needReason = reasonRequired({ action, engineOutcome: row.outcome, netDifferenceMinor: net });
  const needAccept = action !== 'dismiss' && acceptDifferenceRequired(net, toleranceMinor);

  const draft: DecisionDraft = useMemo(
    () => ({ action, row, reason, unitKeys, acceptDifference: accept, pairMember, netDifferenceMinor: net, toleranceMinor }),
    [action, row, reason, unitKeys, accept, pairMember, net, toleranceMinor],
  );
  const block = blockingIssue(draft);
  const busy = job?.status === 'queued' || job?.status === 'sending' || job?.status === 'backoff';
  const disabled = props.disabled || busy || block !== null || props.externalBlock != null;

  const onReason = (value: string) => {
    setReason(value);
    saveReasonDraft(key, value);
  };

  async function submit() {
    if (disabled || submitting.current) return;
    submitting.current = true;
    setFailure(null);
    try {
      const result = await props.onSubmit(buildDecisionRequest(props.runId, props.lineId, draft));
      if (result.status === 'done') {
        clearReasonDraft(key);
        props.onDone(result);
        return;
      }
      if (activeKey.current !== key) return;
      const descriptor = describeError(result.error);
      if (descriptor.code === 'difference_exceeds_tolerance' && typeof descriptor.details?.difference_minor === 'number') {
        setServerDifference(descriptor.details.difference_minor);
      }
      setFailure({ key: descriptor.key, code: descriptor.code, retrying: false });
    } finally {
      submitting.current = false;
    }
  }

  const reasonId = `ps-reason-${props.lineId}-${action}`;
  const errorId = `${reasonId}-error`;
  const length = reasonLength(reason);

  return (
    <form
      className="space-y-3 rounded-md border border-border bg-background p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      data-testid={`decision-form-${action}`}
    >
      {needReason || reason !== '' ? (
        <div className="space-y-1.5">
          <Label htmlFor={reasonId}>
            {t(`workspace.form.reason_label_${action}`)}
            {needReason ? <span className="text-negative"> *</span> : <span className="text-muted"> ({t('workspace.form.optional')})</span>}
          </Label>
          <Textarea
            id={reasonId}
            value={reason}
            maxLength={MAX_REASON_LENGTH + 50}
            rows={3}
            dir="auto"
            required={needReason}
            aria-required={needReason}
            aria-invalid={block === 'reason_required' || block === 'reason_too_long' ? true : undefined}
            aria-describedby={errorId}
            placeholder={t('workspace.form.reason_placeholder')}
            onChange={(event) => onReason(event.target.value)}
          />
          <p className="text-xs text-muted">
            {needReason ? t('workspace.form.reason_hint') : null} <span className="num" dir="ltr">{length}/{MAX_REASON_LENGTH}</span>
          </p>
        </div>
      ) : null}

      {needAccept ? (
        <label className="flex min-h-[44px] items-start gap-2 rounded border border-warning/40 bg-warning/5 p-2 text-sm md:min-h-0">
          <input type="checkbox" className="mt-1 h-4 w-4" checked={accept} onChange={(event) => setAccept(event.target.checked)} />
          <span>
            {t('workspace.form.accept_difference', { difference: formatMinor(net), tolerance: formatMinor(toleranceMinor) })}
          </span>
        </label>
      ) : null}

      <div id={errorId} aria-live="polite" className="space-y-1">
        {block && (block === 'reason_required' || block === 'accept_required') && (reason !== '' || accept) ? (
          <p className="text-xs text-warning">{t(`workspace.form.block_${block}`)}</p>
        ) : null}
        {props.externalBlock ? <p className="text-xs text-warning">{props.externalBlock}</p> : null}
        {failure ? <p role="alert" className="text-sm text-negative" data-testid="decision-error">{t(`errors.${failure.key}`)}</p> : null}
        {job?.status === 'backoff' ? (
          <p role="status" className="text-xs text-warning" data-testid="decision-backoff">{t('workspace.queue.retrying', { seconds: job.retryInSeconds ?? 0 })}</p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={disabled} className="min-h-[44px] md:min-h-9" aria-busy={busy || undefined}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {busy ? t('workspace.queue.sending') : props.submitLabel}
        </Button>
        {props.onCancel ? (
          <Button type="button" variant="ghost" className="min-h-[44px] md:min-h-9" onClick={props.onCancel} disabled={busy}>
            {t('workspace.form.cancel')}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
