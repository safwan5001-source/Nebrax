'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ChevronRight, Settings } from 'lucide-react';
import { useCompany } from '@/lib/company';
import { useStationOps } from './context';
import { OPS_BASE, deriveOpsMode } from './nav';

/**
 * UI-0 (تصحيح بصري وفق مواصفة #1990) — الرأس الكحلي: `HomeMasthead` للرئيسية و`PageMasthead` للشاشات المتخصصة.
 * ليس لاصقاً (لا يستهلك مساحة الشاشة أثناء التمرير)، ويحمل هوية المنتج والمستأجر ومحطة العمل. اللغة والمظهر في «الإعدادات».
 */

/** هوية المستأجر من إعدادات أَوْج؛ بدونها شارة AWJ محايدة (لا شعار مستأجر آخر ولا اسم ثابت). */
function BrandMark() {
  const company = useCompany();
  if (company?.logo) {
    return <img src={company.logo} alt="" className="h-[39px] w-[39px] shrink-0 rounded-[11px] bg-[color:var(--fo-logo-bg)] object-contain p-0.5" />;
  }
  return (
    <span aria-hidden="true" className="grid h-[39px] w-[39px] shrink-0 place-items-center rounded-[11px] bg-[var(--fo-accent)] text-[13px] font-bold text-[color:var(--fo-navy)]">
      AWJ
    </span>
  );
}

export function StationSelect({ compact = false }: { compact?: boolean }) {
  const t = useTranslations('stationOps');
  const { stations, selectedStation, selectStation } = useStationOps();

  if (stations.status === 'loading') {
    return <div className="h-11 animate-pulse rounded-[11px] bg-[color:var(--fo-navy2)]" aria-hidden="true" />;
  }
  if (stations.status !== 'success' || !selectedStation) return null;

  const list = stations.data;
  const inactive = selectedStation.status !== 'active';
  const field = 'h-11 min-w-0 flex-1 rounded-[11px] border border-[color:var(--fo-outline)] bg-[color:var(--fo-navy2)] px-3 text-base text-[color:var(--fo-on-navy)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--fo-on-navy)]';

  return (
    <div className={compact ? 'flex min-w-0 flex-1 items-center gap-2' : 'flex items-center gap-2'}>
      <label htmlFor="fo-station" className="sr-only">{t('stationLabel')}</label>
      {list.length > 1 ? (
        <select id="fo-station" value={selectedStation.id} onChange={(event) => selectStation(event.target.value)} className={field}>
          {list.map((station) => (
            <option key={station.id} value={station.id}>
              {station.name}{station.status !== 'active' ? ` · ${t('stationInactive')}` : ''}
            </option>
          ))}
        </select>
      ) : (
        <div id="fo-station" className={`${field} flex items-center`}>
          <span className="truncate">{selectedStation.name}</span>
        </div>
      )}
      {inactive ? <span className="shrink-0 rounded-md bg-[color:var(--fo-cta-bg)] px-2 py-1 text-xs font-semibold text-[color:var(--fo-cta-fg)]">{t('stationInactive')}</span> : null}
    </div>
  );
}

function greetingKey(hour: number): 'morning' | 'afternoon' | 'evening' {
  if (hour < 12) return 'morning';
  return hour < 18 ? 'afternoon' : 'evening';
}

const MASTHEAD = 'bg-[var(--fo-navy)] text-[color:var(--fo-on-navy)] [padding-top:max(1.25rem,env(safe-area-inset-top))]';

export function HomeMasthead() {
  const t = useTranslations('stationOps');
  const company = useCompany();
  const { viewer, can } = useStationOps();
  const mode = deriveOpsMode(can);

  return (
    <header className={`${MASTHEAD} px-5 pb-9`}>
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <BrandMark />
            <div className="min-w-0">
              <p className="truncate text-base font-bold leading-5">{t('productName')}</p>
              <p className="truncate text-xs leading-5 text-[color:var(--fo-on-navy-muted)]">{company?.name ?? t('workspaceName')}</p>
            </div>
          </div>
          <Link
            href={`${OPS_BASE}/settings`}
            aria-label={t('navSettings')}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-[11px] border border-[color:var(--fo-outline)] text-[color:var(--fo-on-navy)] hover:bg-[color:var(--fo-header-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--fo-on-navy)]"
          >
            <Settings aria-hidden="true" className="h-5 w-5" strokeWidth={1.7} />
          </Link>
        </div>

        <div className="mt-6">
          <p className="text-xs text-[color:var(--fo-on-navy-muted)]">{t(`workspace.${mode}`)}</p>
          <h1 className="mt-1 text-[22px] font-semibold leading-8">{t(`greeting.${greetingKey(new Date().getHours())}`, { name: viewer.name })}</h1>
        </div>

        <div className="mt-4"><StationSelect /></div>
      </div>
    </header>
  );
}

/** `raised` = بطاقة تعلو حافته السفلية (مواصفة #1990 §1)؛ `backHref` الافتراضي الرئيسية، وشاشات التفاصيل تعيد إلى قائمتها. */
export function PageMasthead({ title, subtitle, raised = false, backHref = OPS_BASE, backLabel }: { title: string; subtitle?: string; raised?: boolean; backHref?: string; backLabel?: string }) {
  const t = useTranslations('stationOps');
  return (
    <header className={`${MASTHEAD} px-5 ${raised ? 'pb-9' : 'pb-6'}`}>
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center gap-3">
          <Link
            href={backHref}
            aria-label={backLabel ?? t('backHome')}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-[11px] border border-[color:var(--fo-outline)] text-[color:var(--fo-on-navy)] hover:bg-[color:var(--fo-header-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--fo-on-navy)]"
          >
            <ChevronRight aria-hidden="true" className="h-5 w-5 ltr:rotate-180" strokeWidth={1.8} />
          </Link>
          <StationSelect compact />
        </div>
        <h1 className="mt-5 text-xl font-semibold leading-7">{title}</h1>
        {subtitle ? <p className="mt-1 text-[13px] leading-5 text-[color:var(--fo-on-navy-muted)]">{subtitle}</p> : null}
      </div>
    </header>
  );
}

/** جسم الشاشة: يحجز مساحة التنقل السفلي والمنطقة الآمنة كي لا يغطي شيئاً آخر عنصر. */
/** `flush` = بلا حشوة علوية (الرئيسية: بطاقة الفترة ترتفع فوق الـmasthead). */
export function ScreenBody({ children, flush = false }: { children: React.ReactNode; flush?: boolean }) {
  return (
    <main
      id="fo-main"
      tabIndex={-1}
      className={`mx-auto w-full max-w-3xl space-y-5 px-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))] outline-none md:pb-10 ${flush ? '' : 'pt-5'}`}
    >
      {children}
    </main>
  );
}
