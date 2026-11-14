'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Lock, ShieldAlert } from 'lucide-react';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/nebrax';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { classifyError, hasPermission } from '../access';
import { FILLS_HREF } from '../fills/routes';
import { listOwners } from '../client';
import { listStations, type StationOption } from '../settings-client';
import { ForbiddenState, GateClosedState } from '../states';
import { usePermissions } from '../use-permissions';
import { getReport } from './client';
import { ClearingReportView } from './clearing-report-view';
import { ControlReportView } from './control-report-view';
import { FillsReportView } from './fills-report-view';
import { forbiddenReasonOf, isPeriodReversed, type ForbiddenReason, type ReportFilters, type ReportPayload } from './logic';
import { ReconciliationReportView } from './reconciliation-report-view';
import { ReportFiltersBar, type OwnerOption } from './report-filters';
import { ACCOUNTS_PERMISSION, COST_PERMISSION, REPORT_KEYS, REPORTS_PERMISSION, reportHref, type ReportKey } from './routes';

type Phase = 'loading' | 'ready' | 'gate_closed' | 'forbidden' | 'financial_forbidden' | 'error';

/**
 * TANKER-PR6B-6 (واجهات) — الشاشات الأربع لتقارير سندات التعبئة في وحدة أصحاب الصهاريج. **قراءة فقط** فوق `GET fuel-stations/tanker-fill-reports/{key}`؛ الخادم هو السلطة في الصلاحيات والنطاق،
 * والواجهة تعرض ما أعلنه: `meta.row_scope` و`scope.level` و`filters_applied` و`balance_filters_not_applicable` و`truncated` و`masking` و`clearing.available`.
 * 403 لتقرير الحساب الوسيط يُفسَّر بسببه (`details.reason`) **دون أي معلومة مالية**. أرصدة الأستاذ لا تُقدَّم أبداً على أنها خاصة بمحطة.
 */
