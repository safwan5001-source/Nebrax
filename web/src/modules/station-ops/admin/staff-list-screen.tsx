'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Search, UserPlus } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { useStationOps } from '../context';
import { PageMasthead, ScreenBody } from '../masthead';
import { EmptyState, ErrorState, LoadingBlock } from '../state-views';
import { PrimaryButton, SecondaryButton } from '../write-ui';
import { MANAGE_BASE } from './manage-screen';
import { STAFF_PERMISSION, useCandidates, useStaffList } from './data';
import type { StaffView } from './schemas';
import { Badge, Chip, LinkCard } from './ui';

const TEMPLATE_TONES: Record<string, 'info' | 'positive' | 'warning' | 'neutral'> = { seller: 'info', supervisor: 'positive', station_manager: 'warning' };

export function templateLabelKey(template: string): string {
  return ['seller', 'supervisor', 'station_manager', 'custom', 'none'].includes(template) ? `manage.template.${template}` : 'manage.template.custom';
}

export function StaffRow({ row, canEdit }: { row: StaffView; canEdit: boolean }) {
  const t = useTranslations('stationOps');
  const { stations } = useStationOps();
  const names = stations.status === 'success' ? new Map(stations.data.map((station) => [station.id, station.name])) : new Map<string, string>();
  const noStations = row.station_ids.length === 0;

  return (
    <li>
      <LinkCard
        href={`${MANAGE_BASE}/staff/${row.user.id}`}
        title={row.user.name}
        hint={canEdit ? undefined : t('manage.staff.selfNote')}
        trailing={<Badge tone={TEMPLATE_TONES[row.template] ?? 'neutral'}>{t(templateLabelKey(row.template))}</Badge>}
      />
      <div className="-mt-1 flex flex-wrap items-center gap-1.5 px-1.5 pb-3 pt-2">
        {!row.user.is_active ? <Badge tone="negative">{t('manage.staff.inactive')}</Badge> : null}
        <Badge tone="neutral">{t('manage.staff.permCount', { count: row.fuel_permissions.length })}</Badge>
        {noStations ? (
          <Badge tone="warning">{t('manage.staff.noStationsBadge')}</Badge>
        ) : (
          row.station_ids.slice(0, 3).map((id) => <Chip key={id}>{names.get(id) ?? t('manage.stations.other')}</Chip>)
        )}
        {row.station_ids.length > 3 ? <Chip>{`+${row.station_ids.length - 3}`}</Chip> : null}
      </div>
    </li>
  );
}

function AddEmployeeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('stationOps');
  const candidates = useCandidates(open);
  const [query, setQuery] = useState('');
  const rows = useMemo(() => {
    if (candidates.state.status !== 'success') return [];
    const needle = query.trim().toLowerCase();
    return candidates.state.data.filter((row) => needle === '' || row.name.toLowerCase().includes(needle) || (row.email ?? '').toLowerCase().includes(needle));
  }, [candidates.state, query]);

  return (
    <Dialog open={open} onClose={onClose} title={t('manage.staff.addTitle')} className="max-w-md">
      <p className="text-sm leading-6 text-muted">{t('manage.staff.addHint')}</p>
      <label htmlFor="mg-cand-q" className="sr-only">{t('manage.staff.search')}</label>
      <div className="relative mt-3">
        <Search aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" strokeWidth={1.8} />
        <input
          id="mg-cand-q"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('manage.staff.search')}
          className="h-12 w-full rounded-[11px] border border-[color:var(--fo-control)] bg-surface ps-9 pe-3 text-base text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
      </div>
      <div className="mt-3 max-h-[50vh] overflow-y-auto">
        {candidates.state.status === 'loading' ? <LoadingBlock rows={3} /> : null}
        {candidates.state.status === 'error' ? <ErrorState error={candidates.state.error} onRetry={candidates.reload} /> : null}
        {candidates.state.status === 'success' && rows.length === 0 ? <EmptyState title={t('manage.staff.noCandidates')} body={t('manage.staff.noCandidatesBody')} /> : null}
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.id}>
              <Link href={`${MANAGE_BASE}/staff/${row.id}`} onClick={onClose} className="flex min-h-[56px] items-center justify-between gap-3 rounded-[12px] border border-border px-3.5 py-2 hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-medium text-text">{row.name}</span>
                  {row.email ? <span dir="ltr" className="block truncate text-start text-xs text-muted">{row.email}</span> : null}
                </span>
                <span className="shrink-0 text-sm font-semibold text-primary">{t('manage.staff.manageAction')}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-4"><SecondaryButton onClick={onClose}>{t('manage.close')}</SecondaryButton></div>
    </Dialog>
  );
}

export function StaffListScreen() {
  const t = useTranslations('stationOps');
  const { viewer, can } = useStationOps();
  const list = useStaffList();
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const canManage = can(STAFF_PERMISSION);

  const rows = useMemo(() => {
    if (list.state.status !== 'success') return [];
    const needle = query.trim().toLowerCase();
    return list.state.data.filter((row) => needle === '' || row.user.name.toLowerCase().includes(needle));
  }, [list.state, query]);

  return (
    <>
      <PageMasthead title={t('manage.staff.title')} subtitle={t('manage.staff.subtitle')} backHref={MANAGE_BASE} backLabel={t('manage.back')} />
      <ScreenBody>
        {list.state.status === 'loading' ? <LoadingBlock rows={4} /> : null}
        {list.state.status === 'error' ? <ErrorState error={list.state.error} onRetry={list.reload} /> : null}

        {list.state.status === 'success' ? (
          <>
            {canManage ? <PrimaryButton onClick={() => setAdding(true)}><UserPlus aria-hidden="true" className="h-5 w-5" strokeWidth={1.9} />{t('manage.staff.add')}</PrimaryButton> : null}

            <p className="rounded-[12px] bg-[color:var(--fo-warning-tint)] p-3 text-sm leading-6 text-warning">{t('manage.stations.noAssignmentNote')}</p>

            {list.state.data.length > 6 ? (
              <div>
                <label htmlFor="mg-staff-q" className="sr-only">{t('manage.staff.search')}</label>
                <input id="mg-staff-q" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('manage.staff.search')} className="h-12 w-full rounded-[11px] border border-[color:var(--fo-control)] bg-surface px-3 text-base text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" />
              </div>
            ) : null}

            {list.state.data.length === 0 ? (
              <EmptyState title={t('manage.staff.empty')} body={t('manage.staff.emptyBody')} />
            ) : rows.length === 0 ? (
              <EmptyState title={t('manage.staff.noMatch')} />
            ) : (
              <ul className="space-y-1">
                {rows.map((row) => <StaffRow key={row.user.id} row={row} canEdit={canManage && row.user.id !== viewer.id} />)}
              </ul>
            )}
          </>
        ) : null}
      </ScreenBody>
      {canManage ? <AddEmployeeDialog open={adding} onClose={() => setAdding(false)} /> : null}
    </>
  );
}
