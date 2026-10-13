'use client';

import Link from 'next/link';
import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import { GlobalApplicationControlsCard } from '@/components/platform/global-application-controls-card';
import { DataTable } from '@/components/data-table';
import { Pagination } from '@/components/nebrax/pagination';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import type { MobileRecord } from '@/components/nebrax/mobile-record';
import { Select } from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import { isPlatformAuthenticated } from '@/lib/platform-auth';
import { platformApi } from '@/lib/platform-api';

/** ترتيب أعمدة CSV السابق حرفياً؛ ترتيب العرض تغيّر (الخطة والحالة أولاً) ولا يجوز أن يغيّر الملف المُصدَّر. */
const CSV_COLUMN_ORDER = [
  'name',
  'account_number',
  'support_number',
  'contactName',
  'contactEmail',
  'contactPhone',
  'plan',
  'is_active',
  'trial_ends_at',
  'users_count',
];

const PLAN_OPTIONS = ['free', 'basic', 'pro', 'enterprise'] as const;

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  account_number: number | null;
  support_number: number | null;
  plan: string;
  is_active: boolean;
  trial_ends_at: string | null;
  users_count: number;
  contact: { name: string; email: string; phone: string | null } | null;
}

interface TenantsResponse {
  data: TenantRow[];
  pagination: { current_page: number; last_page: number; per_page: number; total: number };
}

