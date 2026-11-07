'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { LogOut, RefreshCw, ShieldCheck } from 'lucide-react';
import { STATION_LOGIN_PATH, isStationSession, logout } from '@/lib/auth';
import { useStationOps } from './context';
import { OPS_BASE, deriveOpsMode } from './nav';
import { PageMasthead, ScreenBody } from './masthead';
import { LoadingBlock } from './state-views';

/** الصلاحيات التي تعتمد عليها واجهة UI-0 فعلاً — عرض شفاف لما يُسمح به، لا لتعديله. */
const ACCESS_ROWS: ReadonlyArray<{ key: string; permission: string }> = [
  { key: 'stations', permission: 'fuel_stations.view' },
  { key: 'shifts', permission: 'fuel.shift.view' },
  { key: 'prices', permission: 'fuel.sale.view' },
  { key: 'open', permission: 'fuel.shift.open' },
  { key: 'approve', permission: 'fuel.shift.approve' },
];

function roleLabel(role: string, t: ReturnType<typeof useTranslations>): string {
  return ['owner', 'admin', 'accountant', 'cashier', 'viewer', 'employee'].includes(role) ? t(`roles.${role}`) : role;
}

export function ProfileScreen() {
  const t = useTranslations('stationOps');
  const router = useRouter();
  const { viewer, can, stations } = useStationOps();
  const [leaving, setLeaving] = useState(false);
  const mode = deriveOpsMode(can);
  const unrestricted = viewer.branch_ids !== undefined && viewer.branch_ids.length === 0;

  /** الخروج يُبطل التوكن في الخادم أولاً. جلسة PIN ترجع إلى شاشة دخول التطبيق؛ جلسة البريد ترجع إلى دخول أَوْج كما كانت. */
  async function signOut() {
    const station = isStationSession();
    setLeaving(true);
    await logout();
    router.replace(station ? STATION_LOGIN_PATH : '/login');
  }

  /** تبديل الموظف على جهاز مشترك: إنهاء الجلسة الحالية ثم شاشة الدخول للموظف التالي (لا يبقى شيء من الأول). */
  async function switchEmployee() {
    setLeaving(true);
    await logout();
    router.replace(STATION_LOGIN_PATH);
  }

  return (
    <>
      <PageMasthead title={t('profile.title')} subtitle={t('profile.subtitle')} />
      <ScreenBody>
      <section aria-labelledby="fo-id-h" className="space-y-3">
        <h2 id="fo-id-h" className="text-base font-semibold text-text">{t('profile.identity')}</h2>
        <dl className="divide-y divide-border rounded-[14px] border border-border bg-surface px-4 text-sm">
          <div className="flex justify-between gap-4 py-3"><dt className="text-muted">{t('profile.name')}</dt><dd className="min-w-0 break-words text-end text-text">{viewer.name}</dd></div>
          <div className="flex justify-between gap-4 py-3"><dt className="text-muted">{t('profile.email')}</dt><dd className="min-w-0 break-all text-end text-text" dir="ltr">{viewer.email}</dd></div>
          <div className="flex justify-between gap-4 py-3"><dt className="text-muted">{t('profile.role')}</dt><dd className="text-end text-text">{roleLabel(viewer.role, t)}</dd></div>
          <div className="flex justify-between gap-4 py-3"><dt className="text-muted">{t('profile.mode')}</dt><dd className="text-end text-text">{t(`mode.${mode}`)}</dd></div>
        </dl>
        <p className="flex items-start gap-2 text-sm text-muted">
          <ShieldCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.7} />
          {t('profile.fromAwj')}
        </p>
      </section>

      <section aria-labelledby="fo-scope-h" className="space-y-3">
        <h2 id="fo-scope-h" className="text-base font-semibold text-text">{t('profile.scope')}</h2>
        <div className="rounded-[14px] border border-border bg-surface p-4 text-sm">
          <p className="text-muted">{t('profile.branches')}</p>
          <p className="mt-0.5 text-text">
            {viewer.branch_ids === undefined ? t('profile.scopeUnknown') : unrestricted ? t('profile.allBranches') : t('profile.branchCount', { count: String(viewer.branch_ids.length) })}
          </p>
          <p className="mt-3 text-muted">{t('profile.stations')}</p>
          {stations.status === 'loading' ? (
            <div className="mt-2"><LoadingBlock rows={1} /></div>
          ) : stations.status === 'error' ? (
            <p className="mt-0.5 text-warning">{t('profile.stationsUnavailable')}</p>
          ) : stations.data.length === 0 ? (
            <p className="mt-0.5 text-text">{t('noStations.title')}</p>
          ) : (
            <ul className="mt-1 list-inside list-disc text-text">
              {stations.data.map((station) => <li key={station.id}>{station.name}</li>)}
            </ul>
          )}
        </div>
      </section>

      <section aria-labelledby="fo-access-h" className="space-y-3">
        <h2 id="fo-access-h" className="text-base font-semibold text-text">{t('profile.access')}</h2>
        <ul className="divide-y divide-border rounded-[14px] border border-border bg-surface px-4 text-sm">
          {ACCESS_ROWS.map((row) => (
            <li key={row.key} className="flex items-center justify-between gap-4 py-3">
              <span className="text-text">{t(`profile.accessRow.${row.key}`)}</span>
              <span className={can(row.permission) ? 'font-medium text-positive' : 'text-muted'}>
                {can(row.permission) ? t('profile.granted') : t('profile.notGranted')}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted">{t('profile.accessHint')}</p>
      </section>

      <section aria-labelledby="fo-sec-h" className="space-y-3">
        <h2 id="fo-sec-h" className="text-base font-semibold text-text">{t('profile.security')}</h2>
        <Link href={`${OPS_BASE}/settings`} className="flex min-h-12 items-center justify-between rounded-[14px] border border-border bg-surface px-4 text-base text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          {t('navSettings')}
        </Link>
        <button
          type="button"
          onClick={switchEmployee}
          disabled={leaving}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-[14px] border border-[color:var(--fo-control)] bg-surface px-4 text-base font-semibold text-text hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
        >
          <RefreshCw aria-hidden="true" className="h-5 w-5" strokeWidth={1.8} />
          {t('profile.switchEmployee')}
        </button>
        <p className="text-sm text-muted">{t('profile.switchEmployeeHint')}</p>
        <button
          type="button"
          onClick={signOut}
          disabled={leaving}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-[14px] border border-negative bg-surface px-4 text-base font-semibold text-negative hover:bg-[color:var(--fo-negative-tint)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-negative disabled:opacity-60"
        >
          <LogOut aria-hidden="true" className="h-5 w-5" strokeWidth={1.8} />
          {t('profile.logout')}
        </button>
      </section>
      </ScreenBody>
    </>
  );
}

