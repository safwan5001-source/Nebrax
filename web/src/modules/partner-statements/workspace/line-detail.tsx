'use client';

/**
 * تفاصيل سطر الكشف (لوحة جانبية على المكتب، Sheet كامل الشاشة على الجوال): سطر الكشف ثم حكم المحرّك وتفسيره ثم المرشّحون **متراصّين عمودياً** ثم القرار الفعّال ثم شريط الإجراءات.
 * الإجراءات من `editable` (صلاحية `reconcile` + قدرة `enabled` + مقارنة `draft`) لا من الحالة وحدها. القرارات تمرّ بطابور محدود؛ لا حسم يظهر قبل ردّ الخادم.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Ban, CheckCircle2, GitMerge, Link2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { describeError } from '../errors';
import { fetchLineHistory } from './client';
import { CandidatePicker, selectionSignature, type VerifiedSet } from './candidate-picker';
import { DecisionForm } from './decision-form';
import { reasonRequired, decisionState, signedNetDifference } from './decision-rules';
import { explanationKey, safeParams, warningKey } from './explanation';
import { DecisionBadge, LineAmount, Money, OutcomeBadge } from './presentation';
import { ReversedPairsPanel } from './reversed-pairs';
import { CONFIRMABLE_OUTCOMES, type Decision, type DecisionRequest, type MatchRow, type PairMember, type ReversedPair, type StatementLine, type UnitSnapshot } from './types';
import type { QueueJob } from './decision-queue';

export type Mode = null | 'confirm' | 'dismiss' | 'override' | 'link_pair';

/** حالة عمل السطر قيد التحرير — يملكها المالك (لا اللوحة) كي تبقى عبر إعادة التركيب. */
export interface LineWork {
  mode: Mode;
  unitKeys: string[];
  verify: VerifiedSet | null;
  pair: { unitKey: string; member: PairMember } | null;
}

export const EMPTY_WORK: LineWork = { mode: null, unitKeys: [], verify: null, pair: null };

export interface LineDetailProps {
  reconciliationId: string;
  runId: string | null;
  row: MatchRow | null;
  /** سطر الكشف قبل أول تشغيلة (بلا حكم محرّك). */
  bareLine: StatementLine | null;
  toleranceMinor: number;
  editable: boolean;
  ledgerUnits: UnitSnapshot[];
  job: QueueJob | null;
  work: LineWork;
  onWork: (patch: Partial<LineWork>) => void;
  submit: (request: DecisionRequest) => Promise<QueueJob>;
  /** بعد نجاح قرار: يعيد المالك قراءة الحال من الخادم. */
  onDecided: (job: QueueJob) => void;
  onNextUndecided?: () => void;
}

