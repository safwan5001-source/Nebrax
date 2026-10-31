'use client';

import { useCallback, useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { Pagination } from '@/components/nebrax';
import { TabPanel, Tabs, type TabDef } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/formatting';
import { useCan } from '@/lib/use-can';
import { useWholesaleChannel } from '../../channel-context';
import { MEMBERSHIP_STATUS_TONE, StatusBadge, toneFor } from '../../components/status-badge';
import { UnavailablePanel } from '../../components/unavailable-panel';
import { ResourceBoundary } from '../../components/resource-boundary';
import { useResource } from '../../use-resource';
import { MEMBERSHIP_STATUSES, fetchMembershipCounts, fetchMemberships, type Membership, type MembershipAction, type MembershipStatus } from './api';
import { DecisionDialog } from './decision-dialog';
import { MembershipSheet } from './membership-sheet';
import { buyersMessages } from './messages';

const PER_PAGE_OPTIONS = [25, 50];
type Filter = '' | MembershipStatus;

/** Buyers & Companies — membership applications of the active wholesale channel. Mounted only when readiness is `active`. */
export function BuyersSection() {
  const locale = useLocale();
  const { t, label } = buyersMessages.forLocale(locale);
  const { channelId } = useWholesaleChannel();
  const { can } = useCan();
  const canDecide = can('commerce.wholesale.manage');

  const [filter, setFilter] = useState<Filter>('pending');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [version, setVersion] = useState(0);
  const [selected, setSelected] = useState<Membership | null>(null);
  const [pending, setPending] = useState<{ membership: Membership; action: MembershipAction } | null>(null);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const counts = useResource(() => fetchMembershipCounts(channelId!), [channelId, version], { enabled: channelId !== null });
  const list = useResource(
    () => fetchMemberships(channelId!, { status: filter, page, perPage }),
    [channelId, filter, page, perPage, version],
    { enabled: channelId !== null },
  );

  const countOf = (status: MembershipStatus): number | undefined => (counts.state.status === 'ready' ? counts.state.data[status] : undefined);
  const tabs: TabDef[] = [
    { id: 'all', label: t('filter.all') },
    ...MEMBERSHIP_STATUSES.map((status) => ({ id: status, label: t(`status.${status}` as 'status.pending'), count: countOf(status) })),
  ];

  const columns = useMemo<ColumnDef<Membership, unknown>[]>(
    () => [
      {
        id: 'buyer',
        header: t('colBuyer'),
        enableSorting: false,
        accessorFn: (m) => m.customer.display_name ?? '',
        cell: ({ row }) => <bdi className="block max-w-64 truncate font-medium">{row.original.customer.display_name ?? t('unnamedBuyer')}</bdi>,
      },
      {
        id: 'contact',
        header: t('colContact'),
        enableSorting: false,
        accessorFn: (m) => m.customer.email ?? m.customer.phone ?? '',
        cell: ({ row }) => (
          <div className="min-w-0 text-xs">
            <span className="block truncate text-text" dir="ltr">{row.original.customer.email ?? '—'}</span>
            <span className="num block text-muted" dir="ltr">{row.original.customer.phone ?? '—'}</span>
          </div>
        ),
      },
      {
        id: 'status',
        header: t('colStatus'),
        enableSorting: false,
        accessorFn: (m) => m.status,
        cell: ({ row }) => <StatusBadge tone={toneFor(MEMBERSHIP_STATUS_TONE, row.original.status)}>{label('status', row.original.status)}</StatusBadge>,
      },
      {
        id: 'applied',
        header: t('colApplied'),
        enableSorting: false,
        accessorFn: (m) => m.applied_at ?? '',
        cell: ({ row }) => <span className="num text-muted">{formatDateTime(row.original.applied_at, locale)}</span>,
      },
      {
        id: 'decided',
        header: t('colDecided'),
        enableSorting: false,
        accessorFn: (m) => m.decided_at ?? '',
        cell: ({ row }) => <span className="num text-muted">{row.original.decided_at ? formatDateTime(row.original.decided_at, locale) : '—'}</span>,
      },
      {
        id: 'actions',
        header: t('colActions'),
        enableSorting: false,
        accessorFn: () => '',
        cell: ({ row }) => (
          <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-8" onClick={() => setSelected(row.original)}>
            {t('viewDetails')}
          </Button>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale],
  );

  const changeFilter = (id: string) => {
    setFilter(id === 'all' ? '' : (id as MembershipStatus));
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm leading-relaxed text-muted">{t('description')}</p>

      <section aria-label={t('filtersLabel')} className="rounded border border-border bg-surface">
        <Tabs tabs={tabs} value={filter === '' ? 'all' : filter} onChange={changeFilter} />
        <TabPanel id={filter === '' ? 'all' : filter}>
          <ResourceBoundary state={list.state} onRetry={list.reload}>
            {({ data, meta }) => (
              <div className="space-y-3 p-2">
                <DataTable<Membership>
                  columns={columns}
                  data={data}
                  showToolbar={false}
                  emptyLabel={filter ? t('emptyFilteredTitle') : t('emptyTitle')}
                  emptyDescription={filter ? t('emptyFilteredDescription') : t('emptyDescription')}
                  mobileRecord={(m) => ({
                    title: <bdi>{m.customer.display_name ?? t('unnamedBuyer')}</bdi>,
                    subtitle: <span dir="ltr">{m.customer.email ?? m.customer.phone ?? '—'}</span>,
                    status: <StatusBadge tone={toneFor(MEMBERSHIP_STATUS_TONE, m.status)}>{label('status', m.status)}</StatusBadge>,
                    meta: formatDateTime(m.applied_at, locale),
                    actions: (
                      <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => setSelected(m)}>
                        {t('viewDetails')}
                      </Button>
                    ),
                  })}
                />
                {meta.total > 0 ? (
                  <Pagination
                    page={meta.page}
                    lastPage={meta.last_page}
                    perPage={meta.per_page}
                    total={meta.total}
                    perPageOptions={PER_PAGE_OPTIONS}
                    onPageChange={setPage}
                    onPerPageChange={(value) => {
                      setPerPage(value);
                      setPage(1);
                    }}
                  />
                ) : null}
              </div>
            )}
          </ResourceBoundary>
        </TabPanel>
      </section>

      <UnavailablePanel title={t('linkTitle')} description={t('linkDescription')} blocker={t('linkBlocker')} reference={t('linkReference')} />

      <MembershipSheet
        // The decision dialog is a separate modal: the drawer steps aside while it is open (two stacked modals would
        // fight over focus) and returns on cancel, because `selected` is kept until the decision is applied.
        membership={pending ? null : selected}
        canDecide={canDecide}
        onClose={() => setSelected(null)}
        onAction={(membership, action) => setPending({ membership, action })}
      />
      <DecisionDialog
        membership={pending?.membership ?? null}
        action={pending?.action ?? null}
        onClose={() => setPending(null)}
        onConflict={refresh}
        onDone={() => {
          setPending(null);
          setSelected(null);
          refresh();
        }}
      />
    </div>
  );
}
