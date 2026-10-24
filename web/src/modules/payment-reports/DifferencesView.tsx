'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { DataTable } from '@/components/data-table';
import { formatPayAmount } from '@/lib/pay-link';
import { formatSigned } from '@/modules/payment-settlements/format';
import { useGateways } from '@/modules/payment-settlements/useGateways';
import { gatewayDisplayName } from '@/modules/payments/gateways/contract';
import { buildDifferencesQuery, signedTone, type DifferenceRow, type DifferencesReport } from './contract';
import { ReportShell, Stat } from './ReportShell';
import { useReport } from './useReport';

/**
 * فروقات التسويات: كل تسوية `unreconciled` (لا قيد لها ولا تستهلك دفعات) بفرقها الموقَّع وعمرها، مرتبةً من الأقدم، مع إجماليات.
 * الفرق الموجب والسالب يُعرضان بإشارتهما ولا يُصفَّيان ببعضهما في الإجمالي المعروض إلا كصافٍ مع تفصيله.
 */
export function DifferencesView() {
  const t = useTranslations('paymentReports');
  const locale = useLocale();
  const { gateways } = useGateways();
  const [gatewayId, setGatewayId] = useState('');
  const { data, loading, error, reload } = useReport<DifferencesReport>(`/payment-reports/settlement-differences${buildDifferencesQuery(gatewayId)}`);

  const columns = useMemo<ColumnDef<DifferenceRow, unknown>[]>(() => [
    { id: 'ref', header: t('col_ref'), cell: ({ row }) => <bdi dir="ltr" className="font-medium">{row.original.provider_settlement_ref}</bdi> },
    { id: 'gateway', header: t('col_gateway'), cell: ({ row }) => row.original.gateway_name ?? '—' },
    { id: 'date', header: t('col_date'), cell: ({ row }) => <bdi>{row.original.settlement_date ?? '—'}</bdi> },
    { id: 'age', header: t('col_age'), cell: ({ row }) => (row.original.age_days === null ? '—' : t('age_days', { n: row.original.age_days })) },
    { id: 'gross', header: t('col_gross'), cell: ({ row }) => <bdi dir="ltr">{formatPayAmount(row.original.gross_amount, row.original.currency)}</bdi> },
    { id: 'net', header: t('col_net_bank'), cell: ({ row }) => <bdi dir="ltr">{formatPayAmount(row.original.net_bank_amount, row.original.currency)}</bdi> },
    {
      id: 'diff', header: t('col_difference'),
      cell: ({ row }) => <Badge tone={signedTone(row.original.unreconciled_minor)}><bdi dir="ltr">{formatSigned(row.original.unreconciled_minor, row.original.currency)}</bdi></Badge>,
    },
  ], [t]);

  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-muted">{t('differences_hint')}</p>
      <div className="flex max-w-xs flex-col gap-1.5">
        <Label htmlFor="pr-diff-gateway">{t('filter_gateway')}</Label>
        <Select id="pr-diff-gateway" value={gatewayId} onChange={(e) => setGatewayId(e.target.value)}>
          <option value="">{t('filter_all')}</option>
          {gateways.map((g) => <option key={g.id} value={g.id}>{gatewayDisplayName(g, locale)}</option>)}
        </Select>
      </div>
      <ReportShell loading={loading} error={error} onRetry={reload} hasData={data !== null}>
        {data && (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Stat label={t('diff_count')}>{data.totals.count}</Stat>
              <Stat label={t('diff_net')}><bdi dir="ltr">{formatSigned(data.totals.net_minor, data.currency)}</bdi></Stat>
              <Stat label={t('diff_positive')}><bdi dir="ltr">{formatSigned(data.totals.positive_minor, data.currency)}</bdi></Stat>
              <Stat label={t('diff_negative')}><bdi dir="ltr">{formatSigned(data.totals.negative_minor, data.currency)}</bdi></Stat>
              <Stat label={t('diff_oldest')}>{data.totals.oldest_settlement_date ? <bdi>{data.totals.oldest_settlement_date}</bdi> : '—'}</Stat>
            </dl>
            <DataTable columns={columns} data={data.rows} loading={loading} showToolbar={false} emptyLabel={t('differences_empty')} />
            {data.has_more && <p role="note" className="text-xs text-muted">{t('differences_more')}</p>}
          </div>
        )}
      </ReportShell>
    </div>
  );
}