export function LineDetail(props: LineDetailProps) {
  const t = useTranslations('partnerStatements');
  const { row, bareLine, runId, editable, job } = props;
  const line = row?.line ?? bareLine;
  const { mode, pair } = props.work;
  const setMode = (next: Mode) => props.onWork({ mode: next });
  const setPair = (next: LineWork['pair']) => props.onWork({ pair: next });
  const signature = selectionSignature(props.work.unitKeys);
  const picker = { unitKeys: props.work.unitKeys, verify: props.work.verify && props.work.verify.lineId === (row?.line?.id ?? bareLine?.id) && props.work.verify.runId === runId && props.work.verify.signature === signature ? props.work.verify.result : null };
  const [history, setHistory] = useState<Decision[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [quickError, setQuickError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const lineId = line?.id ?? '';
  // السطر النشط الآن (لا السطر وقت بدء الإرسال): قرار سطر سابق يكتمل لاحقاً **لا يمسّ** عمل/إشعارات السطر الجاري تحريره.
  const activeLineRef = useRef(lineId);
  activeLineRef.current = lineId;

  useEffect(() => {
    setHistory(null);
    setHistoryError(null);
    setQuickError(null);
    setNotice(null);
  }, [lineId]);

  if (!line) return <p className="p-4 text-sm text-muted">{t('workspace.detail.select_line')}</p>;

  const decision = row?.decision ?? null;
  const state = decisionState({ decision }, runId);
  const outcome = row?.outcome ?? null;
  const canConfirm = editable && runId !== null && row !== null && CONFIRMABLE_OUTCOMES.includes(row.outcome) && row.unit_key !== null;
  const canDismiss = editable && runId !== null && outcome === 'missing_in_books';
  const canOverride = editable && runId !== null && row !== null;
  const canLink = canOverride;
  const canClear = editable && runId !== null && decision !== null;
  const busy = job?.status === 'queued' || job?.status === 'sending' || job?.status === 'backoff';

  const loadHistory = async () => {
    const requested = line.id;
    setHistoryError(null);
    try {
      const items = await fetchLineHistory(props.reconciliationId, requested);
      // ردّ سطر سابق لا يُعرض تحت سطر آخر (السطر النشط الآن قد تغيّر أثناء الانتظار).
      if (requested === activeLineRef.current) setHistory(items);
    } catch (error) {
      if (requested === activeLineRef.current) setHistoryError(describeError(error).key);
    }
  };

  const finish = (result: QueueJob) => {
    if (result.lineId === activeLineRef.current) {
      const warnings = result.result?.warnings ?? [];
      setNotice(result.result?.replayed ? t('workspace.detail.replayed') : warnings.length > 0 ? warnings.map((w) => t(`workspace.warning.${warningKey(w.code)}`, safeParams(w.params))).join(' · ') : null);
      props.onWork({ ...EMPTY_WORK });
    }
    props.onDecided(result);   // إعادة قراءة الحال من الخادم دائماً
  };

  const quick = async (request: DecisionRequest) => {
    setQuickError(null);
    const result = await props.submit(request);
    if (result.status === 'done') finish(result);
    else if (result.lineId === activeLineRef.current) setQuickError(describeError(result.error).key);
  };

  // صافي الفرق بإشارة الخادم (لا فرق المحرّك الخام): ما يُعرض في الإقرار هو ما سيُسجَّل في القرار.
  const signedDifference = row ? signedNetDifference(row.difference_minor, line) : null;
  const immediateConfirm = row !== null && !reasonRequired({ action: 'confirm', engineOutcome: row.outcome, netDifferenceMinor: signedDifference });
  const verifyOk = picker.verify !== null && picker.verify.problems.length === 0;
  const overrideBlock = picker.unitKeys.length === 0 ? t('workspace.picker.verify_required') : picker.verify === null ? t('workspace.picker.verify_required') : !verifyOk ? t('workspace.picker.has_problems') : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="line-detail">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 pb-6">
        <section aria-label={t('workspace.detail.statement_line')} className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-text">{t('workspace.detail.line_title', { ordinal: line.ordinal })}</h3>
            {row ? <OutcomeBadge outcome={row.outcome} t={t as never} /> : null}
            {row ? <DecisionBadge decision={decision} state={state} t={t as never} /> : null}
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted">{t('workspace.col.date')}</dt>
            <dd className="num" dir="ltr">{line.date}</dd>
            <dt className="text-muted">{t('workspace.col.reference')}</dt>
            <dd className="num break-words" dir="auto">{line.reference ?? '—'}</dd>
            {line.our_reference ? (
              <>
                <dt className="text-muted">{t('workspace.col.our_reference')}</dt>
                <dd className="num break-words" dir="auto">{line.our_reference}</dd>
              </>
            ) : null}
            <dt className="text-muted">{t('workspace.col.description')}</dt>
            <dd className="break-words" dir="auto">{line.description ?? '—'}</dd>
            <dt className="text-muted">{t('workspace.col.amount')}</dt>
            <dd><LineAmount line={line} t={t as never} /></dd>
          </dl>
        </section>

        {row ? (
          <section aria-label={t('workspace.detail.engine')} className="space-y-1.5 rounded-md border border-border bg-background p-3 text-sm">
            <p className="font-medium text-text" data-testid="explanation">{t(`workspace.explanation.${explanationKey(row.explanation?.code)}`, safeParams(row.explanation?.params))}</p>
            <p className="text-xs text-muted">
              {row.rule ? t('workspace.detail.rule', { rule: row.rule }) : null}
              {signedDifference !== null && signedDifference !== 0 ? <> · {t('workspace.detail.difference')} <Money minor={signedDifference} signed /></> : null}
              {row.day_difference ? <> · {t('workspace.detail.days', { days: row.day_difference })}</> : null}
            </p>
            {row.warnings.map((warning, index) => (
              <p key={`${warning.code}-${index}`} className="text-xs text-warning">{t(`workspace.warning.${warningKey(warning.code)}`, safeParams(warning.params))}</p>
            ))}
            {row.unit ? <UnitLine unit={row.unit} t={t as never} /> : null}
          </section>
        ) : null}

        {decision ? (
          <section aria-label={t('workspace.detail.decision')} className="space-y-1 rounded-md border border-border p-3 text-sm" data-testid="current-decision">
            <p className="font-medium text-text">{t(`workspace.action.${decision.action}`)} · <span className="num text-muted" dir="ltr">r{decision.revision}</span></p>
            {state === 'other_run' ? <p className="text-xs text-warning">{t('workspace.detail.other_run_hint')}</p> : null}
            {decision.reason ? <p className="break-words text-muted" dir="auto">{decision.reason}</p> : null}
            {decision.difference_minor ? <p className="text-xs text-muted">{t('workspace.detail.difference')} <Money minor={decision.difference_minor} signed /> {decision.accepted_difference ? `· ${t('workspace.detail.accepted')}` : ''}</p> : null}
          </section>
        ) : null}

        {notice ? <p role="status" className="rounded border border-primary/30 bg-primary-soft p-2 text-xs text-text" data-testid="decision-notice">{notice}</p> : null}

        {mode === 'override' && row ? (
          <section className="space-y-3">
            <h4 className="text-sm font-semibold">{t('workspace.detail.override_title')}</h4>
            <CandidatePicker
              reconciliationId={props.reconciliationId}
              lineId={line.id}
              runId={runId}
              row={row}
              ledgerUnits={props.ledgerUnits}
              selected={props.work.unitKeys}
              verify={props.work.verify}
              onSelect={(keys) => props.onWork({ unitKeys: keys })}
              onVerified={(verified) => props.onWork({ verify: verified })}
            />
            {picker.unitKeys.length > 0 ? (
              <DecisionForm
                reconciliationId={props.reconciliationId}
                runId={runId as string}
                lineId={line.id}
                action="override"
                row={row}
                unitKeys={picker.unitKeys}
                netDifferenceMinor={picker.verify ? picker.verify.difference_minor : null}
                toleranceMinor={props.toleranceMinor}
                externalBlock={overrideBlock}
                job={job}
                submitLabel={t('workspace.action.override')}
                onSubmit={props.submit}
                onDone={finish}
                onCancel={() => setMode(null)}
              />
            ) : null}
          </section>
        ) : null}

        {mode === 'link_pair' && row ? (
          <section className="space-y-3">
            <h4 className="text-sm font-semibold">{t('workspace.detail.link_title')}</h4>
            {pair ? (
              <DecisionForm
                reconciliationId={props.reconciliationId}
                runId={runId as string}
                lineId={line.id}
                action="link_pair"
                row={row}
                unitKeys={[pair.unitKey]}
                pairMember={pair.member}
                netDifferenceMinor={null}
                toleranceMinor={props.toleranceMinor}
                job={job}
                submitLabel={t('workspace.action.link_pair')}
                onSubmit={props.submit}
                onDone={finish}
                onCancel={() => setPair(null)}
              />
            ) : (
              <ReversedPairsPanel reconciliationId={props.reconciliationId} onLink={(p: ReversedPair, member) => setPair({ unitKey: p.unit_key, member })} />
            )}
          </section>
        ) : null}

        {mode === 'confirm' && row ? (
          <DecisionForm
            reconciliationId={props.reconciliationId}
            runId={runId as string}
            lineId={line.id}
            action="confirm"
            row={row}
            netDifferenceMinor={signedDifference}
            toleranceMinor={props.toleranceMinor}
            job={job}
            submitLabel={t('workspace.action.confirm')}
            onSubmit={props.submit}
            onDone={finish}
            onCancel={() => setMode(null)}
          />
        ) : null}

        {mode === 'dismiss' && row ? (
          <DecisionForm
            reconciliationId={props.reconciliationId}
            runId={runId as string}
            lineId={line.id}
            action="dismiss"
            row={row}
            netDifferenceMinor={null}
            toleranceMinor={props.toleranceMinor}
            job={job}
            submitLabel={t('workspace.action.dismiss')}
            onSubmit={props.submit}
            onDone={finish}
            onCancel={() => setMode(null)}
          />
        ) : null}

        {quickError ? <p role="alert" className="text-sm text-negative" data-testid="decision-error">{t(`errors.${quickError}`)}</p> : null}

        {decision ? (
          <section className="space-y-1.5">
            <Button type="button" size="sm" variant="ghost" onClick={() => void loadHistory()} aria-expanded={history !== null}>{t('workspace.detail.history')}</Button>
            {historyError ? <p className="text-xs text-negative">{t(`errors.${historyError}`)}</p> : null}
            {history ? (
              <ol className="space-y-1 text-xs text-muted" data-testid="line-history">
                {history.map((item) => (
                  <li key={item.id}>
                    <span className="num" dir="ltr">r{item.revision}</span> · {t(`workspace.action.${item.action}`)}
                    {item.reason ? <span dir="auto"> · {item.reason}</span> : null} · <span className="num" dir="ltr">{(item.created_at ?? '').slice(0, 16).replace('T', ' ')}</span>
                  </li>
                ))}
              </ol>
            ) : null}
          </section>
        ) : null}
      </div>

      {editable && row && runId ? (
        <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-border bg-surface p-3" data-testid="action-bar" role="toolbar" aria-label={t('workspace.detail.actions')}>
          {canConfirm ? (
            <Button
              type="button"
              className="min-h-[44px] md:min-h-9"
              disabled={busy}
              onClick={() => (immediateConfirm ? void quick({ run_id: runId, line_id: line.id, action: 'confirm' }) : setMode('confirm'))}
            >
              <CheckCircle2 className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
              {t('workspace.action.confirm')}
            </Button>
          ) : null}
          {canOverride ? (
            <Button type="button" variant="outline" className="min-h-[44px] md:min-h-9" disabled={busy} onClick={() => setMode('override')}>
              <GitMerge className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
              {t('workspace.action.override')}
            </Button>
          ) : null}
          {canDismiss ? (
            <Button type="button" variant="outline" className="min-h-[44px] md:min-h-9" disabled={busy} onClick={() => setMode('dismiss')}>
              <Ban className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
              {t('workspace.action.dismiss')}
            </Button>
          ) : null}
          {canLink ? (
            <Button type="button" variant="outline" className="min-h-[44px] md:min-h-9" disabled={busy} onClick={() => setMode('link_pair')}>
              <Link2 className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
              {t('workspace.action.link_pair')}
            </Button>
          ) : null}
          {canClear ? (
            <Button type="button" variant="ghost" className="min-h-[44px] md:min-h-9" disabled={busy} onClick={() => void quick({ run_id: runId, line_id: line.id, action: 'clear' })}>
              <RotateCcw className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
              {t('workspace.action.clear')}
            </Button>
          ) : null}
          {props.onNextUndecided ? (
            <Button type="button" variant="ghost" className="ms-auto min-h-[44px] md:min-h-9" onClick={props.onNextUndecided}>
              {t('workspace.next_undecided')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function UnitLine({ unit, t }: { unit: UnitSnapshot; t: (key: string, values?: Record<string, string | number>) => string }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted" data-testid="proposed-unit">
      <span>{t('workspace.detail.proposed_unit')}</span>
      <span className="font-medium text-text" dir="auto">{unit.doc_number ?? unit.key}</span>
      <span className="num" dir="ltr">{unit.date ?? '—'}</span>
      <Money minor={unit.amount_minor} />
    </p>
  );
}
