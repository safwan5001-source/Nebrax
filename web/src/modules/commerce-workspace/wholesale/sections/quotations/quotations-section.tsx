'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import { ExternalLink, FileText, Plus } from 'lucide-react';
import { EmptyState, FormAlert, MobileRecordItem } from '@/components/nebrax';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatDate } from '@/lib/formatting';
import { formatRiyal } from '@/lib/money';
import { useCan } from '@/lib/use-can';
import { ResourceBoundary } from '../../components/resource-boundary';
import { SectionPage } from '../../components/section-page';
import { StatCard } from '../../components/stat-card';
import { StatusBadge } from '../../components/status-badge';
import { useResource } from '../../use-resource';
import { QUOTES_NEW_PATH, QUOTE_STATUSES, countByStatus, filterQuotes, loadQuotesOverview, quotePath, type Quote, type QuotesOverview } from './api';
import { quotationsMessages } from './messages';

const PAGE = 25;
const TONE = { draft: 'muted', sent: 'neutral', accepted: 'positive', rejected: 'negative', converted: 'positive' } as const;

export function QuotationsSection() {
  const { t } = quotationsMessages.forLocale(useLocale());
  return (
    <SectionPage sectionKey="quotations" description={t('description')}>
      <Body />
    </SectionPage>
  );
}

function Body() {
  const { can } = useCan();
  const canReadCustomers = can('partners.view');
  const { state, reload } = useResource(() => loadQuotesOverview(canReadCustomers), [canReadCustomers]);

  return (
    <ResourceBoundary state={state} onRetry={reload} loadingVariant="table">
      {(data) => <Loaded data={data} canCreate={can('invoices.manage')} />}
    </ResourceBoundary>
  );
}

function Loaded({ data, canCreate }: { data: QuotesOverview; canCreate: boolean }) {
  const locale = useLocale();
  const { t, label } = quotationsMessages.forLocale(locale);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(PAGE);

  const counts = useMemo(() => countByStatus(data.quotes), [data.quotes]);
  const filtered = useMemo(() => filterQuotes(data.quotes, { status, search, customers: data.customers }), [data, status, search]);
  const shown = filtered.slice(0, limit);
  const statuses = [...QUOTE_STATUSES.filter((value) => counts[value]), ...Object.keys(counts).filter((value) => !(QUOTE_STATUSES as readonly string[]).includes(value))];
  const hasFilters = status !== '' || search.trim() !== '';

  const customerName = (quote: Quote) => data.customers?.[quote.partner_id] ?? '—';
  const statusBadge = (quote: Quote) => <StatusBadge tone={TONE[quote.status as keyof typeof TONE] ?? 'muted'}>{label('status', quote.status)}</StatusBadge>;
  const openLink = (quote: Quote) => (
    <Button asChild size="sm" variant="outline" className="min-h-11">
      <Link href={quotePath(quote.id)}>
        {t('openInAwj')} <ExternalLink className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden="true" />
      </Link>
    </Button>
  );

  return (
    <div className="space-y-4">
      <FormAlert tone="info">{t('scopeNote')}</FormAlert>
      {data.customers === null ? <p className="text-xs text-muted">{t('customersUnavailable')}</p> : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <StatCard label={t('statTotal')} value={data.quotes.length} />
        {QUOTE_STATUSES.map((value) => (
          <StatCard key={value} label={label('status', value)} value={counts[value] ?? 0} />
        ))}
      </div>

      <section aria-label={t('tableTitle')} className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-text">{t('tableTitle')}</h2>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" className="min-h-11">
              <Link href="/quotes">{t('openAll')}</Link>
            </Button>
            {canCreate ? (
              <Button asChild className="min-h-11">
                <Link href={QUOTES_NEW_PATH}><Plus className="h-4 w-4" aria-hidden="true" /> {t('create')}</Link>
              </Button>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Input type="search" aria-label={t('search')} placeholder={t('search')} value={search} onChange={(event) => { setSearch(event.target.value); setLimit(PAGE); }} className="sm:max-w-sm" />
          <Select aria-label={t('statusFilter')} value={status} onChange={(event) => { setStatus(event.target.value); setLimit(PAGE); }} className="sm:w-52">
            <option value="">{t('allStatuses')}</option>
            {statuses.map((value) => (
              <option key={value} value={value}>{label('status', value)}</option>
            ))}
          </Select>
        </div>
        <p className="text-xs text-muted">{t('filterNote')}</p>

        {data.quotes.length === 0 ? (
          <EmptyState icon={FileText} title={t('emptyTitle')} description={t('emptyBody')} />
        ) : filtered.length === 0 ? (
          <EmptyState icon={FileText} title={t('emptyFilteredTitle')} description={hasFilters ? t('emptyFilteredBody') : undefined} />
        ) : (
          <div className="rounded border border-border bg-surface">
            <div className="hidden md:block">
              <Table>
                <THead>
                  <TR>
                    <TH scope="col" className="px-3 py-2 text-start font-medium">{t('colNumber')}</TH>
                    <TH scope="col" className="px-3 py-2 text-start font-medium">{t('colCustomer')}</TH>
                    <TH scope="col" className="px-3 py-2 text-start font-medium">{t('colStatus')}</TH>
                    <TH scope="col" className="px-3 py-2 text-start font-medium">{t('colDate')}</TH>
                    <TH scope="col" className="px-3 py-2 text-start font-medium">{t('colValidUntil')}</TH>
                    <TH scope="col" className="px-3 py-2 text-end font-medium">{t('colTotal')}</TH>
                    <TH scope="col" className="px-3 py-2"><span className="sr-only">{t('open')}</span></TH>
                  </TR>
                </THead>
                <TBody>
                  {shown.map((quote) => (
                    <TR key={quote.id}>
                      <TD className="num px-3 py-2 font-medium">{quote.number}</TD>
                      <TD className="px-3 py-2"><bdi>{customerName(quote)}</bdi></TD>
                      <TD className="px-3 py-2">{statusBadge(quote)}</TD>
                      <TD className="num px-3 py-2 text-muted">{quote.quote_date ? formatDate(quote.quote_date, locale) : '—'}</TD>
                      <TD className="num px-3 py-2 text-muted">{quote.valid_until ? formatDate(quote.valid_until, locale) : '—'}</TD>
                      <TD className="num px-3 py-2 text-end">{formatRiyal(quote.total)}</TD>
                      <TD className="px-3 py-1 text-end">{openLink(quote)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
            <ul className="divide-y divide-border md:hidden">
              {shown.map((quote) => (
                <li key={quote.id}>
                  <MobileRecordItem
                    record={{
                      title: quote.number,
                      subtitle: customerName(quote),
                      amount: formatRiyal(quote.total),
                      status: statusBadge(quote),
                      meta: quote.valid_until ? `${t('colValidUntil')} ${formatDate(quote.valid_until, locale)}` : undefined,
                      actions: openLink(quote),
                    }}
                  />
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between gap-2 border-t border-border p-3">
              <span className="num text-xs text-muted">{t('showing', { shown: shown.length, total: filtered.length })}</span>
              {shown.length < filtered.length ? (
                <Button type="button" variant="outline" className="min-h-11" onClick={() => setLimit((value) => value + PAGE)}>{t('showMore')}</Button>
              ) : null}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
