'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, CheckCircle2, CircleAlert, Loader2 } from 'lucide-react';
import { ErrorState, LoadingState } from '@/components/nebrax';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { formatDate } from '@/lib/formatting';
import { classifyError } from '../access';
import { Field } from '../fields';
import { getFill, postInventory, previewPosting, previewReversal, reverseInventory } from './client';
import {
  postingPayload, postingProblem, reversalPayload, reversalProblem, REASON_MAX, litersOf,
  type ConfirmProblem, type FillActions, type Operation, type OperationPreview,
} from './logic';
import { verifyAfterUnknown, type WriteOutcome } from './outcome';
import { BlockerBadges, MinorAmount, TechnicalId, reasonLabel } from './parts';

/** مراحل الحوار: النموذج (`idle`)، الإرسال، ثم نتيجة صادقة. `verify_*` بعد إعادة قراءة السند إثر نتيجة غير مؤكدة. */
type Flow = 'idle' | 'sending' | 'ok' | 'rejected' | 'unknown' | 'verifying' | 'verified_done' | 'verified_unchanged' | 'verify_failed';
type PreviewState = { status: 'loading' } | { status: 'ready'; data: OperationPreview } | { status: 'error'; problem: 'forbidden' | 'gone' | 'other' };

interface Props {
  operation: Operation;
  fillId: string;
  fillNumber: string;
  quantityMilliliters: number;
  actions: FillActions;
  /** يُستدعى حين قد تكون حالة السند تغيّرت (نجاح أو نتيجة غير مؤكدة أو إغلاق بعد محاولة) فتعيد الصفحة قراءته. */
  onChanged: () => void;
  onClose: () => void;
}

/**
 * TANKER-PR6B-5 — حوار معاينة وتنفيذ **الترحيل** أو **العكس** المخزني (عملية مالية). التدفق: معاينة (GET) ← تأكيد صريح ← نتيجة صادقة.
 *  - الإجراء المتاح يأتي من `actions` الخادم وحدها؛ لا زر تأكيد لمن لا يملك صلاحية العملية أو لسند محجوب.
 *  - **لا إعادة إرسال تلقائية**: نتيجة غير مؤكدة (انقطاع/مهلة/5xx بعد الإرسال) ⇒ حالة كهرمانية + زر «تحقق من الحالة» يعيد **قراءة** السند فقط؛
 *    ولا يظهر زر إعادة المحاولة إلا إذا أثبتت القراءة أن الحالة لم تتغيّر.
 *  - قفل الإرسال بـ`useRef` + حالة، والإغلاق ممنوع أثناء الإرسال/التحقق.
 */
