'use client';

import Link from 'next/link';
import * as React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { ArrowRight, RefreshCw, ShieldCheck } from 'lucide-react';
import { GlobalApplicationControlsCard } from '@/components/platform/global-application-controls-card';
import { DataTable } from '@/components/data-table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import { isPlatformAuthenticated } from '@/lib/platform-auth';
import { platformApi } from '@/lib/platform-api';

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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ per_page: '100' });
      if (search.trim() !== '') params.set('search', search.trim());
      const response = await platformApi<TenantsResponse>(`/platform/tenants?${params.toString()}`);
      setRows(response.data);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [search, t]);

  useEffect(() => {
    if (!isPlatformAuthenticated()) {
      router.replace('/platform/login');
      return;
    }
    const timer = window.setTimeout(() => load(), search.trim() === '' ? 0 : 250);
    return () => window.clearTimeout(timer);
  }, [load, router, search]);

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
        cell: ({ row }) => <span className="num text-muted">{row.original.contact?.email ?? '—'}</span>,
      },
      {
        id: 'contactPhone',
        accessorFn: (row) => row.contact?.phone ?? '',
        header: t('phone'),
        cell: ({ row }) => <span className="num text-muted">{row.original.contact?.phone ?? '—'}</span>,
      },
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
        accessorKey: 'trial_ends_at',
        header: t('trialEndsAt'),
        cell: ({ row }) => <span className="num text-muted">{row.original.trial_ends_at ?? t('noTrial')}</span>,
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

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-primary" strokeWidth={1.7} aria-hidden="true" />
            <div>
              <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
              <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm"><Link href='/platform'>
              <ArrowRight className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
              {t('back')}
            </Link></Button>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} strokeWidth={1.7} aria-hidden="true" />
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        {error ? (
          <Card>
            <CardContent className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-negative" role="alert">{error}</p>
              <Button variant="outline" onClick={load}>{t('retry')}</Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            <GlobalApplicationControlsCard />
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={planFilter}
                onChange={(e) => setPlanFilter(e.target.value)}
                aria-label={t('filterByPlan')}
                className="w-40"
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
                className="w-40"
              >
                <option value="all">{t('allStatuses')}</option>
                <option value="true">{t('active')}</option>
                <option value="false">{t('inactive')}</option>
              </Select>
            </div>
            <DataTable
              columns={columns}
              data={filteredRows}
              loading={loading}
              searchPlaceholder={t('search')}
              searchValue={search}
              onSearchChange={setSearch}
              emptyLabel={t('empty')}
              exportName="tenants"
            />
          </div>
        )}
      </div>
    </main>
  );
}
