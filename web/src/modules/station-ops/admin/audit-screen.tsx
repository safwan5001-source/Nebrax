'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CheckCircle2, ShieldAlert } from 'lucide-react';
import { formatDateTime } from '@/lib/formatting';
import { cn } from '@/lib/utils';
import { useStationOps } from '../context';
import { PageMasthead, ScreenBody } from '../masthead';
import { StationOpsError } from '../read-client';
import { EmptyState, ErrorState, LoadingBlock } from '../state-views';
import { SecondaryButton } from '../write-ui';
import { STAFF_PERMISSION, useAuditPage, type AuditOutcomeFilter } from './data';
import { usePermissionLabel } from './labels';
import { MANAGE_BASE } from './manage-screen';
import type { AuditEvent } from './schemas';
import { Badge } from './ui';

const KNOWN_ACTIONS = ['fuel_staff.updated', 'fuel_staff.station_pin_set', 'fuel_staff.station_pin_cleared', 'role.created', 'role.updated', 'role.deleted', 'user.created', 'user.updated', 'user.deleted'];
const KNOWN_KEYS = ['permissions', 'fuel_permissions', 'add_permissions', 'remove_permissions', 'station_ids', 'fuel_station_ids', 'branch_ids', 'warehouse_ids', 'template', 'role', 'name', 'is_active', 'is_system', 'fuel_station_scope', 'grant_all_fuel', 'employee_id', 'password_changed', 'station_pin', 'station_pin_event'];
const PERMISSION_LIST_KEYS = new Set(['permissions', 'fuel_permissions', 'add_permissions', 'remove_permissions']);
const STATION_LIST_KEYS = new Set(['station_ids', 'fuel_station_ids']);

function ChangeLine({ change, denied }: { change: AuditEvent['changes'][number]; denied: boolean }) {
  const t = useTranslations('stationOps');
  const label = usePermissionLabel();
  const { stations } = useStationOps();
  const names = stations.status === 'success' ? new Map(stations.data.map((station) => [station.id, station.name])) : new Map<string, string>();
  const keyLabel = KNOWN_KEYS.includes(change.key) ? t(`manage.audit.key.${change.key}`) : change.key;
  const item = (value: string) => (PERMISSION_LIST_KEYS.has(change.key) ? label(value) : STATION_LIST_KEYS.has(change.key) ? (names.get(value) ?? t('manage.stations.other')) : value);

  if (change.kind === 'scalar') {
    const show = (value: string | boolean | null | undefined) => (value === null || value === undefined
      ? '—'
      : typeof value === 'boolean'
        ? (value ? t('manage.audit.yes') : t('manage.audit.no'))
        : change.key === 'station_pin_event' && (value === 'set' || value === 'cleared') ? t(`manage.audit.pinEvent.${value}`) : value);
    return (
      <li className="text-sm leading-6 text-text">
        <span className="font-medium">{keyLabel}</span>{': '}
        {denied ? <span>{show(change.to)}</span> : <span>{t('manage.audit.fromTo', { from: show(change.from), to: show(change.to) })}</span>}
      </li>
    );
  }
  const added = change.added ?? [];
  const removed = change.removed ?? [];
  const showItems = PERMISSION_LIST_KEYS.has(change.key) || STATION_LIST_KEYS.has(change.key);
  return (
    <li className="text-sm leading-6 text-text">
      <span className="font-medium">{keyLabel}</span>{': '}
      <span className="num text-positive">{`+${added.length}`}</span>{' '}
      {!denied ? <span className="num text-negative">{`−${removed.length}`}</span> : null}
      {showItems && (added.length > 0 || removed.length > 0) ? (
        <details className="mt-1">
          <summary className="min-h-8 cursor-pointer text-xs text-primary">{t('manage.audit.details')}</summary>
          <ul className="mt-1 space-y-0.5 ps-3">
            {added.map((value) => <li key={`a-${value}`} className="text-xs text-positive"><span aria-hidden="true">+ </span><span className="text-text">{item(value)}</span></li>)}
            {removed.map((value) => <li key={`r-${value}`} className="text-xs text-negative"><span aria-hidden="true">− </span><span className="text-text">{item(value)}</span></li>)}
          </ul>
        </details>
      ) : null}
    </li>
  );
}

