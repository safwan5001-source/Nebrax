'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronLeft, ClipboardList, Search } from 'lucide-react';
import { EmptyState, ErrorState, LoadingState, MobileRecordItem, PageHeader, Pagination } from '@/components/nebrax';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { formatDateTime } from '@/lib/formatting';
import { classifyError, hasPermission } from '../access';
import { listStations, type StationOption } from '../settings-client';
import { ForbiddenState, GateClosedState } from '../states';
import { usePermissions } from '../use-permissions';
import { INVENTORY_REVIEW_HREF } from '../inventory/routes';
import { listFills } from './client';
import { litersOf, TABS, type FillRow, type Tab, type TabCounts, type WorkspacePage } from './logic';
import { AttemptChip, BlockerBadges, InventoryStatusBadge, ReadinessBadge, VoidedBadge } from './parts';
import { FILLS_PERMISSION, fillHref } from './routes';

type Phase = 'loading' | 'ready' | 'gate_closed' | 'forbidden' | 'error';

const SEARCH_DEBOUNCE_MS = 300;
const NO_COUNTS: TabCounts = { pending: 0, posted: 0, reversed: 0, attention: 0 };

/**
 * TANKER-PR6B-5 — سندات التعبئة: الدمج المخزني. أربعة تبويبات (بانتظار الترحيل · مرحّلة · معكوسة · تحتاج انتباهاً) بأعدادها من الخادم، وتصفية بالمحطة وبحث برقم السند الإلكتروني أو الورقي.
 * **حالة السند (`inventory_status`) ونتيجة آخر محاولة منفصلتان**: شارة الحالة ثم شارة «آخر محاولة» المستقلة. كل الإجراءات في صفحة التفاصيل (لا إجراء مالي من القائمة).
 * جوال أولاً: بطاقات تحت `md` وجدول من `md`. الخادم هو السلطة؛ 404 على القائمة ⇒ الميزة غير مفعّلة لهذا الحساب.
 */
