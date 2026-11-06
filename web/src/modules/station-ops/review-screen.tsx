'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { CircleAlert, CircleCheck, ClipboardCheck, Lock } from 'lucide-react';
import { CashSummarySection } from './cash-summary-section';
import { CollectionReadOnly } from './collection-section';
import type { CollectionView } from './collection';
import { useStationOps } from './context';
import { useShiftCollection, useShiftDetail, useStationPolicy } from './data';
import { formatInZone } from './format';
import { PageMasthead, ScreenBody } from './masthead';
import { OPS_BASE } from './nav';
import type { ShiftDetail, Station } from './schemas';
import { StationGate } from './station-gate';
import { EmptyState, ErrorState, InlineNote, LoadingBlock } from './state-views';
import { opsWrite, opsWriteReviewCollection, type WriteResult } from './write-client';
import { ActionBar, ConfirmDialog, PrimaryButton, SecondaryButton, SectionCard, WriteNotice } from './write-ui';

/**
 * مراجعة الوردية المغلقة واعتمادها (المشرف) — داخل التطبيق، فوق **واجهات الخادم القائمة نفسها** بلا نظام جديد:
 *  - `POST …/collection/review` (مراجعة فرق مطابقة التحصيل) و`POST …/cash-variance/review` (فرق نقد الدرج) و`POST …/approve`.
 *  - الصلاحيات والقواعد يفرضها الخادم (`fuel.shift.approve`/`fuel.shift.cash_variance_review`، مشرف مختلف عن فاتح الوردية، لا اعتماد قبل اكتمال
 *    المراجعة). هذه الشاشة **تعرض** السبب وتعطّل الزر مسبقاً؛ الخادم الحَكَم دائماً، وأي رفض يُعرض برسالة واضحة.
 *  - **لا حساب مالي هنا ولا أثر محاسبي:** كل الأرقام من الخادم (اللقطة المجمّدة للمغلقة)، ولا تُخلط «المطابقة التشغيلية» (تقدير مبيعات العدادات مقابل
 *    ما أقرّ به البائع) بـ«ملخص نقد الدرج» (عهدة + حركات موثّقة + المعدود) — قسمان منفصلان بمبالغهما.
 *  - النجاح يُعلَن فقط حين يطابق ردّ الخادم المطلوب (اعتُمدت/روجع)؛ غير المؤكد يُحسم بإعادة القراءة لا بإعادة الإرسال.
 */

type Kind = 'collection' | 'cash' | 'approve';

const AUDIT_TYPES = ['closed', 'collection_frozen', 'cash_variance_pending_review', 'collection_reviewed', 'cash_variance_reviewed', 'approved_locked'] as const;
type AuditType = (typeof AUDIT_TYPES)[number];
const isAuditType = (value: string): value is AuditType => (AUDIT_TYPES as readonly string[]).includes(value);

