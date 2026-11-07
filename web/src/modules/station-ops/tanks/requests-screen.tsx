'use client';

import { useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Hourglass } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge, type Tone } from '../admin/ui';
import { PageMasthead, ScreenBody } from '../masthead';
import { EmptyState, ErrorState, LoadingBlock } from '../state-views';
import { StationGate } from '../station-gate';
import type { Station } from '../schemas';
import { formatStampInZone } from '../format';
import { ConfirmDialog, PrimaryButton, SecondaryButton } from '../write-ui';
import { FailureNotice, type AnyFailure } from '../receiving/parts';
import { decideRequest } from './actions-client';
import { useReadingRequests, useTanksAccess } from './data';
import { Liters, TANKS_BASE, TypeText, asFailure } from './parts';
import type { LateRequest, RequestStatus, RequestsPage } from './schemas';
import { useStationOps } from '../context';

const FILTERS = ['pending', 'approved', 'rejected', 'all'] as const;
const TONES: Record<RequestStatus, Tone> = { pending: 'warning', approved: 'positive', rejected: 'negative' };

function RequestCard({ request, station, canDecide, viewerId, onChanged, onFailure }: { request: LateRequest; station: Station; canDecide: boolean; viewerId: string; onChanged: () => void; onFailure: (failure: AnyFailure | null) => void }) {
  const t = useTranslations('stationOps');
  const locale = useLocale();
  const [dialog, setDialog] = useState<'approve' | 'reject' | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const own = request.requested_by === viewerId;
  const pending = request.status === 'pending';
  const lateHours = request.late_by_seconds == null ? null : Math.round(request.late_by_seconds / 3600);

  const decide = async () => {
    if (sending.current || dialog === null) return;
    if (dialog === 'reject' && note.trim() === '') return;
    sending.current = true;
    setBusy(true);
    onFailure(null);
    try {
      const result = await decideRequest(request.id, dialog, note, station.branch_id);
      if (result.kind === 'ok') { setDialog(null); setNote(''); onChanged(); return; }
      // الرسالة على مستوى القائمة: بعد 409/404 يخرج الطلب من المرشّح الحالي فلا نفقد سبب الرفض مع البطاقة.
      onFailure(asFailure(result));
      // قرار سابق/تغيّرت الحالة: نُحدّث من الخادم ولا نعيد المحاولة على حالة قديمة.
      if (result.kind === 'rejected' && (result.status === 409 || result.status === 404)) onChanged();
      if (result.kind === 'rejected' || result.kind === 'not_sent') setDialog(null);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  return (
    <li className="space-y-2.5 rounded-[14px] border border-border bg-surface p-4" data-request-card={request.id} data-status={request.status}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-text">{request.tank?.name ?? request.fuel_tank_id}</p>
          <p className="text-sm text-muted"><TypeText type={request.reading_type} /></p>
        </div>
        <Badge tone={TONES[request.status]}>{t(`tanks.requests.status.${request.status}`)}</Badge>
      </div>
      <p className="text-lg font-bold text-text"><Liters ml={request.quantity_milliliters} /></p>
      <dl className="grid gap-1 text-sm leading-6">
        <div className="flex flex-wrap gap-x-2"><dt className="text-muted">{t('tanks.requests.measuredAt')}:</dt><dd className="num text-text">{formatStampInZone(request.measured_at, locale, station.timezone)}</dd></div>
        {lateHours !== null ? <div className="flex flex-wrap gap-x-2"><dt className="text-muted">{t('tanks.requests.lateBy')}:</dt><dd className="num text-text">{t('tanks.requests.hours', { value: String(lateHours) })}</dd></div> : null}
        <div className="flex flex-wrap gap-x-2"><dt className="text-muted">{t('tanks.requests.by')}:</dt><dd className="text-text">{request.requester?.name ?? '—'}{own ? ` (${t('tanks.requests.you')})` : ''}</dd></div>
        <div className="flex flex-wrap gap-x-2"><dt className="shrink-0 text-muted">{t('tanks.late.reasonShort')}:</dt><dd className="min-w-0 break-words text-text">{request.reason || '—'}</dd></div>
        {request.evidence?.note ? <div className="flex flex-wrap gap-x-2"><dt className="shrink-0 text-muted">{t('tanks.detail.noteLabel')}:</dt><dd className="min-w-0 break-words text-text">{request.evidence.note}</dd></div> : null}
      </dl>
      {!pending ? (
        <div className="space-y-0.5 border-t border-border pt-2 text-sm leading-6" data-decision="">
          <p className="text-text">{t(`tanks.requests.decidedBy.${request.status}`, { name: request.decider?.name ?? '—' })} · <span className="num">{formatStampInZone(request.decided_at, locale, station.timezone)}</span></p>
          {request.decision_note ? <p className="break-words text-muted">{request.decision_note}</p> : null}
        </div>
      ) : null}
      {pending && canDecide ? (
        own ? (
          <p className="text-sm leading-6 text-muted" data-self-note="">{t('tanks.requests.selfNote')}</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <PrimaryButton onClick={() => { onFailure(null); setDialog('approve'); }} data-approve="">{t('tanks.requests.approve')}</PrimaryButton>
            <SecondaryButton onClick={() => { onFailure(null); setDialog('reject'); }} data-reject="">{t('tanks.requests.reject')}</SecondaryButton>
          </div>
        )
      ) : null}
      {pending && !canDecide ? <p className="flex items-center gap-2 text-sm text-warning"><Hourglass aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />{t('tanks.requests.awaiting')}</p> : null}

      <ConfirmDialog open={dialog !== null} title={dialog === 'approve' ? t('tanks.requests.confirmApproveTitle') : t('tanks.requests.confirmRejectTitle')} onClose={() => setDialog(null)} busy={busy}>
        <div className="space-y-4" data-decision-dialog={dialog ?? ''}>
          <p className="text-sm leading-6 text-muted">{dialog === 'approve' ? t('tanks.requests.confirmApproveBody') : t('tanks.requests.confirmRejectBody')}</p>
          <label className="block text-sm font-medium text-text">
            {dialog === 'reject' ? t('tanks.requests.noteRequired') : t('tanks.requests.noteOptional')}
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value.slice(0, 500))}
              rows={2}
              maxLength={500}
              disabled={busy}
              aria-required={dialog === 'reject'}
              data-decision-note=""
              className="mt-1.5 w-full rounded-[11px] border border-[color:var(--fo-control)] bg-surface px-3 py-2.5 text-base text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </label>
          <PrimaryButton onClick={decide} disabled={busy || (dialog === 'reject' && note.trim() === '')} data-decision-confirm="">
            {busy ? t('tanks.detail.saving') : dialog === 'approve' ? t('tanks.requests.confirmApprove') : t('tanks.requests.confirmReject')}
          </PrimaryButton>
          <SecondaryButton onClick={() => setDialog(null)} disabled={busy}>{t('tanks.detail.confirmBack')}</SecondaryButton>
        </div>
      </ConfirmDialog>
    </li>
  );
}

