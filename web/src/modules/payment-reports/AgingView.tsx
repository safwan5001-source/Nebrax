'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/nebrax';
import { api } from '@/lib/api';
import { formatPayAmount } from '@/lib/pay-link';
import { formatSigned } from '@/modules/payment-settlements/format';
import { bucketRanges, bucketTone, buildAgingQuery, type AgingReport, type BranchOption } from './contract';
import { REPORT_CURRENCY, ReportShell } from './ReportShell';
import { useReport } from './useReport';

/**
 * أعمار أرصدة المقاصة حسب الفرع: التحصيلات غير المسوّاة والاستردادات غير المخصومة والصافي في أربع شرائح عمرية (من تاريخ السند/الاسترداد المحاسبي).
 * قائمة مستندات لا قراءة دفتر لكل فرع (قيد التسوية يحمل فرع من رحّلها، فمقارنة الأستاذ لكل فرع تُنتج فروقاً وهمية).
 */
export function AgingView() {
  const t = useTranslations('paymentReports');
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const { data, loading, error, reload } = useReport<AgingReport>(`/payment-reports/clearing-aging${buildAgingQuery(selected)}`);

  useEffect(() => {
    let live = true;
    api<{ data: BranchOption[] }>('/branches').then((res) => { if (live) setBranches(res.data.filter((b) => b.is_active)); }).catch(() => {});
    return () => { live = false; };
  }, []);

  const toggle = (id: string) => setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const money = (minor: number) => <bdi dir="ltr">{formatPayAmount(minor, REPORT_CURRENCY)}</bdi>;

  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-muted">{t('aging_hint')}</p>
      {branches.length > 1 && (
        <fieldset className="space-y-1.5">
          <legend className="text-xs text-muted">{t('filter_branches')}</legend>
          <div className="flex flex-wrap gap-3">
            {branches.map((b) => (
              <label key={b.id} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={selected.includes(b.id)} onChange={() => toggle(b.id)} />
                {b.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <ReportShell loading={loading} error={error} onRetry={reload} hasData={data !== null}>
        {data && (data.rows.length === 0 ? (
          <EmptyState title={t('aging_empty')} />
        ) : (
          <AgingTable data={data} money={money} />
        ))}
      </ReportShell>
    </div>
  );
}

type Side = { total: number; buckets: number[] };

function AgingTable({ data, money }: { data: AgingReport; money: (minor: number) => React.ReactNode }) {
  const t = useTranslations('paymentReports');
  const ranges = bucketRanges(data.bucket_days);
  const last = ranges.length - 1;
  const label = (r: { from: number; to: number | null }) => (r.to === null ? t('bucket_over', { days: r.from - 1 }) : r.from === 0 ? t('bucket_upto', { to: r.to }) : t('bucket_range', { from: r.from, to: r.to }));

  const sections: { key: 'captures' | 'refunds' | 'net'; title: string }[] = [
    { key: 'captures', title: t('aging_captures') },
    { key: 'refunds', title: t('aging_refunds') },
    { key: 'net', title: t('aging_net') },
  ];

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">{t('aging_as_of')}: <bdi>{data.as_of}</bdi></p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[48rem] text-sm">
          <thead>
            <tr className="text-xs text-muted">
              <th rowSpan={2} className="p-1.5 text-start align-bottom">{t('col_branch')}</th>
              {sections.map((s) => <th key={s.key} colSpan={ranges.length + 1} className="border-s border-border p-1.5 text-start">{s.title}</th>)}
            </tr>
            <tr className="text-xs text-muted">
              {sections.flatMap((s) => [
                ...ranges.map((r) => <th key={`${s.key}-${r.index}`} className={`p-1.5 text-start ${r.index === 0 ? 'border-s border-border' : ''}`}>{label(r)}</th>),
                <th key={`${s.key}-total`} className="p-1.5 text-start">{t('col_total')}</th>,
              ])}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.branch_id ?? 'unassigned'} className="border-t border-border">
                <td className="p-1.5 font-medium">{row.branch_name ?? (row.branch_id === null ? t('branch_unassigned') : '—')}</td>
                {sections.flatMap((s) => cells(row[s.key] as Side, s.key, ranges.length, last, money))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border font-semibold" data-testid="aging-totals">
              <td className="p-1.5">{t('totals_row')}</td>
              {sections.flatMap((s) => cells(data.totals[s.key], s.key, ranges.length, last, money))}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function cells(side: Side, key: string, count: number, last: number, money: (minor: number) => React.ReactNode) {
  const show = (minor: number) => (key === 'net' ? <bdi dir="ltr">{formatSigned(minor, REPORT_CURRENCY)}</bdi> : money(minor));
  return [
    ...Array.from({ length: count }, (_, i) => {
      const value = side.buckets[i];
      const body = value === 0 ? <span className="text-muted">—</span> : bucketTone(i, last, value) === 'warning' ? <Badge tone="warning">{show(value)}</Badge> : show(value);
      return <td key={`${key}-${i}`} className={`p-1.5 ${i === 0 ? 'border-s border-border' : ''}`}>{body}</td>;
    }),
    <td key={`${key}-total`} className="p-1.5">{show(side.total)}</td>,
  ];
}