export function FillsScreen() {
  const t = useTranslations('fuelTankerFills');
  const locale = useLocale();
  const permissions = usePermissions();
  const canView = hasPermission(permissions, FILLS_PERMISSION);

  const [tab, setTab] = useState<Tab>('pending');
  const [stationId, setStationId] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<WorkspacePage | null>(null);
  const [counts, setCounts] = useState<TabCounts>(NO_COUNTS);
  const [stations, setStations] = useState<StationOption[]>([]);
  const [phase, setPhase] = useState<Phase>('loading');
  const sequence = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => { setQuery(search); setPage(1); }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    const mine = ++sequence.current;
    setPhase('loading');
    try {
      const data = await listFills({ tab, stationId, q: query, page });
      if (mine !== sequence.current) return; // رد متأخر لطلب قديم لا يكتب فوق الأحدث.
      setResult(data);
      setCounts(data.counts);
      setPhase('ready');
    } catch (error) {
      if (mine !== sequence.current) return;
      const problem = classifyError(error, 'list');
      setPhase(problem === 'gate_closed' ? 'gate_closed' : problem === 'forbidden' ? 'forbidden' : 'error');
    }
  }, [tab, stationId, query, page]);

  useEffect(() => { if (canView) void load(); }, [canView, load]);
  useEffect(() => { if (canView) listStations().then(setStations).catch(() => setStations([])); }, [canView]);

  const stationNames = useMemo(() => new Map(stations.map((station) => [station.id, station.name])), [stations]);

  if (permissions === null) return <LoadingState variant="table" />;
  if (!canView || phase === 'forbidden') return <ForbiddenState required={FILLS_PERMISSION} />;
  if (phase === 'gate_closed') return <GateClosedState />;

  const rows = result?.rows ?? [];
  const filtered = query.trim() !== '' || stationId !== '';
  const changeTab = (id: string) => { setTab(id as Tab); setPage(1); };
  const clearFilters = () => { setSearch(''); setQuery(''); setStationId(''); setPage(1); };

  return (
    <div className="space-y-4" data-fills-workspace="">
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('subtitle')}
        actionsSlot={<Button asChild variant="outline" className="max-md:min-h-11"><Link href={INVENTORY_REVIEW_HREF}>{t('reviewLink')}</Link></Button>}
      />

      <Tabs
        tabs={TABS.map((id) => ({ id, label: t(`tabs.${id}`), count: counts[id] }))}
        value={tab}
        onChange={changeTab}
      />

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
          <Input
            type="search"
            className="ps-9 max-md:min-h-11"
            value={search}
            maxLength={64}
            placeholder={t('list.searchPlaceholder')}
            aria-label={t('list.searchLabel')}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <Select
          className="sm:w-56 max-md:min-h-11"
          value={stationId}
          aria-label={t('list.stationFilter')}
          onChange={(event) => { setStationId(event.target.value); setPage(1); }}
        >
          <option value="">{t('list.allStations')}</option>
          {stations.map((station) => <option key={station.id} value={station.id}>{station.name}{station.code ? ` (${station.code})` : ''}</option>)}
        </Select>
      </div>

      <TabPanel id={tab}>
        {phase === 'loading' && result === null ? <LoadingState variant="table" label={t('list.loading')} /> : null}
        {phase === 'error' ? <ErrorState message={t('list.loadFailed')} onRetry={() => void load()} /> : null}

        {phase !== 'error' && result !== null ? (
          rows.length === 0 && phase === 'ready' ? (
            filtered ? (
              <EmptyState icon={Search} title={t('list.noResults')} description={t('list.noResultsHint')}
                action={<Button variant="outline" className="max-md:min-h-11" onClick={clearFilters}>{t('list.clearFilters')}</Button>} />
            ) : (
              <EmptyState icon={ClipboardList} title={t(`list.empty.${tab}`)} description={t(`list.emptyHint.${tab}`)} />
            )
          ) : (
            <div aria-busy={phase === 'loading'} className={phase === 'loading' ? 'opacity-60' : undefined}>
              <div className="hidden overflow-x-auto rounded border border-border bg-surface md:block">
                <Table>
                  <THead>
                    <TR>
                      <TH>{t('field.number')}</TH>
                      <TH>{t('field.voucher')}</TH>
                      <TH>{t('field.ownerTanker')}</TH>
                      <TH>{t('field.quantity')}</TH>
                      <TH>{t('field.recordedAt')}</TH>
                      <TH>{t('field.inventoryStatus')}</TH>
                      <TH><span className="sr-only">{t('list.actions')}</span></TH>
                    </TR>
                  </THead>
                  <TBody>
                    {rows.map((row) => (
                      <TR key={row.id} data-fill-row="" data-inventory-status={row.inventory_status}>
                        <TD className="font-medium"><Link href={fillHref(row.id)} className="text-primary hover:underline"><bdi className="num" dir="ltr">{row.number}</bdi></Link></TD>
                        <TD><bdi className="num" dir="ltr">{row.voucher_number ?? '—'}</bdi></TD>
                        <TD>{row.owner ? <bdi>{row.owner.name}</bdi> : '—'}{row.tanker ? <span className="block text-xs text-muted"><bdi>{row.tanker.plate_number}</bdi></span> : null}</TD>
                        <TD><span className="num" dir="ltr">{row.quantity_liters ?? litersOf(row.quantity_milliliters)}</span> <span className="text-xs text-muted">{t('liters')}</span></TD>
                        <TD><span className="num">{row.recorded_at ? formatDateTime(row.recorded_at, locale) : '—'}</span></TD>
                        <TD><StatusCell row={row} /></TD>
                        <TD className="text-end"><Button asChild size="sm" variant="outline"><Link href={fillHref(row.id)}>{t('list.open')}</Link></Button></TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
              <ul className="divide-y divide-border rounded border border-border bg-surface md:hidden">
                {rows.map((row) => (
                  <li key={row.id} data-fill-row="" data-inventory-status={row.inventory_status}>
                    <Link href={fillHref(row.id)} className="block active:bg-primary-soft max-md:min-h-11">
                      <MobileRecordItem record={{
                        title: <bdi className="num" dir="ltr">{row.number}</bdi>,
                        subtitle: row.owner ? [row.owner.name, row.tanker?.plate_number].filter(Boolean).join(' · ') : undefined,
                        caption: t('list.voucherLine', { voucher: row.voucher_number ?? '—', station: row.fuel_station_id ? (stationNames.get(row.fuel_station_id) ?? '—') : '—' }),
                        amount: `${row.quantity_liters ?? litersOf(row.quantity_milliliters)} ${t('liters')}`,
                        status: <PrimaryBadges row={row} />,
                        meta: row.recorded_at ? formatDateTime(row.recorded_at, locale) : undefined,
                        actions: (
                          <span className="flex w-full items-center justify-between gap-2">
                            <AttemptChip attempt={row.inventory?.last_attempt ?? null} />
                            <span className="ms-auto flex shrink-0 items-center gap-1 text-xs text-primary">{t('list.open')}<ChevronLeft className="h-4 w-4 rotate-180 rtl:rotate-0" aria-hidden="true" /></span>
                          </span>
                        ),
                      }} />
                      {row.readiness && row.readiness.blockers.length > 0 ? <div className="px-3.5 pb-3"><BlockerBadges codes={row.readiness.blockers} /></div> : null}
                    </Link>
                  </li>
                ))}
              </ul>
              {result.lastPage > 1 ? (
                <Pagination page={result.page} lastPage={result.lastPage} perPage={result.perPage} total={result.total} disabled={phase === 'loading'} onPageChange={setPage} />
              ) : null}
            </div>
          )
        ) : null}
      </TabPanel>
    </div>
  );
}

/** شارات الحالة الأساسية (حالة السند + إلغاء + جاهزية للمعلّق). */
function PrimaryBadges({ row }: { row: FillRow }) {
  return (
    <>
      <InventoryStatusBadge status={row.inventory_status} />
      {row.status === 'voided' ? <VoidedBadge /> : null}
      {row.readiness ? <ReadinessBadge value={row.readiness.readiness} /> : null}
    </>
  );
}

/** خلية الحالة في الجدول: الحالة أولاً، ثم «آخر محاولة» وموانع الجاهزية في سطر مستقل. */
function StatusCell({ row }: { row: FillRow }) {
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5"><PrimaryBadges row={row} /></div>
      <AttemptChip attempt={row.inventory?.last_attempt ?? null} />
      {row.readiness ? <BlockerBadges codes={row.readiness.blockers} /> : null}
    </div>
  );
}