function List({ station }: { station: Station }) {
  const t = useTranslations('stationOps');
  const access = useTanksAccess();
  const { viewer } = useStationOps();
  const [status, setStatus] = useState<RequestStatus | 'all'>('pending');
  const [page, setPage] = useState(1);
  const [failure, setFailure] = useState<AnyFailure | null>(null);
  const requests = useReadingRequests(station, status, page);
  const { state } = requests;
  // أثناء إعادة الجلب بعد قرار نُبقي آخر قائمة (لنفس الحالة والصفحة) كي لا تُفكَّك البطاقة فتضيع رسالة الخطأ/الإشعار؛ التحميل الأول فقط يُظهر الهيكل.
  const kept = useRef<{ key: string; data: RequestsPage } | null>(null);
  const viewKey = `${status}|${page}`;
  if (state.status === 'success') kept.current = { key: viewKey, data: state.data };
  const data = state.status === 'success' ? state.data : state.status === 'loading' && kept.current?.key === viewKey ? kept.current.data : null;

  return (
    <>
      <p className="text-sm leading-6 text-muted">{access.approveLate ? t('tanks.requests.introApprover') : t('tanks.requests.introRequester')}</p>
      <div role="radiogroup" aria-label={t('tanks.requests.filterLabel')} className="grid grid-cols-2 gap-2 min-[360px]:grid-cols-4">
        {FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={status === value}
            onClick={() => { setStatus(value); setPage(1); }}
            className={cn('min-h-12 rounded-lg border px-1 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary', status === value ? 'border-primary bg-primary-soft text-primary' : 'border-[color:var(--fo-control)] text-text')}
          >
            {value === 'all' ? t('tanks.history.filterAll') : t(`tanks.requests.status.${value}`)}
          </button>
        ))}
      </div>
      {failure ? <FailureNotice failure={failure} onCheck={requests.reload} /> : null}
      {state.status === 'loading' && !data ? <LoadingBlock rows={3} /> : null}
      {state.status === 'error' ? <ErrorState error={state.error} onRetry={requests.reload} /> : null}
      {data && data.rows.length === 0 ? <EmptyState title={t('tanks.requests.empty')} /> : null}
      {data && data.rows.length > 0 ? (
        <>
          <ul className="space-y-3">
            {data.rows.map((row) => <RequestCard key={row.id} request={row} station={station} canDecide={access.approveLate} viewerId={viewer.id} onChanged={requests.reload} onFailure={setFailure} />)}
          </ul>
          <nav aria-label={t('tanks.history.pagination')} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <SecondaryButton disabled={data.page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>{t('tanks.history.prev')}</SecondaryButton>
            <span className="num px-2 text-sm text-muted">{t('tanks.history.page', { page: data.page, last: data.lastPage })}</span>
            <SecondaryButton disabled={data.page >= data.lastPage} onClick={() => setPage((value) => value + 1)}>{t('tanks.history.next')}</SecondaryButton>
          </nav>
        </>
      ) : null}
      <p className="text-xs leading-5 text-muted">{t('tanks.requests.operationalNote')}</p>
    </>
  );
}

export function RequestsScreen() {
  const t = useTranslations('stationOps');
  return (
    <>
      <PageMasthead title={t('tanks.requests.title')} subtitle={t('tanks.requests.subtitle')} backHref={TANKS_BASE} backLabel={t('tanks.detail.back')} />
      <ScreenBody>
        <StationGate>{(station) => <List station={station} />}</StationGate>
      </ScreenBody>
    </>
  );
}