function AuditTrail({ detail, timeZone }: { detail: ShiftDetail; timeZone: string | null | undefined }) {
  const t = useTranslations('stationOps');
  const locale = useLocale();
  const items = (detail.events ?? [])
    .filter((event) => isAuditType(event.type))
    .sort((a, b) => Date.parse(a.occurred_at ?? '') - Date.parse(b.occurred_at ?? ''));
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="fo-audit-h" data-audit-trail="" className="rounded-[14px] border border-border bg-surface p-4">
      <h2 id="fo-audit-h" className="text-base font-semibold text-text">{t('review.audit.title')}</h2>
      <p className="mt-0.5 text-xs leading-5 text-muted">{t('review.audit.note')}</p>
      <ol className="mt-2 divide-y divide-border">
        {items.map((event) => {
          const note = typeof event.payload?.note === 'string' && (event.type === 'collection_reviewed' || event.type === 'cash_variance_reviewed' || event.type === 'approved_locked') ? event.payload.note : null;
          return (
            <li key={event.id} data-audit-event={event.type} className="py-2.5 text-sm">
              <p className="font-medium text-text">{t(`review.audit.type.${event.type as AuditType}`)}</p>
              <p className="text-xs text-muted tabular-nums">{formatInZone(event.occurred_at ?? null, locale, timeZone, 'date')} · {formatInZone(event.occurred_at ?? null, locale, timeZone, 'time')}</p>
              {note ? <p className="mt-1 break-words text-xs text-muted">{note}</p> : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Explainer() {
  const t = useTranslations('stationOps');
  return (
    <section aria-labelledby="fo-explain-h" data-review-explainer="" className="rounded-[14px] border border-border bg-surface p-4">
      <h2 id="fo-explain-h" className="text-base font-semibold text-text">{t('review.explain.title')}</h2>
      <dl className="mt-2 space-y-3 text-sm leading-6">
        <div><dt className="font-semibold text-text">{t('review.explain.reconTitle')}</dt><dd className="text-muted">{t('review.explain.reconBody')}</dd></div>
        <div><dt className="font-semibold text-text">{t('review.explain.cashTitle')}</dt><dd className="text-muted">{t('review.explain.cashBody')}</dd></div>
      </dl>
      <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-muted"><Lock aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.7} />{t('review.explain.frozen')}</p>
    </section>
  );
}

function Content({ station, shiftId }: { station: Station; shiftId: string }) {
  const t = useTranslations('stationOps');
  const locale = useLocale();
  const { viewer, can } = useStationOps();
  const query = useShiftDetail(station, shiftId);
  const collectionQuery = useShiftCollection(station, shiftId);
  const { policy } = useStationPolicy(station);

  const [dialog, setDialog] = useState<Kind | null>(null);
  const [noteRaw, setNoteRaw] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<WriteResult | null>(null);
  const [done, setDone] = useState<Kind | null>(null);
  const [checking, setChecking] = useState(false);
  /** وردية أكّدها ردّ كتابة مع نسخة GET التي كانت معروضة وقتها: تُعرض حتى تصل بيانات GET أحدث (هوية كائن مختلفة). */
  const [confirmed, setConfirmed] = useState<{ shift: ShiftDetail; base: ShiftDetail | null } | null>(null);
  const sending = useRef(false);

  const queried: ShiftDetail | null = query.state.status === 'success' ? query.state.data : query.retained?.data ?? null;
  const detail: ShiftDetail | null = confirmed && (query.state.status !== 'success' || query.state.data === confirmed.base) ? confirmed.shift : queried;
  const cv: CollectionView | null = collectionQuery.state.status === 'success' ? collectionQuery.state.data : collectionQuery.retained;

  const reloadAll = () => { query.reload(); collectionQuery.reload(); };
  const check = () => { setChecking(true); reloadAll(); window.setTimeout(() => setChecking(false), 600); };

  const gate = useMemo(() => {
    if (!detail) return null;
    const collectionPending = cv?.review.visible === true && cv.review.state === 'pending';
    const collectionHidden = cv !== null && cv.review.visible === false;
    const cashPending = detail.cash_variance?.status === 'pending_review' && !detail.cash_variance.reviewed_at;
    // فرق الدرج يُشترط مراجعته للاعتماد مع الميزة المفعّلة فقط (الخادم يفرض الشرط نفسه)؛ الميزة مغلقة ⇒ المراجعة متاحة ولا تمنع الاعتماد.
    const cashBlocking = cv !== null && cashPending;
    const sameUser = policy.supervisorApprovalRequired === true && detail.opened_by === viewer.id;
    const blockers = [collectionPending ? 'collection_review' : null, cashBlocking ? 'cash_variance_review' : null, sameUser ? 'same_user' : null].filter((x): x is string => x !== null);
    return { collectionPending, collectionHidden, cashPending, blockers };
  }, [detail, cv, policy.supervisorApprovalRequired, viewer.id]);

  if (!query.allowed) return <div className="pt-5"><EmptyState title={t('shift.noPermission.title')} body={t('shift.noPermission.body')} /></div>;
  if (!detail || !gate) {
    if (query.state.status === 'error') return <div className="pt-5"><ErrorState error={query.state.error} onRetry={query.reload} /></div>;
    return <div className="pt-5"><LoadingBlock rows={3} /></div>;
  }

  const detailHref = `${OPS_BASE}/shifts/${encodeURIComponent(shiftId)}`;
  if (detail.status === 'open') {
    return <div className="space-y-3 pt-5" data-review-not-closed=""><EmptyState title={t('review.notClosed.title')} body={t('review.notClosed.body')} /><Link href={detailHref} className="flex min-h-12 items-center justify-center rounded-[13px] border border-[color:var(--fo-control)] bg-surface px-4 text-sm font-semibold text-text">{t('review.notClosed.back')}</Link></div>;
  }

  const approved = detail.status === 'approved';
  const canApprove = can('fuel.shift.approve');
  const canReview = can('fuel.shift.cash_variance_review');
  const approveDisabled = !canApprove || gate.blockers.length > 0 || busy;

  const close = () => { if (!busy) { setDialog(null); setNoteRaw(''); setAck(false); } };
  const noteValid = noteRaw.trim().length >= 3;

  const run = async () => {
    if (sending.current || dialog === null) return;
    if (dialog !== 'approve' && !noteValid) return;
    sending.current = true;
    setBusy(true);
    setFailure(null);
    setDone(null);
    try {
      const options = { branchId: station.branch_id };
      const note = noteRaw.trim();
      if (dialog === 'collection') {
        const result = await opsWriteReviewCollection(shiftId, note, options);
        if (result.kind === 'ok' && result.view.review.visible && result.view.review.state === 'reviewed') { setDone('collection'); close(); reloadAll(); return; }
        if (result.kind === 'rejected') reloadAll();
        setFailure(result.kind === 'ok' ? { kind: 'unverified' } : result);
      } else if (dialog === 'cash') {
        const result = await opsWrite({ action: 'review_cash_variance', shiftId, body: { note } }, options);
        if (result.kind === 'ok' && result.shift.cash_variance?.reviewed_at) { setConfirmed({ shift: result.shift, base: queried }); setDone('cash'); close(); reloadAll(); return; }
        if (result.kind === 'rejected') reloadAll();
        setFailure(result.kind === 'ok' ? { kind: 'unverified' } : result);
      } else {
        const result = await opsWrite({ action: 'approve', shiftId, body: note ? { note } : {} }, options);
        if (result.kind === 'ok' && result.shift.status === 'approved') { setConfirmed({ shift: result.shift, base: queried }); setDone('approve'); close(); reloadAll(); return; }
        if (result.kind === 'rejected') reloadAll();
        setFailure(result.kind === 'ok' ? { kind: 'unverified' } : result);
      }
      setDialog(null);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  const reviewRow = (key: 'collection' | 'cash', pending: boolean, reviewed: boolean) => (
    <li key={key} data-review-row={key} data-review-state={pending ? 'pending' : reviewed ? 'reviewed' : 'none'} className="flex flex-col gap-2 py-3">
      <div className="flex items-start gap-2.5">
        {reviewed ? <CircleCheck aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-positive" strokeWidth={1.9} /> : <CircleAlert aria-hidden="true" className={`mt-0.5 h-5 w-5 shrink-0 ${pending ? 'text-warning' : 'text-muted'}`} strokeWidth={1.9} />}
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text">{t(`review.row.${key}.title`)}</p>
          <p className="text-xs leading-5 text-muted">{pending ? t(`review.row.${key}.pending`) : reviewed ? t(`review.row.${key}.reviewed`) : t(`review.row.${key}.none`)}</p>
        </div>
      </div>
      {pending && canReview && !approved ? <SecondaryButton onClick={() => { setFailure(null); setNoteRaw(''); setDialog(key); }} data-review-action={key}>{t(`review.row.${key}.action`)}</SecondaryButton> : null}
      {pending && !canReview && !approved ? <p className="text-xs text-muted">{t('review.noReviewPermission')}</p> : null}
    </li>
  );

  const collectionReviewed = cv?.review.visible === true && cv.review.state === 'reviewed';
  const cashReviewed = Boolean(detail.cash_variance?.reviewed_at);
  const showCollectionRow = cv?.review.visible === true && (cv.review.state === 'pending' || cv.review.state === 'reviewed');
  const showCashRow = detail.cash_variance?.status === 'pending_review';

  return (
    <div className="space-y-4 pt-5" data-review-screen={detail.status}>
      <SectionCard>
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${approved ? 'bg-[color:var(--fo-positive-tint)] text-positive' : 'bg-primary-soft text-primary'}`}>{approved ? <CircleCheck className="h-6 w-6" strokeWidth={1.9} /> : <ClipboardCheck className="h-6 w-6" strokeWidth={1.9} />}</span>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-text">{detail.number}</h2>
            <p className="mt-0.5 text-sm text-muted" data-review-status={detail.status}>{approved ? t('review.status.approved') : t('review.status.closed')}</p>
            <p className="mt-0.5 text-xs text-muted tabular-nums">{t('review.closedAt')}: {formatInZone(detail.closed_at, locale, station.timezone, 'date')} · {formatInZone(detail.closed_at, locale, station.timezone, 'time')}</p>
          </div>
        </div>
      </SectionCard>

      <Explainer />

      {cv ? <CollectionReadOnly view={cv} title={t('review.reconTitle')} /> : <InlineNote>{t('review.noCollection')}</InlineNote>}
      {cv && !cv.review.visible ? <div data-review-no-sales-view=""><InlineNote tone="warning">{t('review.noSalesView')}</InlineNote></div> : null}

      {detail.cash_summary ? (
        <div data-review-cash-summary="">
          <p className="mb-1.5 text-xs leading-5 text-muted">{t('review.cashSummaryNote')}</p>
          <CashSummarySection summary={detail.cash_summary} />
        </div>
      ) : null}

      {showCollectionRow || showCashRow ? (
        <SectionCard title={t('review.reviewsTitle')} id="review-reviews-h">
          <ul className="divide-y divide-border" data-review-list="">
            {showCollectionRow ? reviewRow('collection', cv?.review.visible === true && cv.review.state === 'pending', collectionReviewed) : null}
            {showCashRow ? reviewRow('cash', gate.cashPending, cashReviewed) : null}
          </ul>
          {done === 'collection' || done === 'cash' ? <p role="status" data-review-done={done} className="mt-2 flex items-center gap-2 text-sm font-medium text-positive"><CircleCheck aria-hidden="true" className="h-4 w-4" strokeWidth={2} />{t('review.reviewSaved')}</p> : null}
        </SectionCard>
      ) : null}

      <AuditTrail detail={detail} timeZone={station.timezone} />

      <WriteNotice result={failure} onCheck={check} checking={checking} />
      {approved ? <p role="status" data-review-approved="" className="flex items-center gap-2 text-sm font-medium text-positive"><CircleCheck aria-hidden="true" className="h-4 w-4" strokeWidth={2} />{done === 'approve' ? t('review.approvedNow') : t('review.approvedAlready')}</p> : null}

      {!approved ? (
        <ActionBar>
          <div className="mx-auto max-w-3xl space-y-2">
            {gate.blockers.map((blocker) => <p key={blocker} role="status" data-review-blocker={blocker} className="text-xs leading-5 text-warning">{t(`review.blocker.${blocker as 'collection_review' | 'cash_variance_review' | 'same_user'}`)}</p>)}
            {gate.collectionHidden && gate.blockers.length === 0 ? <p className="text-xs leading-5 text-muted" data-review-hidden-note="">{t('review.hiddenReviewNote')}</p> : null}
            {!canApprove ? <p role="status" data-review-blocker="no_permission" className="text-xs leading-5 text-muted">{t('review.noApprovePermission')}</p> : null}
            <PrimaryButton disabled={approveDisabled} onClick={() => { setFailure(null); setNoteRaw(''); setAck(false); setDialog('approve'); }} data-approve-action="">{t('review.approveCta')}</PrimaryButton>
          </div>
        </ActionBar>
      ) : null}

      <ConfirmDialog open={dialog === 'collection' || dialog === 'cash'} title={dialog === 'cash' ? t('review.row.cash.dialogTitle') : t('review.row.collection.dialogTitle')} onClose={close} busy={busy}>
        <div className="space-y-4">
          <p className="text-sm leading-6 text-muted">{t('review.reviewDialogBody')}</p>
          <div>
            <label htmlFor="review-note" className="block text-sm font-medium text-text">{t('review.noteLabel')}</label>
            <textarea id="review-note" value={noteRaw} onChange={(event) => setNoteRaw(event.target.value)} rows={3} maxLength={2000} disabled={busy} aria-required="true" className="mt-1.5 w-full rounded-[11px] border border-[color:var(--fo-control)] bg-surface px-3 py-2.5 text-base text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" />
            <p className="mt-1 text-xs text-muted">{t('review.noteHint')}</p>
          </div>
          <PrimaryButton disabled={!noteValid || busy} onClick={() => void run()} data-confirm-review="">{busy ? t('review.saving') : t('review.reviewConfirm')}</PrimaryButton>
          <SecondaryButton disabled={busy} onClick={close}>{t('review.cancel')}</SecondaryButton>
        </div>
      </ConfirmDialog>

      <ConfirmDialog open={dialog === 'approve'} title={t('review.approveDialogTitle')} onClose={close} busy={busy}>
        <div className="space-y-4">
          <p className="text-sm leading-6 text-muted">{t('review.approveDialogBody')}</p>
          <div>
            <label htmlFor="approve-note" className="block text-sm font-medium text-text">{t('review.approveNoteLabel')}</label>
            <textarea id="approve-note" value={noteRaw} onChange={(event) => setNoteRaw(event.target.value)} rows={2} maxLength={2000} disabled={busy} className="mt-1.5 w-full rounded-[11px] border border-[color:var(--fo-control)] bg-surface px-3 py-2.5 text-base text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" />
          </div>
          <label className="flex min-h-11 items-start gap-3 text-sm text-text">
            <input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} disabled={busy} className="mt-1 h-5 w-5 shrink-0 accent-[color:var(--primary)]" data-approve-ack="" />
            <span>{t('review.approveAck')}</span>
          </label>
          <PrimaryButton disabled={!ack || busy} onClick={() => void run()} data-confirm-approve="">{busy ? t('review.saving') : t('review.approveConfirm')}</PrimaryButton>
          <SecondaryButton disabled={busy} onClick={close}>{t('review.cancel')}</SecondaryButton>
        </div>
      </ConfirmDialog>
    </div>
  );
}

export function ShiftReviewScreen({ shiftId }: { shiftId: string }) {
  const t = useTranslations('stationOps');
  return (
    <>
      <PageMasthead title={t('review.title')} subtitle={t('review.subtitle')} backHref={`${OPS_BASE}/shifts/${encodeURIComponent(shiftId)}`} backLabel={t('shiftDetail.back')} />
      <ScreenBody flush>
        <StationGate gateClassName="pt-5">{(station) => <Content station={station} shiftId={shiftId} />}</StationGate>
      </ScreenBody>
    </>
  );
}
