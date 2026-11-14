'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { EmptyState, MobileRecordItem, Pagination } from '@/components/nebrax';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ClipboardList } from 'lucide-react';
import { formatDateTime } from '@/lib/formatting';
import { fillHref } from '../fills/routes';
import { litersOf } from '../fills/logic';
import { MinorAmount } from '../fills/parts';
import type { FillsReport, ReportMeta } from './logic';
import { MaskingNotice, RowScopeNotice, StateBadge, SummaryTiles } from './parts';

/** ① سندات التعبئة: السندات وأصحاب الصهاريج والكميات وحالات الترحيل والعكس. الأرقام المالية لمن تُرسَل له فقط (`masking.costs`). */
export function FillsReportView({ data, meta, onPage, busy }: { data: FillsReport; meta: ReportMeta; onPage: (page: number) => void; busy: boolean }) {
  const t = useTranslations('fuelTankerReports');
  const f = useTranslations('fuelTankerFills');
  const locale = useLocale();
  const s = data.summary;
  const states = (inv: string) => s.by_state.filter((r) => r.inventory_status === inv && r.status !== 'voided');
  const sum = (rows: Array<{ count: number }>) => rows.reduce((acc, r) => acc + r.count, 0);
  const voided = s.by_state.filter((r) => r.status === 'voided');

  return (
    <div className="space-y-3" data-report-view="fills">
      <RowScopeNotice meta={meta} />
      <MaskingNotice costs={data.masking.costs} accounts={data.masking.accounts} />
      <SummaryTiles tiles={[
        { key: 'total', label: t('fills.summary.total'), value: s.total_count },
        { key: 'quantity', label: t('fills.summary.quantity'), value: <>{litersOf(s.total_quantity_milliliters)} <span className="text-xs font-normal text-muted">{f('liters')}</span></> },
        { key: 'pending', label: f('inventoryStatus.pending_integration'), value: sum(states('pending_integration')), tone: 'warning' },
        { key: 'posted', label: f('inventoryStatus.posted'), value: sum(states('posted')), tone: 'positive' },
        { key: 'reversed', label: f('inventoryStatus.reversed'), value: sum(states('reversed')) },
      ]} />
      {voided.length > 0 ? <p className="text-xs text-muted" data-voided-count="">{t('fills.summary.voided', { count: sum(voided) })}</p> : null}

      {data.rows.length === 0 ? (
        <EmptyState icon={ClipboardList} title={t('empty.title')} description={t('empty.body')} />
      ) : (
        <div aria-busy={busy} className={busy ? 'opacity-60' : undefined}>
          <div className="hidden overflow-x-auto rounded border border-border bg-surface md:block">
            <Table>
              <THead>
                <TR>
                  <TH>{f('field.number')}</TH><TH>{f('field.voucher')}</TH><TH>{f('field.ownerTanker')}</TH><TH>{t('column.stationProduct')}</TH>
                  <TH>{f('field.quantity')}</TH><TH>{f('field.inventoryStatus')}</TH><TH>{t('column.postedReversed')}</TH><TH>{t('column.cost')}</TH><TH>{t('column.entries')}</TH>
                </TR>
              </THead>
              <TBody>
                {data.rows.map((row) => (
                  <TR key={row.id} data-report-row="" data-inventory-status={row.inventory_status}>
                    <TD className="font-medium"><Link href={fillHref(row.id)} className="text-primary hover:underline"><bdi className="num" dir="ltr">{row.number}</bdi></Link></TD>
                    <TD><bdi className="num" dir="ltr">{row.voucher_number ?? '—'}</bdi></TD>
                    <TD>{row.owner?.name ? <bdi>{row.owner.name}</bdi> : '—'}{row.tanker ? <span className="block text-xs text-muted"><bdi>{row.tanker.plate_number}</bdi></span> : null}</TD>
                    <TD><bdi>{row.station?.name ?? '—'}</bdi><span className="block text-xs text-muted"><bdi>{row.fuel_product?.name ?? '—'}</bdi></span></TD>
                    <TD><span className="num" dir="ltr">{litersOf(row.quantity_milliliters)}</span></TD>
                    <TD><div className="flex flex-wrap items-center gap-1"><StateBadge status={row.inventory_status} />{row.status === 'voided' ? <span className="text-xs text-negative">{f('voided')}</span> : null}</div></TD>
                    <TD className="text-xs text-muted">
                      {row.posted_at ? <span className="block">{t('column.posted')}: <span className="num">{formatDateTime(row.posted_at, locale)}</span></span> : null}
                      {row.reversed_at ? <span className="block">{t('column.reversed')}: <span className="num">{formatDateTime(row.reversed_at, locale)}</span></span> : null}
                      {!row.posted_at && !row.reversed_at ? '—' : null}
                    </TD>
                    <TD>{row.posting_status === null ? '—' : <MinorAmount minor={data.masking.costs ? null : row.posted_cost_minor} />}</TD>
                    <TD className="text-xs">
                      {data.masking.costs ? '—' : <>
                        {row.journal_entry?.number ? <bdi className="num block" dir="ltr">{row.journal_entry.number}</bdi> : null}
                        {row.reversal_journal_entry?.number ? <bdi className="num block text-muted" dir="ltr">{row.reversal_journal_entry.number}</bdi> : null}
                        {!row.journal_entry && !row.reversal_journal_entry ? '—' : null}
                      </>}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
          <ul className="divide-y divide-border rounded border border-border bg-surface md:hidden">
            {data.rows.map((row) => (
              <li key={row.id} data-report-row="" data-inventory-status={row.inventory_status}>
                <Link href={fillHref(row.id)} className="block active:bg-primary-soft max-md:min-h-11">
                  <MobileRecordItem record={{
                    title: <bdi className="num" dir="ltr">{row.number}</bdi>,
                    subtitle: [row.owner?.name, row.tanker?.plate_number].filter(Boolean).join(' · ') || undefined,
                    caption: t('fills.mobileCaption', { voucher: row.voucher_number ?? '—', station: row.station?.name ?? '—' }),
                    amount: `${litersOf(row.quantity_milliliters)} ${f('liters')}`,
                    status: <StateBadge status={row.inventory_status} />,
                    meta: row.recorded_at ? formatDateTime(row.recorded_at, locale) : undefined,
                    actions: row.posting_status !== null && !data.masking.costs ? <span className="text-xs text-muted">{t('column.cost')}: <MinorAmount minor={row.posted_cost_minor} /></span> : undefined,
                  }} />
                </Link>
              </li>
            ))}
          </ul>
          {data.pagination.last_page > 1 ? (
            <Pagination page={data.pagination.page} lastPage={data.pagination.last_page} perPage={data.pagination.per_page} total={data.pagination.total} disabled={busy} onPageChange={onPage} />
          ) : null}
        </div>
      )}
    </div>
  );
}