function EventCard({ event }: { event: AuditEvent }) {
  const t = useTranslations('stationOps');
  const locale = useLocale();
  const denied = event.outcome === 'denied';
  const actionLabel = KNOWN_ACTIONS.includes(event.action) ? t(`manage.audit.action.${event.action.replace('.', '_')}`) : event.action;
  const Icon = denied ? ShieldAlert : CheckCircle2;

  return (
    <li className={cn('rounded-[14px] border bg-surface p-4', denied ? 'border-negative/40' : 'border-border')}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <Icon aria-hidden="true" className={cn('mt-0.5 h-5 w-5 shrink-0', denied ? 'text-negative' : 'text-positive')} strokeWidth={1.8} />
          <div className="min-w-0">
            <p className="text-[15px] font-semibold leading-6 text-text">{actionLabel}</p>
            <p className="num text-xs text-muted">{formatDateTime(event.occurred_at, locale)}</p>
          </div>
        </div>
        <Badge tone={denied ? 'negative' : 'positive'}>{denied ? t('manage.audit.denied') : t('manage.audit.applied')}</Badge>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted">{t('manage.audit.actor')}</dt>
        <dd className="min-w-0 truncate text-text">{event.actor?.name ?? t('manage.audit.unknown')}</dd>
        <dt className="text-muted">{event.target?.kind === 'role' ? t('manage.audit.targetRole') : t('manage.audit.target')}</dt>
        <dd className="min-w-0 truncate text-text">{event.target ? (event.target.name ?? t('manage.audit.unknown')) : '—'}</dd>
      </dl>
      {event.changes.length > 0 ? (
        <div className="mt-3 border-t border-border pt-3">
          {denied ? <p className="mb-1 text-xs text-muted">{t('manage.audit.attempted')}</p> : null}
          <ul className="space-y-1">{event.changes.map((change) => <ChangeLine key={change.key} change={change} denied={denied} />)}</ul>
        </div>
      ) : null}
      {denied && event.denial_reason ? <p className="mt-2 break-words text-xs leading-5 text-negative">{event.denial_reason}</p> : null}
      {event.reason ? <p className="mt-2 break-words text-xs leading-5 text-muted">{t('manage.audit.reason', { reason: event.reason })}</p> : null}
    </li>
  );
}

export function AuditScreen() {
  const t = useTranslations('stationOps');
  const { can } = useStationOps();
  const [page, setPage] = useState(1);
  const [outcome, setOutcome] = useState<AuditOutcomeFilter>('all');
  const audit = useAuditPage(page, outcome);
  const allowed = can(STAFF_PERMISSION);

  const pick = (value: AuditOutcomeFilter) => { setOutcome(value); setPage(1); };

  return (
    <>
      <PageMasthead title={t('manage.audit.title')} subtitle={t('manage.audit.subtitle')} backHref={MANAGE_BASE} backLabel={t('manage.back')} />
      <ScreenBody>
        {!allowed ? <ErrorState error={new StationOpsError('forbidden', 403)} /> : (
          <>
            <div role="radiogroup" aria-label={t('manage.audit.filter')} className="grid grid-cols-3 gap-2">
              {(['all', 'applied', 'denied'] as const).map((value) => (
                <button key={value} type="button" role="radio" aria-checked={outcome === value} onClick={() => pick(value)} className={cn('min-h-12 rounded-lg border text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary', outcome === value ? 'border-primary bg-primary-soft text-primary' : 'border-[color:var(--fo-control)] text-text')}>
                  {t(`manage.audit.filterOption.${value}`)}
                </button>
              ))}
            </div>
            <p className="text-xs leading-5 text-muted">{t('manage.audit.readOnly')}</p>

            {audit.state.status === 'loading' ? <LoadingBlock rows={4} /> : null}
            {audit.state.status === 'error' ? <ErrorState error={audit.state.error} onRetry={audit.reload} /> : null}
            {audit.state.status === 'success' && audit.state.data.data.length === 0 ? <EmptyState title={t('manage.audit.empty')} body={t('manage.audit.emptyBody')} /> : null}
            {audit.state.status === 'success' && audit.state.data.data.length > 0 ? (
              <>
                <ul className="space-y-3">{audit.state.data.data.map((event) => <EventCard key={event.id} event={event} />)}</ul>
                <nav aria-label={t('manage.audit.pagination')} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                  <SecondaryButton disabled={audit.state.data.meta.current_page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>{t('manage.audit.prev')}</SecondaryButton>
                  <span className="num px-2 text-sm text-muted">{t('manage.audit.pageOf', { page: audit.state.data.meta.current_page, last: audit.state.data.meta.last_page })}</span>
                  <SecondaryButton disabled={audit.state.data.meta.current_page >= audit.state.data.meta.last_page} onClick={() => setPage((value) => value + 1)}>{t('manage.audit.next')}</SecondaryButton>
                </nav>
              </>
            ) : null}
          </>
        )}
      </ScreenBody>
    </>
  );
}