export function OperationDialog({ operation, fillId, fillNumber, quantityMilliliters, actions, onChanged, onClose }: Props) {
  const t = useTranslations('fuelTankerFills');
  const locale = useLocale();
  const [preview, setPreview] = useState<PreviewState>({ status: 'loading' });
  const [reason, setReason] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [flow, setFlow] = useState<Flow>('idle');
  const [outcome, setOutcome] = useState<WriteOutcome | null>(null);
  const [problem, setProblem] = useState<ConfirmProblem | null>(null);
  const lock = useRef(false);
  const previewSequence = useRef(0);

  /** `silent`: تحديث المعاينة بعد رفض الخادم (موانع/حالة جديدة) دون إخفاء ما هو معروض؛ فشله يُبقي المعاينة السابقة. */
  const loadPreview = useCallback(async (silent = false) => {
    const mine = ++previewSequence.current;
    if (!silent) setPreview({ status: 'loading' });
    try {
      const data = await (operation === 'post' ? previewPosting(fillId) : previewReversal(fillId));
      if (mine === previewSequence.current) setPreview({ status: 'ready', data });
    } catch (error) {
      if (mine !== previewSequence.current || silent) return;
      const kind = classifyError(error, 'record');
      setPreview({ status: 'error', problem: kind === 'forbidden' ? 'forbidden' : kind === 'not_found' ? 'gone' : 'other' });
    }
  }, [operation, fillId]);

  useEffect(() => { void loadPreview(); }, [loadPreview]);

  const data = preview.status === 'ready' ? preview.data : null;
  const busy = flow === 'sending' || flow === 'verifying';
  const showForm = flow === 'idle' || flow === 'rejected' || flow === 'sending';
  const allowed = operation === 'post' ? actions.post : actions.reverse;
  const historicalBlocked = operation === 'post' && data !== null && data.historical && !actions.post_historical;
  const canConfirm = data !== null && data.status === 'ready' && allowed && !historicalBlocked;

  function validate(): ConfirmProblem | null {
    return operation === 'post'
      ? postingProblem(data, actions, { reason, reviewedHistorical: reviewed })
      : reversalProblem(data, actions, reason);
  }

  async function confirm() {
    if (lock.current || data === null) return;
    const found = validate();
    if (found !== null) { setProblem(found); return; }
    setProblem(null);
    lock.current = true;
    setFlow('sending');
    const result = operation === 'post'
      ? await postInventory(fillId, postingPayload(data, { reason, reviewedHistorical: reviewed }))
      : await reverseInventory(fillId, reversalPayload(reason));
    setOutcome(result);
    if (result.kind === 'ok') { setFlow('ok'); onChanged(); return; } // الإقفال يبقى: تمّ التنفيذ فلا إرسال ثانٍ.
    if (result.kind === 'rejected' || result.kind === 'not_sent') {
      lock.current = false;
      setFlow('rejected');
      if (result.kind === 'rejected') void loadPreview(true); // الرفض لا أثر له، وقد تغيّرت الموانع/الحالة: تُحدَّث المعاينة.
      return;
    }
    setFlow('unknown'); // القفل يبقى حتى تحسم القراءة الحالة.
  }

  async function verify() {
    setFlow('verifying');
    try {
      const detail = await getFill(fillId);
      if (verifyAfterUnknown(operation, detail) === 'done') { setFlow('verified_done'); onChanged(); }
      else setFlow('verified_unchanged');
    } catch {
      setFlow('verify_failed');
    }
  }

  function retryAfterUnchanged() {
    lock.current = false;
    setOutcome(null);
    setFlow('idle');
    void loadPreview();
  }

  function close() {
    if (busy) return;
    if (flow !== 'idle') onChanged();
    onClose();
  }

  const quantity = `${litersOf(quantityMilliliters)} ${t('liters')}`;

  return (
    <Dialog open onClose={close} hideClose={busy} title={t(`dialog.title.${operation}`, { number: fillNumber })} className="max-w-xl">
      <div className="space-y-4" data-operation-dialog={operation} data-flow={flow}>
        <p className="text-sm text-muted">{t(`dialog.intro.${operation}`, { number: fillNumber, quantity })}</p>

        {preview.status === 'loading' ? <LoadingState variant="cards" rows={2} surface="bare" label={t('dialog.previewLoading')} /> : null}
        {preview.status === 'error' ? (
          <ErrorState
            message={preview.problem === 'forbidden' ? t('dialog.previewForbidden') : preview.problem === 'gone' ? t('dialog.previewGone') : t('dialog.previewFailed')}
            onRetry={preview.problem === 'other' ? () => void loadPreview() : undefined}
          />
        ) : null}

        {data !== null ? <PreviewBody operation={operation} preview={data} locale={locale} /> : null}

        {data !== null && showForm ? (
          <>
            {data.status === 'ready' && !allowed ? <p role="note" className="rounded-md border border-border bg-primary-soft px-3 py-2 text-sm text-text" data-no-permission="">{t(`dialog.noPermission.${operation}`)}</p> : null}
            {historicalBlocked ? <p role="note" className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-text" data-historical-no-permission="">{t('dialog.historical.noPermission')}</p> : null}

            {canConfirm ? (
              <div className="space-y-3">
                <Consequences operation={operation} />
                {operation === 'post' && data.historical ? (
                  <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-text" data-historical-confirm="">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-5 shrink-0 accent-primary"
                      checked={reviewed}
                      disabled={busy}
                      onChange={(event) => setReviewed(event.target.checked)}
                      aria-invalid={problem === 'historical_review_required' ? true : undefined}
                    />
                    <span>{t('dialog.historical.confirm')}</span>
                  </label>
                ) : null}
                {problem === 'historical_review_required' ? <p role="alert" className="text-xs text-negative">{t('dialog.problem.historical_review_required')}</p> : null}

                <Field
                  id={`operation-reason-${operation}`}
                  label={operation === 'reverse' ? t('dialog.reason.reverseLabel') : data.historical ? t('dialog.reason.historicalLabel') : t('dialog.reason.postLabel')}
                  hint={t('dialog.reason.hint', { max: REASON_MAX })}
                  required={operation === 'reverse' || data.historical}
                  error={problem === 'reason_required' || problem === 'reason_too_short' || problem === 'reason_too_long' ? t(`dialog.problem.${problem}`) : null}
                >
                  <Textarea value={reason} maxLength={REASON_MAX + 100} rows={3} disabled={busy} onChange={(event) => setReason(event.target.value)} />
                </Field>
              </div>
            ) : null}
          </>
        ) : null}

        {outcome !== null && (flow === 'ok' || flow === 'rejected' || flow === 'unknown') ? <OutcomePanel flow={flow} operation={operation} outcome={outcome} onVerify={() => void verify()} /> : null}
        {flow === 'sending' ? <p role="status" className="flex items-center gap-2 text-sm text-muted" data-sending=""><Loader2 className="size-4 animate-spin" aria-hidden="true" />{t('dialog.sending')}</p> : null}
        {flow === 'verifying' ? <p role="status" className="flex items-center gap-2 text-sm text-muted"><Loader2 className="size-4 animate-spin" aria-hidden="true" />{t('dialog.outcome.verifying')}</p> : null}
        {flow === 'verified_done' ? <Result tone="positive" title={t(`dialog.outcome.verifiedDone.${operation}`)} body={t('dialog.outcome.verifiedDoneBody')} /> : null}
        {flow === 'verified_unchanged' ? (
          <div className="space-y-2">
            <Result tone="warning" title={t('dialog.outcome.verifiedUnchanged')} body={t('dialog.outcome.verifiedUnchangedBody')} />
            <Button type="button" variant="outline" className="max-md:min-h-11" onClick={retryAfterUnchanged} data-retry="">{t('dialog.outcome.retry')}</Button>
          </div>
        ) : null}
        {flow === 'verify_failed' ? (
          <div className="space-y-2">
            <Result tone="warning" title={t('dialog.outcome.verifyFailed')} body={t('dialog.outcome.verifyFailedBody')} />
            <Button type="button" variant="outline" className="max-md:min-h-11" onClick={() => void verify()} data-verify="">{t('dialog.outcome.verify')}</Button>
          </div>
        ) : null}

        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" className="max-md:min-h-11" onClick={close} disabled={busy}>
            {showForm ? t('dialog.cancel') : t('dialog.close')}
          </Button>
          {showForm && canConfirm ? (
            <Button type="button" variant={operation === 'reverse' ? 'danger' : 'primary'} className="max-md:min-h-11" onClick={() => void confirm()} disabled={busy} data-confirm="">
              {t(`dialog.confirm.${operation}`)}
            </Button>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}

function PreviewBody({ operation, preview, locale }: { operation: Operation; preview: OperationPreview; locale: string }) {
  const t = useTranslations('fuelTankerFills');
  const tone = preview.status === 'ready' ? 'positive' : preview.status === 'blocked' ? 'negative' : 'muted';
  return (
    <section className="space-y-3 rounded-md border border-border p-3" aria-label={t('dialog.preview')} data-preview-status={preview.status}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text">{t('dialog.preview')}</h3>
        <Badge tone={tone}>{t(`dialog.status.${operation}.${preview.status}`)}</Badge>
      </div>
      {preview.historical ? (
        <div role="note" className="space-y-1 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm" data-historical-banner="">
          <p className="font-medium text-text">{t('dialog.historical.title')}</p>
          <p className="text-muted">{t('dialog.historical.body')}</p>
        </div>
      ) : null}
      {preview.blockers.length > 0 ? <BlockerBadges codes={preview.blockers} label={t('dialog.blockers')} /> : null}
      {preview.status === 'not_applicable' ? <p className="text-sm text-muted">{t(`dialog.notApplicable.${operation}`)}</p> : null}
      {preview.hasEntry ? (
        <div className="space-y-2" data-entry="">
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <div><dt className="text-xs text-muted">{operation === 'reverse' ? t('dialog.entry.reversalDate') : t('dialog.entry.date')}</dt><dd className="num text-text">{preview.entryDate ? formatDate(preview.entryDate, locale) : '—'}</dd></div>
            <div><dt className="text-xs text-muted">{t('dialog.entry.amount')}</dt><dd className="text-text"><MinorAmount minor={preview.amountMinor} /></dd></div>
          </dl>
          <ul className="divide-y divide-border rounded border border-border text-sm" aria-label={t('dialog.entry.lines')}>
            {preview.lines.map((line, index) => (
              <li key={`${line.side}-${index}`} className="flex flex-wrap items-center justify-between gap-2 p-2.5" data-entry-line={line.side}>
                <span className="flex items-center gap-2">
                  <Badge tone={line.side === 'debit' ? 'neutral' : 'muted'}>{t(`dialog.entry.side.${line.side}`)}</Badge>
                  <span className="text-text">{line.role ? (line.role === 'tanker_issue_clearing' || line.role === 'inventory' ? t(`dialog.entry.role.${line.role}`) : line.role) : t('dialog.entry.account')}</span>
                </span>
                <TechnicalId value={line.accountId} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <dl className="grid grid-cols-2 gap-2 text-xs text-muted">
        {preview.costRecognition ? <div><dt>{t('dialog.entry.costRecognition')}</dt><dd className="text-text">{preview.costRecognition === 'clearing_until_invoice' ? t('dialog.entry.costRecognitionValue.clearing_until_invoice') : preview.costRecognition}</dd></div> : null}
        {preview.variancePolicy ? <div><dt>{t('dialog.entry.variancePolicy')}</dt><dd className="text-text">{preview.variancePolicy === 'block' || preview.variancePolicy === 'warn' ? t(`dialog.entry.variancePolicyValue.${preview.variancePolicy}`) : preview.variancePolicy}</dd></div> : null}
        {preview.valuation === 'historical_cost' ? <div><dt>{t('dialog.entry.valuation')}</dt><dd className="text-text">{t('dialog.entry.valuationValue.historical_cost')}</dd></div> : null}
        {preview.quantityMilliliters !== null ? <div><dt>{t('dialog.entry.quantity')}</dt><dd className="num text-text" dir="ltr">{litersOf(preview.quantityMilliliters)} {t('liters')}</dd></div> : null}
      </dl>
    </section>
  );
}

/** ما سيحدث عند التأكيد — يُقرأ قبل الزر؛ لا يوحي بفاتورة أو إيراد أو ملكية. */
function Consequences({ operation }: { operation: Operation }) {
  const t = useTranslations('fuelTankerFills');
  return (
    <div role="note" className="space-y-1 rounded-md border border-border bg-primary-soft p-3 text-sm" data-consequences="">
      <p className="font-medium text-text">{t('dialog.consequences.title')}</p>
      <p className="text-muted">{t(`dialog.consequences.${operation}`)}</p>
    </div>
  );
}

function Result({ tone, title, body }: { tone: 'positive' | 'warning' | 'negative'; title: string; body?: string }) {
  const Icon = tone === 'positive' ? CheckCircle2 : tone === 'warning' ? AlertTriangle : CircleAlert;
  const colour = tone === 'positive' ? 'border-positive/40 bg-positive/10' : tone === 'warning' ? 'border-warning/50 bg-warning/10' : 'border-negative/40 bg-negative/10';
  const icon = tone === 'positive' ? 'text-positive' : tone === 'warning' ? 'text-warning' : 'text-negative';
  return (
    <div role={tone === 'positive' ? 'status' : 'alert'} className={`flex items-start gap-2.5 rounded-md border p-3 ${colour}`} data-result={tone}>
      <Icon className={`mt-0.5 size-4 shrink-0 ${icon}`} aria-hidden="true" />
      <div className="min-w-0 space-y-1 text-sm">
        <p className="font-medium text-text">{title}</p>
        {body ? <p className="break-words text-muted">{body}</p> : null}
      </div>
    </div>
  );
}

function OutcomePanel({ flow, operation, outcome, onVerify }: { flow: Flow; operation: Operation; outcome: WriteOutcome; onVerify: () => void }) {
  const t = useTranslations('fuelTankerFills');
  if (outcome.kind === 'ok') {
    return (
      <div data-outcome="ok" data-replayed={outcome.replayed ? 'true' : 'false'}>
        {outcome.replayed
          ? <Result tone="positive" title={t('dialog.outcome.replayed')} body={t('dialog.outcome.replayedBody')} />
          : <Result tone="positive" title={t(`dialog.outcome.ok.${operation}`)} body={t(`dialog.outcome.okBody.${operation}`)} />}
      </div>
    );
  }
  if (outcome.kind === 'rejected') {
    return (
      <div className="space-y-2" data-outcome="rejected" data-reason={outcome.reason ?? ''}>
        <Result tone="negative" title={t('dialog.outcome.rejected')} body={t('dialog.outcome.rejectedBody')} />
        <p className="text-sm text-text" data-reason-text="">{reasonLabel(t, outcome.reason ?? 'validation')}</p>
        {outcome.blockers.length > 0 ? <BlockerBadges codes={outcome.blockers} label={t('dialog.blockers')} /> : null}
      </div>
    );
  }
  if (outcome.kind === 'not_sent') {
    return <div data-outcome="not_sent" data-cause={outcome.cause}><Result tone="warning" title={t(`dialog.outcome.notSent.${outcome.cause}`)} body={t('dialog.outcome.notSentBody')} /></div>;
  }
  // unknown — لا تظهر أزرار التحقق إلا في المراحل التي تنتظر قراراً (لا أثناء القراءة ولا بعد حسمها).
  return (
    <div className="space-y-2" data-outcome="unknown" data-cause={outcome.cause}>
      <Result tone="warning" title={t('dialog.outcome.unknown')} body={t(`dialog.outcome.unknownBody.${outcome.cause}`)} />
      {flow === 'unknown' ? <Button type="button" className="max-md:min-h-11" onClick={onVerify} data-verify="">{t('dialog.outcome.verify')}</Button> : null}
    </div>
  );
}
