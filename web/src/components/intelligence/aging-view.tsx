'use client';

import { useTranslations } from 'next-intl';
import { Money } from '@/components/ui/money';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import type { AgingBuckets, AgingResult } from '@/modules/intelligence/contract';
import { KpiTile } from './kpi-tile';

const BUCKETS = ['b0_30', 'b31_60', 'b61_90', 'b90_plus'] as const;
type Bucket = (typeof BUCKETS)[number];

/** نقطة الشريحة: دلالة التأخر فقط (أحمر للأقدم) وتخفت عند الصفر. مقارنة بالصفر لا حساب. */
function dotFor(bucket: Bucket, minor: number): string {
  if (minor === 0) return 'bg-border';
  return { b0_30: 'bg-primary', b31_60: 'bg-primary/60', b61_90: 'bg-warning', b90_plus: 'bg-negative' }[bucket];
}

/**
 * أعمار الذمم: **الإجمالي أولاً** ثم شرائح الأعمار (بلاطات) ثم التفصيل بالطرف — جدول من sm وبطاقات على الجوال.
 * الأرقام كما أرسلها الخادم؛ لا نسب مئوية (غير موجودة في الخدمة).
 */
export function AgingView({ result }: { result: AgingResult }) {
  const t = useTranslations('intelligence.result');
  const withheld = result.partner_detail === 'withheld';
  const label = (bucket: Bucket) => `${t(`buckets.${bucket}`)} ${t('days')}`;

  const cells = (row: AgingBuckets) => BUCKETS.map((key) => (
    <TD key={key} className="py-1.5 text-end"><Money value={row[key].decimal} /></TD>
  ));

  return (
    <div className="space-y-4" data-result={result.report}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5" role="group" aria-label={t('summary')}>
        <KpiTile emphasis className="col-span-2 sm:col-span-1" label={t('total')} value={result.totals.total.decimal} />
        {BUCKETS.map((key) => (
          <KpiTile key={key} label={label(key)} value={result.totals[key].decimal} dot={dotFor(key, result.totals[key].minor)} />
        ))}
      </div>

      {withheld ? <p className="rounded border border-border bg-surface p-3 text-sm text-muted">{t('partner_withheld')}</p> : null}

      {!withheld ? (
        <>
          {/* جدول — من sm فما فوق */}
          <div className="hidden overflow-hidden rounded border border-border bg-surface sm:block">
            <Table aria-label={t(result.report)}>
              <THead>
                <TR className="bg-background/60">
                  <TH scope="col" className="text-xs">{t('partner')}</TH>
                  {BUCKETS.map((key) => (
                    <TH key={key} scope="col" className="text-end text-xs">
                      <span dir="ltr">{t(`buckets.${key}`)}</span> <span className="font-normal">{t('days')}</span>
                    </TH>
                  ))}
                  <TH scope="col" className="text-end text-xs">{t('total')}</TH>
                </TR>
              </THead>
              <TBody>
                {result.rows.length === 0 ? (
                  <TR><TD colSpan={6} className="text-center text-muted">{t('no_rows')}</TD></TR>
                ) : null}
                {result.rows.map((row) => (
                  <TR key={row.partner_id}>
                    <TD className="py-1.5">{row.name ?? <span className="text-muted">{t('unnamed_partner')}</span>}</TD>
                    {cells(row)}
                    <TD className="py-1.5 text-end font-medium"><Money value={row.total.decimal} /></TD>
                  </TR>
                ))}
                <TR className="bg-primary-soft/40 font-semibold">
                  <TD>{t('total')}</TD>
                  {cells(result.totals)}
                  <TD className="text-end"><Money value={result.totals.total.decimal} /></TD>
                </TR>
              </TBody>
            </Table>
          </div>

          {/* بطاقات الأطراف — الجوال (الإجمالي والشرائح أعلاه) */}
          <ul className="space-y-2 sm:hidden" aria-label={t('partner')}>
            {result.rows.length === 0 ? <li className="rounded border border-border bg-surface p-3 text-sm text-muted">{t('no_rows')}</li> : null}
            {result.rows.map((row) => (
              <li key={row.partner_id} className="rounded border border-border bg-surface p-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-sm font-medium">{row.name ?? t('unnamed_partner')}</span>
                  <Money value={row.total.decimal} className="text-sm font-semibold" />
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  {BUCKETS.map((key) => (
                    <div key={key} className="flex items-baseline justify-between gap-2">
                      <dt className="flex items-center gap-1.5 text-muted">
                        <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${dotFor(key, row[key].minor)}`} />
                        <span dir="ltr">{t(`buckets.${key}`)}</span>
                      </dt>
                      <dd><Money value={row[key].decimal} /></dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
