'use client';

import { useTranslations } from 'next-intl';
import { History, ListChecks, Tag, Users, Hourglass } from 'lucide-react';
import { useStationOps } from '../context';
import { useShiftHistory } from '../data';
import { PageMasthead, ScreenBody } from '../masthead';
import { isStationSession } from '@/lib/auth';
import { MANAGE_PERMISSIONS, OPS_BASE, PRICES_HREF } from '../nav';
import type { Station } from '../schemas';
import { EmptyState } from '../state-views';
import { StationGate } from '../station-gate';
import { STAFF_PERMISSION, useStaffList } from './data';
import { Badge, LinkCard } from './ui';

export const MANAGE_BASE = `${OPS_BASE}/manage`;

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 rounded-[12px] border border-border bg-background p-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="num mt-1 text-2xl font-semibold text-text">{value}</dd>
      {hint ? <p className="mt-0.5 text-[11px] leading-4 text-muted">{hint}</p> : null}
    </div>
  );
}

/** ملخص المحطة المختارة: الورديات المفتوحة، المغلقة بانتظار الاعتماد، وعدد الموظفين المسنَدين — كل رقم من مصدره وتحت صلاحيته. */
function StationSummary({ station }: { station: Station }) {
  const t = useTranslations('stationOps');
  const { can } = useStationOps();
  const open = useShiftHistory(station, 'open');
  const closed = useShiftHistory(station, 'closed');
  const staff = useStaffList();

  const count = (state: typeof open.state): { value: string; hint?: string } => {
    if (state.status === 'loading') return { value: '…' };
    if (state.status === 'error') return { value: '—', hint: t('manage.summary.unavailable') };
    const n = state.data.shifts.length;
    return { value: String(n), hint: state.data.hasMore ? t('manage.summary.moreThan', { count: n }) : undefined };
  };
  const o = count(open.state);
  const c = count(closed.state);
  const assigned = staff.state.status === 'success' ? staff.state.data.filter((row) => row.station_ids.includes(station.id)) : null;
  const statusLabel = ['active', 'inactive', 'maintenance'].includes(station.status) ? t(`assetStatus.${station.status}`) : station.status;

  return (
    <section aria-labelledby="mg-summary-h" className="space-y-3 rounded-[14px] border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="mg-summary-h" className="text-base font-semibold text-text">{t('manage.summary.title')}</h2>
          <p className="mt-0.5 truncate text-sm text-muted">{station.name}</p>
        </div>
        <Badge tone={station.status === 'active' ? 'positive' : 'warning'}>{statusLabel}</Badge>
      </div>
      <dl className="grid grid-cols-2 gap-2.5">
        {can('fuel.shift.view') ? <Stat label={t('manage.summary.openShifts')} value={o.value} hint={o.hint} /> : null}
        {can('fuel.shift.view') ? <Stat label={t('manage.summary.closedShifts')} value={c.value} hint={c.hint ?? t('manage.summary.closedHint')} /> : null}
        {can(STAFF_PERMISSION) ? <Stat label={t('manage.summary.staff')} value={assigned ? String(assigned.length) : staff.state.status === 'loading' ? '…' : '—'} hint={t('manage.summary.staffHint')} /> : null}
      </dl>
    </section>
  );
}

export function ManageScreen() {
  const t = useTranslations('stationOps');
  const { can } = useStationOps();
  const canStaff = can(STAFF_PERMISSION);
  // جلسة PIN لا تصل إلى شاشة الأسعار القائمة (واجهة أَوْج الإدارية): لا يُعرض رابط ميت.
  const canPrices = can('fuel.sale.price.manage') && !isStationSession();
  const canPolicy = can('fuel.governance.manage'); // سياسة القراءات المتأخرة (B6): الاطلاع/التعديل بحسب الصلاحيات، والخادم السلطة
  const any = MANAGE_PERMISSIONS.some((permission) => can(permission));

  return (
    <>
      <PageMasthead title={t('manage.title')} subtitle={t('manage.subtitle')} />
      <ScreenBody>
        {!any ? (
          <EmptyState title={t('manage.noAccess.title')} body={t('manage.noAccess.body')} />
        ) : (
          <>
            <StationGate>{(station) => <StationSummary station={station} />}</StationGate>

            <nav aria-label={t('manage.sectionsLabel')} className="space-y-3">
              {canStaff ? (
                <>
                  <LinkCard href={`${MANAGE_BASE}/staff`} icon={<Users className="h-5 w-5" strokeWidth={1.8} />} title={t('manage.staff.title')} hint={t('manage.staff.hint')} />
                  <LinkCard href={`${MANAGE_BASE}/permissions`} icon={<ListChecks className="h-5 w-5" strokeWidth={1.8} />} title={t('manage.permissions.title')} hint={t('manage.permissions.hint')} />
                  <LinkCard href={`${MANAGE_BASE}/audit`} icon={<History className="h-5 w-5" strokeWidth={1.8} />} title={t('manage.audit.title')} hint={t('manage.audit.hint')} />
                </>
              ) : null}
              {canPolicy ? (
                <LinkCard href={`${MANAGE_BASE}/reading-policy`} icon={<Hourglass className="h-5 w-5" strokeWidth={1.8} />} title={t('manage.readingPolicy.title')} hint={t('manage.readingPolicy.hint')} />
              ) : null}
              {canPrices ? (
                <LinkCard href={PRICES_HREF} icon={<Tag className="h-5 w-5" strokeWidth={1.8} />} title={t('manage.prices.title')} hint={t('manage.prices.hint')} />
              ) : null}
            </nav>
          </>
        )}
      </ScreenBody>
    </>
  );
}
