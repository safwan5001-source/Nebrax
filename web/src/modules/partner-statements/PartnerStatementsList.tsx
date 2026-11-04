'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Filter, Info, Upload, X } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { EmptyState, ErrorState, PageHeader, Pagination, type PageAction } from '@/components/nebrax';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useCan } from '@/lib/use-can';
import { cn } from '@/lib/utils';
import { fetchBranches, fetchReconciliation, fetchReconciliations, type BranchOption } from './client';
import { usePartnerStatementsCapability } from './capability';
import { buildColumns, mobileRecordFor, periodLabel, StatusBadge } from './columns';
import { ROLES, STATUSES, formatMinor, partnerDisplayName, type PageMeta, type ReconciliationRow } from './contract';
import { describeError } from './errors';
import {
  EMPTY_FILTERS,
  PER_PAGE_OPTIONS,
  SORT_COLUMNS,
  activeFilterCount,
  hasPeriodInversion,
  parseListQuery,
  serializeListQuery,
  type ListFilters,
} from './list-query';
import { PartnerPicker } from './PartnerPicker';

const SEARCH_DEBOUNCE_MS = 350;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** قائمة مقارنات كشوف الأطراف المرئية للمستخدم (N1). التصفية/الفرز/الترقيم/العدّاد كلها من الخادم؛ الحالات: تحميل · فراغ · خطأ · موقوفة · معطّلة · بلا صلاحية. */
export function PartnerStatementsList() {
  const t = useTranslations('partnerStatements');
  const { can, hydrated } = useCan();
  const capability = usePartnerStatementsCapability();

  const [filters, setFilters] = useState<ListFilters>(EMPTY_FILTERS);
  const [ready, setReady] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [rows, setRows] = useState<ReconciliationRow[]>([]);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<ReconciliationRow | null | 'unavailable'>(null);
  const requestSeq = useRef(0);

  // الحالة الابتدائية من الرابط مرة واحدة بعد التركيب (لا قراءة نافذة أثناء العرض الخادمي).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const parsed = parseListQuery(params);
    setFilters(parsed);
    setSearchText(parsed.q);
    const id = params.get('highlight');
    setHighlight(id && UUID.test(id) ? id.toLowerCase() : null);
    setReady(true);
  }, []);

  // الرابط يعكس الفلاتر (قابل للمشاركة/التحديث) دون إضافة مدخلات سجل التصفح.
  useEffect(() => {
    if (!ready) return;
    const url = new URL(window.location.href);
    const next = serializeListQuery(filters);
    const params = new URLSearchParams(next);
    if (highlight) params.set('highlight', highlight);
    url.search = params.toString();
    window.history.replaceState(null, '', url.toString());
  }, [filters, highlight, ready]);

  // البحث بتأخير: يعيد الصفحة إلى الأولى.
  useEffect(() => {
    if (!ready || searchText === filters.q) return;
    const timer = setTimeout(() => setFilters((current) => ({ ...current, q: searchText, page: 1 })), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchText, filters.q, ready]);

  useEffect(() => {
    if (!ready || !capability.canView) return;
    let live = true;
    fetchBranches().then((list) => live && setBranches(list)).catch(() => {});
    return () => {
      live = false;
    };
  }, [ready, capability.canView]);

  const inversion = hasPeriodInversion(filters);

  const load = useCallback(() => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    fetchReconciliations(filters)
      .then((page) => {
        if (seq !== requestSeq.current) return;
        setRows(page.data);
        setMeta(page.meta);
      })
      .catch((err: unknown) => {
        if (seq !== requestSeq.current) return;
        capability.observe(err);
        setRows([]);
        setMeta(null);
        setError(describeError(err).key);
      })
      .finally(() => {
        if (seq === requestSeq.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  useEffect(() => {
    if (!ready || !capability.canView || capability.state === 'disabled' || inversion) return;
    load();
  }, [ready, capability.canView, capability.state, inversion, load]);

  // المقارنة المستوردة حديثاً (N2): رأس واحد بنفس رفض الخادم الموحّد؛ فشله لا يكشف سبباً.
  useEffect(() => {
    if (!highlight || !capability.canView || capability.state === 'disabled') return;
    let live = true;
    fetchReconciliation(highlight)
      .then((row) => live && setHighlighted(row))
      .catch(() => live && setHighlighted('unavailable'));
    return () => {
      live = false;
    };
  }, [highlight, capability.canView, capability.state]);

  const columns = useMemo(() => buildColumns(t as never), [t]);

  const update = (patch: Partial<ListFilters>) => setFilters((current) => ({ ...current, ...patch, page: patch.page ?? 1 }));
  const toggleStatus = (status: ListFilters['status'][number]) =>
    update({ status: filters.status.includes(status) ? filters.status.filter((value) => value !== status) : [...filters.status, status] });
  const clearFilters = () => {
    setSearchText('');
    setFilters({ ...EMPTY_FILTERS, sort: filters.sort, perPage: filters.perPage });
  };

  const activeCount = activeFilterCount(filters);
  const actions: PageAction[] = capability.canImport
    ? [{ key: 'import', label: t('import_action'), icon: Upload, href: '/partner-statements/import', variant: 'primary' }]
    : [];

  const header = <PageHeader title={t('title')} description={t('subtitle')} actions={actions} />;

  if (ready && hydrated && !can('partner_statements.view')) {
    return (
      <div className="space-y-4">
        {header}
        <EmptyState titleAs="h2" title={t('state.forbidden_title')} description={t('state.forbidden_hint')} />
      </div>
    );
  }

  if (capability.state === 'disabled') {
    return (
      <div className="space-y-4">
        {header}
        <EmptyState
          titleAs="h2"
          title={t('state.disabled_title')}
          description={t('state.disabled_hint')}
          action={can('apps.view') ? <Button asChild variant="outline"><Link href="/applications">{t('state.open_applications')}</Link></Button> : undefined}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {header}

      {capability.state === 'suspended' ? (
        <div role="status" className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm text-warning">
          <Info className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.7} />
          <span className="leading-relaxed">{t('state.suspended_hint')}</span>
        </div>
      ) : null}

      {highlight && highlighted ? (
        <div className="rounded-md border border-primary/30 bg-primary-soft p-3 text-sm" role="status" data-testid="imported-banner">
          {highlighted === 'unavailable' ? (
            <p className="text-text">{t('highlight.unavailable')}</p>
          ) : (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-medium text-text">{t('highlight.title')}</span>
              <span className="text-text">{partnerDisplayName(highlighted)}</span>
              <span className="num text-muted" dir="ltr">{periodLabel(highlighted)}</span>
              <StatusBadge status={highlighted.status} t={t as never} />
              <span className="num text-muted" dir="ltr">{formatMinor(highlighted.total_debit_minor)} / {formatMinor(highlighted.total_credit_minor)}</span>
              <button type="button" className="ms-auto text-muted hover:text-text" aria-label={t('highlight.dismiss')} onClick={() => { setHighlight(null); setHighlighted(null); }}>
                <X className="h-4 w-4" strokeWidth={1.7} />
              </button>
            </div>
          )}
        </div>
      ) : null}

      <section aria-label={t('filters.title')} className="space-y-3 rounded-md border border-border bg-surface p-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1 basis-56 space-y-1.5">
            <Label htmlFor="ps-search">{t('filters.search')}</Label>
            <Input
              id="ps-search"
              type="search"
              value={searchText}
              maxLength={100}
              placeholder={t('filters.search_placeholder')}
              onChange={(event) => setSearchText(event.target.value)}
            />
          </div>
          <Button type="button" variant="outline" className="md:hidden" aria-expanded={filtersOpen} aria-controls="ps-filter-panel" onClick={() => setFiltersOpen((open) => !open)}>
            <Filter className="h-4 w-4" strokeWidth={1.7} />
            {t('filters.toggle')}
            {activeCount > 0 ? <Badge tone="neutral"><span className="num">{activeCount}</span></Badge> : null}
          </Button>
          {activeCount > 0 ? (
            <Button type="button" variant="ghost" onClick={clearFilters}>{t('filters.clear')}</Button>
          ) : null}
        </div>

        <div id="ps-filter-panel" className={cn('grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4', filtersOpen ? 'grid' : 'hidden', 'md:grid')}>
          <fieldset className="space-y-1.5 sm:col-span-2 lg:col-span-4">
            <legend className="text-sm font-medium text-text">{t('filters.status')}</legend>
            <div className="flex flex-wrap gap-2">
              {STATUSES.map((status) => {
                const active = filters.status.includes(status);
                return (
                  <button
                    key={status}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleStatus(status)}
                    className={cn(
                      'min-h-[44px] rounded border px-3 text-sm transition-colors md:min-h-9',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                      active ? 'border-primary bg-primary-soft text-primary' : 'border-border text-text hover:bg-background',
                    )}
                  >
                    {t(`status.${status}`)}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor="ps-role">{t('filters.role')}</Label>
            <Select id="ps-role" value={filters.role} onChange={(event) => update({ role: event.target.value as ListFilters['role'], partnerId: '' })}>
              <option value="">{t('filters.all')}</option>
              {ROLES.map((role) => <option key={role} value={role}>{t(`role.${role}`)}</option>)}
            </Select>
          </div>

          <div className="sm:col-span-1">
            <PartnerPicker
              role={filters.role}
              value={filters.partnerId}
              label={t('filters.partner')}
              onChange={(id) => update({ partnerId: id })}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ps-from">{t('filters.period_from')}</Label>
            <Input id="ps-from" type="date" value={filters.periodFrom} max="9999-12-31" onChange={(event) => update({ periodFrom: event.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ps-to">{t('filters.period_to')}</Label>
            <Input id="ps-to" type="date" value={filters.periodTo} max="9999-12-31" onChange={(event) => update({ periodTo: event.target.value })} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ps-branch">{t('filters.branch')}</Label>
            <Select id="ps-branch" value={filters.branchId} onChange={(event) => update({ branchId: event.target.value })}>
              <option value="">{t('filters.all')}</option>
              {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </Select>
          </div>

          <div className="space-y-1.5 md:hidden">
            <Label htmlFor="ps-sort">{t('filters.sort')}</Label>
            <Select id="ps-sort" value={filters.sort} onChange={(event) => update({ sort: event.target.value })}>
              {SORT_COLUMNS.flatMap((column) => [
                <option key={column} value={column}>{t(`sort.${column}`)} ↑</option>,
                <option key={`-${column}`} value={`-${column}`}>{t(`sort.${column}`)} ↓</option>,
              ])}
            </Select>
          </div>
        </div>

        {inversion ? <p role="alert" className="text-sm text-negative">{t('filters.period_inverted')}</p> : null}
      </section>

      {error ? (
        <ErrorState message={t(`errors.${error}`)} onRetry={load} retryLabel={t('retry')} />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          loading={loading}
          emptyLabel={activeCount > 0 ? t('empty_filtered') : t('empty')}
          emptyDescription={activeCount > 0 ? undefined : t('empty_hint')}
          showToolbar={false}
          serverSort={{
            value: filters.sort,
            onChange: (value) => update({ sort: value }),
            columns: SORT_COLUMNS as unknown as string[],
          }}
          mobileRecord={(row) => mobileRecordFor(row, t as never)}
        />
      )}

      {meta && !error ? (
        <Pagination
          page={meta.current_page}
          lastPage={meta.last_page}
          perPage={meta.per_page}
          total={meta.total}
          perPageOptions={PER_PAGE_OPTIONS}
          disabled={loading}
          onPageChange={(page) => setFilters((current) => ({ ...current, page }))}
          onPerPageChange={(perPage) => update({ perPage })}
        />
      ) : null}

      <p className="text-xs leading-relaxed text-muted">{t('disclaimer')}</p>
    </div>
  );
}