export default function PlatformTenantsPage() {
  const t = useTranslations('platformTenants');
  const router = useRouter();
  const [rows, setRows] = useState<TenantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [planFilter, setPlanFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [total, setTotal] = useState(0);
  const [lastPage, setLastPage] = useState(1);
  const overshootCorrected = useRef(false);
  const seenSearch = useRef(search);
  const requestSeq = useRef(0);
  const desired = useRef({ page: 1, perPage: 25, search: '' });

  const load = useCallback(async () => {
    const requested = { page, perPage, search: search.trim() };
    const matchesDesired = () =>
      desired.current.page === requested.page
      && desired.current.perPage === requested.perPage
      && desired.current.search.trim() === requested.search;
    if (!matchesDesired()) return;

    const requestId = ++requestSeq.current;
    const stillCurrent = () => requestId === requestSeq.current && matchesDesired();
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        per_page: String(requested.perPage),
        page: String(requested.page),
      });
      if (requested.search !== '') params.set('search', requested.search);
      const response = await platformApi<TenantsResponse>(`/platform/tenants?${params.toString()}`);
      if (!stillCurrent()) return;
      const meta = response.pagination;
      const boundedLast = Math.max(1, meta?.last_page ?? 1);
      if ((meta?.current_page ?? requested.page) > boundedLast && requested.page !== boundedLast && !overshootCorrected.current) {
        overshootCorrected.current = true;
        desired.current = { ...desired.current, page: boundedLast };
        requestSeq.current += 1;
        setPage(boundedLast);
        return;
      }
      overshootCorrected.current = false;
      setRows(response.data ?? []);
      setTotal(typeof meta?.total === 'number' ? meta.total : (response.data?.length ?? 0));
      setLastPage(boundedLast);
    } catch (reason) {
      if (!stillCurrent()) return;
      setError(reason instanceof ApiError ? reason.message : t('loadFailed'));
    } finally {
      if (stillCurrent()) setLoading(false);
    }
  }, [page, perPage, search, t]);

  useEffect(() => {
    if (!isPlatformAuthenticated()) {
      router.replace('/platform/login');
      return;
    }
    const searchChanged = seenSearch.current !== search;
    seenSearch.current = search;
    const delay = searchChanged && search.trim() !== '' ? 250 : 0;
    const timer = window.setTimeout(() => {
      void load();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [load, router, search]);

  const changeSearch = (value: string) => {
    overshootCorrected.current = false;
    desired.current = { ...desired.current, page: 1, search: value };
    requestSeq.current += 1;
    setSearch(value);
    setPage(1);
  };

  const changePage = (next: number) => {
    overshootCorrected.current = false;
    desired.current = { ...desired.current, page: next };
    requestSeq.current += 1;
    setPage(next);
  };

  const changePerPage = (next: number) => {
    overshootCorrected.current = false;
    desired.current = { ...desired.current, page: 1, perPage: next };
    requestSeq.current += 1;
    setPerPage(next);
    setPage(1);
  };

  const columns = useMemo<ColumnDef<TenantRow, unknown>[]>(
    () => [
      {
        accessorKey: 'name',
        header: t('name'),
        cell: ({ row }) => (
          <Link
            href={`/platform/tenants/${row.original.id}`}
            className="text-start font-medium text-primary hover:underline"
          >
            {row.original.name}
            <span className="ms-1.5 text-xs text-muted">({row.original.slug})</span>
          </Link>
        ),
      },
      // H1-4A: الحالة والخطة أولاً بعد الاسم حتى لا تُدفعا خارج الإطار عند التمرير داخل الجدول.
      {
        accessorKey: 'plan',
        header: t('plan'),
        cell: ({ row }) => <Badge tone="muted">{row.original.plan}</Badge>,
      },
      {
        accessorKey: 'is_active',
        header: t('status'),
        cell: ({ row }) => (
          <Badge tone={row.original.is_active ? 'positive' : 'negative'}>
            {row.original.is_active ? t('active') : t('inactive')}
          </Badge>
        ),
      },
      {
        accessorKey: 'account_number',
        header: t('accountNumber'),
        cell: ({ row }) => <span className="num text-text" dir="ltr">{row.original.account_number ?? '—'}</span>,
      },
      {
        accessorKey: 'support_number',
        header: t('supportNumber'),
        cell: ({ row }) => <span className="num text-text" dir="ltr">{row.original.support_number ?? '—'}</span>,
      },
      {
        id: 'contactName',
        accessorFn: (row) => row.contact?.name ?? '',
        header: t('contactName'),
        cell: ({ row }) => row.original.contact?.name ?? '—',
      },
      {
        id: 'contactEmail',
        accessorFn: (row) => row.contact?.email ?? '',
        header: t('contact'),
        cell: ({ row }) => <span className="num text-muted" dir="ltr">{row.original.contact?.email ?? '—'}</span>,
      },
      {
        id: 'contactPhone',
        accessorFn: (row) => row.contact?.phone ?? '',
        header: t('phone'),
        cell: ({ row }) => <span className="num text-muted" dir="ltr">{row.original.contact?.phone ?? '—'}</span>,
      },
      {
        accessorKey: 'trial_ends_at',
        header: t('trialEndsAt'),
        cell: ({ row }) => <span className="num text-muted" dir={row.original.trial_ends_at ? 'ltr' : undefined}>{row.original.trial_ends_at ?? t('noTrial')}</span>,
      },
      {
        accessorKey: 'users_count',
        header: t('usersCount'),
        cell: ({ row }) => <span className="num text-text">{row.original.users_count}</span>,
      },
    ],
    [t, router]
  );

  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        if (planFilter !== 'all' && row.plan !== planFilter) return false;
        if (statusFilter !== 'all' && String(row.is_active) !== statusFilter) return false;
        return true;
      }),
    [rows, planFilter, statusFilter]
  );

  const filtersActive = planFilter !== 'all' || statusFilter !== 'all';
  const clearFilters = () => {
    setPlanFilter('all');
    setStatusFilter('all');
  };

  // الترتيب المعتمد للجوال: الاسم والحالة، ثم رقم الحساب والخطة والمستخدمون، ثم بقية بيانات التواصل.
  // لا حقل محذوف؛ التفاصيل الطويلة تنزل إلى كتلة أخيرة بقيم LTR.
  const mobileRecord = useCallback(
    (row: TenantRow): MobileRecord => ({
      title: (
        <Link
          href={`/platform/tenants/${row.id}`}
          className="inline-flex min-h-11 max-w-full items-center whitespace-normal break-words font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span dir="auto">{row.name}</span>
        </Link>
      ),
      subtitle: (
        <span>
          {t('accountNumber')}: <span className="num" dir="ltr">{row.account_number ?? '—'}</span>
        </span>
      ),
      caption: <span dir="ltr">{row.slug}</span>,
      amountLabel: t('usersCount'),
      amount: row.users_count,
      status: (
        <>
          <Badge tone={row.is_active ? 'positive' : 'negative'}>{row.is_active ? t('active') : t('inactive')}</Badge>
          <Badge tone="muted">{row.plan}</Badge>
        </>
      ),
      meta: row.trial_ends_at ? `${t('trialEndsAt')}: ${row.trial_ends_at}` : t('noTrial'),
      actions: (
        <dl className="grid w-full grid-cols-1 gap-x-4 gap-y-1.5 text-xs min-[420px]:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-muted">{t('contactName')}</dt>
            <dd className="truncate text-text">{row.contact?.name ?? '—'}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted">{t('supportNumber')}</dt>
            <dd className="num text-text" dir="ltr">{row.support_number ?? '—'}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted">{t('contact')}</dt>
            <dd className="num break-all text-text" dir="ltr">{row.contact?.email ?? '—'}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted">{t('phone')}</dt>
            <dd className="num text-text" dir="ltr">{row.contact?.phone ?? '—'}</dd>
          </div>
        </dl>
      ),
    }),
    [t]
  );

  const clearFiltersButton = (
    <Button variant="outline" className="h-11" onClick={clearFilters}>
      {t('clearFilters')}
    </Button>
  );
  const emptyLabel =
    rows.length > 0 && filtersActive ? t('emptyFiltered') : search.trim() !== '' ? t('emptySearch') : t('empty');

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-primary" strokeWidth={1.7} aria-hidden="true" />
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
            <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
          </div>
        </div>
        <Button variant="outline" className="h-11 shrink-0 self-start" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} strokeWidth={1.7} aria-hidden="true" />
          {t('refresh')}
        </Button>
      </header>

      <GlobalApplicationControlsCard />

      <section aria-labelledby="platform-tenant-list" className="space-y-3">
        <h2 id="platform-tenant-list" className="text-sm font-semibold text-text">{t('listTitle')}</h2>

        {error ? (
          <Card>
            <CardContent className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-negative" role="alert">{error}</p>
              <Button variant="outline" className="h-11" onClick={() => void load()}>{t('retry')}</Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <div role="group" aria-label={t('filtersLabel')} className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <Select
                value={planFilter}
                onChange={(e) => setPlanFilter(e.target.value)}
                aria-label={t('filterByPlan')}
                className="h-11 sm:w-44"
              >
                <option value="all">{t('allPlans')}</option>
                {PLAN_OPTIONS.map((plan) => (
                  <option key={plan} value={plan}>{plan}</option>
                ))}
              </Select>
              <Select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                aria-label={t('filterByStatus')}
                className="h-11 sm:w-44"
              >
                <option value="all">{t('allStatuses')}</option>
                <option value="true">{t('active')}</option>
                <option value="false">{t('inactive')}</option>
              </Select>
              {filtersActive ? clearFiltersButton : null}
            </div>
            <div className="space-y-1 text-xs leading-relaxed text-muted">
              <p>{t('pageFilterNote')}</p>
              <p>{t('csvNote')}</p>
              {filtersActive ? <p className="text-text">{t('localFilterWarning')}</p> : null}
              <p aria-live="polite">
                {loading ? '' : t('listSummary', { shown: filteredRows.length, loaded: rows.length, total })}
              </p>
            </div>
            <DataTable
              columns={columns}
              data={filteredRows}
              loading={loading}
              searchPlaceholder={t('search')}
              searchLabel={t('search')}
              exportLabel={t('exportLabel')}
              exportColumnOrder={CSV_COLUMN_ORDER}
              searchValue={search}
              onSearchChange={changeSearch}
              emptyLabel={emptyLabel}
              emptyDescription={rows.length > 0 && filtersActive ? t('emptyFilteredHint') : undefined}
              emptyAction={rows.length > 0 && filtersActive ? clearFiltersButton : undefined}
              mobileRecord={mobileRecord}
              exportName="tenants"
            />
            <Pagination
              page={page}
              lastPage={lastPage}
              perPage={perPage}
              total={total}
              onPageChange={changePage}
              onPerPageChange={changePerPage}
              disabled={loading}
            />
          </>
        )}
      </section>
    </main>
  );
}