export function ReportsScreen({ reportKey }: { reportKey: ReportKey }) {
  const t = useTranslations('fuelTankerReports');
  const permissions = usePermissions();
  const canView = hasPermission(permissions, REPORTS_PERMISSION);

  const [filters, setFilters] = useState<ReportFilters>({});
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [reason, setReason] = useState<ForbiddenReason | null>(null);
  const [stations, setStations] = useState<StationOption[]>([]);
  const [owners, setOwners] = useState<OwnerOption[]>([]);
  const sequence = useRef(0);
  const reversed = isPeriodReversed(filters.from, filters.to);

  const load = useCallback(async () => {
    const mine = ++sequence.current;
    setPhase('loading');
    try {
      const data = await getReport(reportKey, filters);
      if (mine !== sequence.current) return; // رد متأخر لطلب قديم لا يكتب فوق الأحدث.
      setReport(data);
      setPhase('ready');
    } catch (error) {
      if (mine !== sequence.current) return;
      const problem = classifyError(error, 'list');
      if (problem === 'gate_closed') setPhase('gate_closed');
      else if (problem === 'forbidden') {
        const why = forbiddenReasonOf(error instanceof ApiError ? error.body : null);
        setReason(why);
        // تقرير الحساب الوسيط ماليّ: رفضه شرحٌ مالي/نطاقي، لا «لا صلاحية للميزة» العامة.
        setPhase(reportKey === 'clearing-account' ? 'financial_forbidden' : 'forbidden');
      } else setPhase('error');
    }
  }, [reportKey, filters]);

  useEffect(() => { if (canView && !reversed) void load(); }, [canView, reversed, load]);
  useEffect(() => { if (canView) listStations().then(setStations).catch(() => setStations([])); }, [canView]);
  useEffect(() => {
    if (!canView) return;
    listOwners().then((page) => setOwners(page.rows.map((o) => ({ id: o.id, name: o.name })))).catch(() => setOwners([]));
  }, [canView]);

  const changeFilters = (patch: Partial<ReportFilters>) => setFilters((current) => ({ ...current, ...patch, page: 'page' in patch ? patch.page : 1 }));
  const clearFilters = () => setFilters({});
  const tabs = useMemo(() => REPORT_KEYS.map((key) => ({ key, href: reportHref(key) })), []);

  if (permissions === null) return <LoadingState variant="table" />;
  if (!canView || phase === 'forbidden') return <ForbiddenState required={REPORTS_PERMISSION} />;
  if (phase === 'gate_closed') return <GateClosedState />;

  return (
    <div className="space-y-4" data-fill-reports="" data-report={reportKey}>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t(`title.${reportKey}`)}
        description={t(`description.${reportKey}`)}
        actionsSlot={<Button asChild variant="outline" className="max-md:min-h-11"><Link href={FILLS_HREF}>{t('backToFills')}</Link></Button>}
      />

      <nav aria-label={t('switcher')} className="-mx-1 overflow-x-auto px-1" data-report-switcher="">
        <ul className="flex min-w-max gap-1.5">
          {tabs.map((tab) => (
            <li key={tab.key}>
              <Link
                href={tab.href}
                aria-current={tab.key === reportKey ? 'page' : undefined}
                data-report-link={tab.key}
                className={`inline-flex min-h-11 items-center whitespace-nowrap rounded-md border px-3 text-sm font-medium ${tab.key === reportKey ? 'border-primary bg-primary-soft text-primary' : 'border-border text-text hover:bg-primary-soft'}`}
              >
                {t(`tab.${tab.key}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {phase === 'financial_forbidden' ? <FinancialForbidden reason={reason} /> : (
        <>
          <ReportFiltersBar reportKey={reportKey} filters={filters} stations={stations} owners={owners} onChange={changeFilters} onClear={clearFilters} />
          {phase === 'loading' && report === null ? <LoadingState variant="table" label={t('loading')} /> : null}
          {phase === 'error' ? <ErrorState message={t('loadFailed')} onRetry={() => void load()} /> : null}
          {phase !== 'error' && report !== null && report.key === reportKey ? (
            <div aria-busy={phase === 'loading'} className={phase === 'loading' ? 'opacity-60' : undefined}>
              <Body report={report} busy={phase === 'loading'} onPage={(page) => changeFilters({ page })} />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function Body({ report, busy, onPage }: { report: ReportPayload; busy: boolean; onPage: (page: number) => void }) {
  switch (report.key) {
    case 'fills': return <FillsReportView data={report.data} meta={report.meta} busy={busy} onPage={onPage} />;
    case 'inventory-reconciliation': return <ReconciliationReportView data={report.data} meta={report.meta} />;
    case 'clearing-account': return <ClearingReportView data={report.data} meta={report.meta} />;
    case 'accounting-control': return <ControlReportView data={report.data} meta={report.meta} />;
  }
}

/**
 * رفض 403 لتقرير الحساب الوسيط: يُشرح السبب (نطاق محطات/مخازن أو نقص الصلاحيتين المالية) **بلا أي رصيد أو قيد أو مبلغ**، ويُذكر المفتاحان المطلوبان مستقلَّين.
 * سبب غير معروف ⇒ رسالة عامة تشمل الشرطين (لا تسريب ولا تخمين).
 */
function FinancialForbidden({ reason }: { reason: ForbiddenReason | null }) {
  const t = useTranslations('fuelTankerReports');
  const stationScope = reason === 'station_scope_restricted';
  return (
    <div data-financial-forbidden={reason ?? 'unknown'}>
    <EmptyState
      icon={stationScope ? ShieldAlert : Lock}
      titleAs="h2"
      title={t(`forbidden.${reason ?? 'unknown'}.title`)}
      description={t(`forbidden.${reason ?? 'unknown'}.body`)}
      action={reason === 'station_scope_restricted' ? undefined : (
        <ul className="flex flex-wrap justify-center gap-2" data-required-permissions="">
          <li><code dir="ltr" className="rounded bg-primary-soft px-2 py-1 text-xs text-text">{COST_PERMISSION}</code></li>
          <li><code dir="ltr" className="rounded bg-primary-soft px-2 py-1 text-xs text-text">{ACCOUNTS_PERMISSION}</code></li>
        </ul>
      )}
    />
    </div>
  );
}
