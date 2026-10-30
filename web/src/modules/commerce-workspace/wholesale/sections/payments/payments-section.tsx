'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import type { ColumnDef } from '@tanstack/react-table';
import { ExternalLink, Info, ShieldAlert } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/nebrax';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatRiyal } from '@/lib/money';
import { useCan } from '@/lib/use-can';
import { methodTone, type OnlineMethod } from '@/modules/payments/methods/contract';
import { SectionPage } from '../../components/section-page';
import { ResourceBoundary } from '../../components/resource-boundary';
import { UnavailablePanel } from '../../components/unavailable-panel';
import { useResource } from '../../use-resource';
import {
  fetchCreditSample,
  fetchOnlineMethods,
  fetchPaymentMethods,
  type CreditPartner,
  type PaymentMethodRow,
} from './api';
import { paymentsMessages } from './messages';

export const FINANCE_PAYMENTS_HREF = '/finance-settings/payments';
export const PARTNERS_HREF = '/partners';

/**
 * Payments & Credit — read-only. Payment methods and online-method readiness come straight from the server; credit
 * terms are the values recorded on customers. Nothing here evaluates, reserves or enforces credit, and the page says
 * so explicitly: credit is not checked on a wholesale (commerce) order.
 */
export function PaymentsSection() {
  const locale = useLocale();
  const { t } = paymentsMessages.forLocale(locale);

  return (
    <SectionPage
      sectionKey="payments"
      description={t('description')}
      actionsSlot={
        <Button asChild variant="outline">
          <Link href={FINANCE_PAYMENTS_HREF}>
            <ExternalLink aria-hidden className="h-4 w-4" strokeWidth={1.7} />
            {t('manage')}
          </Link>
        </Button>
      }
    >
      <div className="space-y-6">
        <CheckoutNotice />
        <MethodsTable />
        <OnlineMethods />
        <CreditSection />
      </div>
    </SectionPage>
  );
}

function CheckoutNotice() {
  const { t } = paymentsMessages.forLocale(useLocale());
  return (
    <section role="note" aria-labelledby="pay-checkout-title" className="flex gap-3 rounded border border-border bg-surface p-3">
      <Info aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={1.7} />
      <div className="min-w-0 space-y-1">
        <h2 id="pay-checkout-title" className="text-sm font-medium text-text">{t('checkoutTitle')}</h2>
        <p className="text-sm leading-relaxed text-muted">{t('checkoutBody')}</p>
        <p className="num text-xs text-muted" dir="ltr">{t('checkoutRef')}</p>
      </div>
    </section>
  );
}

function MethodsTable() {
  const locale = useLocale();
  const { t, label } = paymentsMessages.forLocale(locale);
  const { state, reload } = useResource(fetchPaymentMethods, []);

  const statusBadges = (m: PaymentMethodRow) => (
    <span className="inline-flex flex-wrap gap-1">
      <Badge tone={m.isActive ? 'positive' : 'muted'}>{m.isActive ? t('active') : t('inactive')}</Badge>
      {m.isDefault ? <Badge tone="neutral">{t('isDefault')}</Badge> : null}
    </span>
  );

  const columns = useMemo<ColumnDef<PaymentMethodRow, unknown>[]>(
    () => [
      { accessorKey: 'name', header: t('methodName') },
      { id: 'settlement', header: t('methodSettlement'), accessorFn: (m) => label('settlement', m.settlementType) },
      { id: 'account', header: t('methodAccount'), accessorFn: (m) => m.accountName ?? '—' },
      { id: 'online', header: t('methodOnline'), accessorFn: (m) => (m.availableOnline ? t('yes') : t('no')) },
      { id: 'status', header: t('methodStatus'), enableSorting: false, cell: ({ row }) => statusBadges(row.original) },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale],
  );

  return (
    <section aria-labelledby="pay-methods-title" className="space-y-3">
      <h2 id="pay-methods-title" className="text-base font-semibold text-text">{t('methodsTitle')}</h2>
      <DataTable<PaymentMethodRow>
        columns={columns}
        data={state.status === 'ready' ? state.data : []}
        loading={state.status === 'loading'}
        error={state.status === 'error' ? t('methodsLoadError') : null}
        onRetry={reload}
        showToolbar={false}
        emptyLabel={t('methodsEmpty')}
        emptyDescription={t('methodsEmptyHint')}
        mobileRecord={(m) => ({
          title: m.name,
          subtitle: `${label('settlement', m.settlementType)} · ${m.accountName ?? '—'}`,
          status: statusBadges(m),
          meta: `${t('methodOnline')}: ${m.availableOnline ? t('yes') : t('no')}`,
        })}
      />
    </section>
  );
}

