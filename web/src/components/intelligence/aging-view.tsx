'use client';

import { useTranslations } from 'next-intl';
import { Money } from '@/components/ui/money';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import type { AgingBuckets, AgingResult } from '@/modules/intelligence/contract';

const BUCKETS = ['b0_30', 'b31_60', 'b61_90', 'b90_plus'] as const;

/**
 * أعمار الذمم: جدول على الشاشات العريضة وبطاقات على الجوال (لا تمرير أفقي لأرقام مالية).
 * الأعمدة من العقد الثابت؛ الأرقام تُعرض كما أرسلها الخادم.
 */
export function AgingView({ result }: { result: AgingResult }) {
  const t = useTranslations('intelligence.result');
  const withheld = result.partner_detail === 'withheld';

  const cells = (row: AgingBuckets) => BUCKETS.map((key) => (
    <TD key={key} className="text-end"><Money value={row[key].decimal} /></TD>
  ));

  return (
    <div className="space-y-3" data-result={result.report}>
      {withheld ? <p className="rounded border border-border bg-surface p-3 text-sm text-muted">{t('partner_withheld')}</p> : null}

      {/* جدول — من sm فما فوق */}
      <div className="hidden overflow-hidden rounded border border-border bg-surface sm:block">
        <Table aria-label={t(result.report)}>
          <THead>
            <TR>
              <TH scope="col">{t('partner')}</TH>
              {BUCKETS.map((key) => (
                <TH key={key} scope="col" className="text-end">
                  <span dir="ltr">{t(`buckets.${key}`)}</span> <span className="text-[11px] font-normal">{t('days')}</span>
                </TH>
              ))}
              <TH scope="col" className="text-end">{t('total')}</TH>
            </TR>
          </THead>
          <TBody>
            {!withheld && result.rows.length === 0 ? (
              <TR><TD colSpan={6} className="text-center text-muted">{t('no_rows')}</TD></TR>
            ) : null}
            {!withheld && result.rows.map((row) => (
              <TR key={row.partner_id}>
                <TD>{row.name ?? <span className="text-muted">{t('unnamed_partner')}</span>}</TD>
                {cells(row)}
                <TD className="text-end font-medium"><Money value={row.total.decimal} /></TD>
              </TR>
            ))}
            <TR className="bg-primary-soft/50 font-semibold">
              <TD>{t('total')}</TD>
              {cells(result.totals)}
              <TD className="text-end"><Money value={result.totals.total.decimal} /></TD>
            </TR>
          </TBody>
        </Table>
      </div>

      {/* بطاقات — الجوال */}
      <ul className="space-y-2 sm:hidden" aria-label={t(result.report)}>
        {!withheld && result.rows.length === 0 ? <li className="rounded border border-border bg-surface p-3 text-sm text-muted">{t('no_rows')}</li> : null}
        {!withheld && result.rows.map((row) => (
          <li key={row.partner_id} className="rounded border border-border bg-surface p-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-sm font-medium">{row.name ?? t('unnamed_partner')}</span>
              <Money value={row.total.decimal} className="text-sm font-semibold" />
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              {BUCKETS.map((key) => (
                <div key={key} className="flex items-baseline justify-between gap-2">
                  <dt className="text-muted"><span dir="ltr">{t(`buckets.${key}`)}</span> {t('days')}</dt>
                  <dd><Money value={row[key].decimal} /></dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
        <li className="rounded border border-border bg-primary-soft/50 p-3">
          <div className="flex items-baseline justify-between gap-3 text-sm font-semibold">
            <span>{t('total')}</span>
            <Money value={result.totals.total.decimal} />
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            {BUCKETS.map((key) => (
              <div key={key} className="flex items-baseline justify-between gap-2">
                <dt className="text-muted"><span dir="ltr">{t(`buckets.${key}`)}</span> {t('days')}</dt>
                <dd><Money value={result.totals[key].decimal} /></dd>
              </div>
            ))}
          </dl>
        </li>
      </ul>
    </div>
  );
}