function OnlineMethods() {
  const locale = useLocale();
  const { t, label } = paymentsMessages.forLocale(locale);
  const { state, reload } = useResource(fetchOnlineMethods, []);

  return (
    <section aria-labelledby="pay-online-title" className="space-y-3">
      <div>
        <h2 id="pay-online-title" className="text-base font-semibold text-text">{t('onlineTitle')}</h2>
        <p className="text-sm text-muted">{t('onlineHint')}</p>
      </div>
      <ResourceBoundary state={state} onRetry={reload} loadingVariant="cards" loadingRows={2}>
        {(methods: OnlineMethod[]) =>
          methods.length === 0 ? (
            <EmptyState title={t('onlineEmpty')} />
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {methods.map((method) => (
                <li key={method.key} className="space-y-2 rounded border border-border bg-surface p-3" data-testid="online-method">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-text">{label('onlineMethod', method.key)}</p>
                    <Badge tone={methodTone(method.status)} wrap>{label('onlineStatus', method.status)}</Badge>
                  </div>
                  <dl className="space-y-1 text-xs text-muted">
                    <div className="flex justify-between gap-2">
                      <dt>{t('onlineGateway')}</dt>
                      <dd className="text-text">{method.effective_gateway?.name ?? t('onlineNoGateway')}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt>{t('onlineCustomerVisible')}</dt>
                      <dd className="text-text">{method.customer_visible ? t('yes') : t('no')}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          )
        }
      </ResourceBoundary>
    </section>
  );
}

function CreditSection() {
  const { t } = paymentsMessages.forLocale(useLocale());
  const { can } = useCan();
  const allowed = can('partners.view');

  return (
    <section aria-labelledby="pay-credit-title" className="space-y-3">
      <div>
        <h2 id="pay-credit-title" className="text-base font-semibold text-text">{t('creditTitle')}</h2>
        <p className="text-sm text-muted">{t('creditHint')}</p>
      </div>

      <UnavailablePanel
        title={t('creditNoticeTitle')}
        description={t('creditNoticeBody')}
        blocker={t('creditNoticeBlocker')}
        reference={t('creditNoticeRef')}
      />

      {allowed ? (
        <CreditList />
      ) : (
        <EmptyState icon={ShieldAlert} title={t('creditForbiddenTitle')} description={t('creditForbiddenBody')} />
      )}

      <UnavailablePanel title={t('linkTitle')} description={t('linkDescription')} blocker={t('linkBlocker')} reference={t('linkRef')} />
    </section>
  );
}

function CreditList() {
  const locale = useLocale();
  const { t } = paymentsMessages.forLocale(locale);
  const { state, reload } = useResource(fetchCreditSample, []);

  const columns = useMemo<ColumnDef<CreditPartner, unknown>[]>(
    () => [
      {
        accessorKey: 'name',
        header: t('creditCustomer'),
        cell: ({ row }) => (
          <Link href={`${PARTNERS_HREF}/${row.original.id}`} className="text-primary hover:underline" aria-label={`${t('openPartner')}: ${row.original.name}`}>
            {row.original.name}
          </Link>
        ),
      },
      {
        id: 'limit',
        header: t('creditLimit'),
        accessorFn: (p) => Number(p.creditLimit ?? 0),
        cell: ({ row }) => <span className="num">{row.original.creditLimit === null ? '—' : formatRiyal(row.original.creditLimit)}</span>,
      },
      {
        id: 'period',
        header: t('creditPeriod'),
        accessorFn: (p) => p.creditPeriod ?? 0,
        cell: ({ row }) => <span className="num">{row.original.creditPeriod === null ? '—' : t('creditDays', { n: row.original.creditPeriod })}</span>,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale],
  );

  return (
    <ResourceBoundary state={state} onRetry={reload} loadingRows={3}>
      {(sample) => (
        <div className="space-y-2">
          <p className="text-sm text-muted" data-testid="credit-sample">
            {t('creditSample', { n: sample.inspected, k: sample.withTerms.length })}
            {sample.truncated ? ` ${t('creditTruncated', { n: sample.inspected })}` : ''}
          </p>
          <DataTable<CreditPartner>
            columns={columns}
            data={sample.withTerms}
            showToolbar={false}
            emptyLabel={t('creditNone')}
            emptyDescription={t('creditNoneHint')}
            mobileRecord={(p) => ({
              title: (
                <Link href={`${PARTNERS_HREF}/${p.id}`} className="text-primary hover:underline">
                  {p.name}
                </Link>
              ),
              amount: p.creditLimit === null ? '—' : formatRiyal(p.creditLimit),
              amountLabel: t('creditLimit'),
              secondary: { label: t('creditPeriod'), value: p.creditPeriod === null ? '—' : t('creditDays', { n: p.creditPeriod }) },
            })}
          />
          <Button asChild variant="outline" size="sm">
            <Link href={PARTNERS_HREF}>{t('openPartners')}</Link>
          </Button>
        </div>
      )}
    </ResourceBoundary>
  );
}
