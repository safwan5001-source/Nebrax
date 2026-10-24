'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/nebrax';
import { formatPayAmount } from '@/lib/pay-link';
import { formatSigned } from '@/modules/payment-settlements/format';
import { differenceTone, knownAccountSource, knownCheckKey, knownNotChecked, statusTone, type ReconciliationReport } from './contract';
import { ReportShell, Stat } from './ReportShell';
import { useReport } from './useReport';

/**
 * مطابقة حساب المقاصة (1170) مع القيود الفعلية: رصيد الأستاذ مقابل ما تقوله المستندات (تحصيلات − مسوّى − استردادات + مخصوم)، مع تفصيل حسب مصدر القيد.
 * الحركة من مصدر غير هذه المستندات (قيد يدوي مثلاً) تظهر ولا تُخفى. قراءة فقط؛ لا إجراء هنا يغيّر الدفتر.
 */
export function ReconciliationView() {
  const t = useTranslations('paymentReports');
  const { data, loading, error, reload } = useReport<ReconciliationReport>('/payment-reports/clearing-reconciliation');
  const currency = data?.currency ?? 'SAR';
  const money = (minor: number) => <bdi dir="ltr">{formatPayAmount(minor, currency)}</bdi>;
  const signed = (minor: number) => <bdi dir="ltr">{formatSigned(minor, currency)}</bdi>;

  return (
    <ReportShell loading={loading} error={error} onRetry={reload} hasData={data !== null}>
      {data && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={statusTone(data.status)}>{t(`recon_status_${data.status}` as 'recon_status_reconciled')}</Badge>
            {data.mapping_state === 'unmapped' && <Badge tone="warning">{t('recon_unmapped')}</Badge>}
          </div>

          {data.status === 'unresolved' ? (
            <EmptyState title={t('recon_unresolved_title')} description={t('recon_unresolved_desc')} />
          ) : (
            <>
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Stat label={t('recon_ledger')}>{money(data.ledger_balance)}</Stat>
                <Stat label={t('recon_expected')}>{money(data.expected_balance)}</Stat>
                <Stat label={t('recon_difference')} tone={data.difference === 0 ? 'positive' : 'negative'}>{signed(data.difference)}</Stat>
              </dl>

              {data.other_sources.length > 0 && (
                <p role="note" className="rounded border border-warning/30 bg-warning/5 p-3 text-sm leading-6 text-warning">{t('recon_other_note')}</p>
              )}

              <section aria-labelledby="pr-checks" className="space-y-2">
                <h3 id="pr-checks" className="text-sm font-semibold">{t('recon_checks_title')}</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-muted">
                        <th className="p-1.5 text-start">{t('col_source')}</th>
                        <th className="p-1.5 text-start">{t('col_document')}</th>
                        <th className="p-1.5 text-start">{t('col_ledger')}</th>
                        <th className="p-1.5 text-start">{t('col_difference')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.checks.map((c) => (
                        <tr key={c.key} className={`border-t border-border ${c.difference !== 0 ? 'bg-negative/5' : ''}`} data-difference={c.difference !== 0 ? 'true' : 'false'}>
                          <td className="p-1.5">{knownCheckKey(c.key) ? t(`check_${c.key}` as 'check_captures') : c.key}</td>
                          <td className="p-1.5">{money(c.document)}</td>
                          <td className="p-1.5">{money(c.ledger)}</td>
                          <td className="p-1.5"><Badge tone={differenceTone(c.difference)}>{signed(c.difference)}</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section aria-labelledby="pr-docs" className="space-y-2">
                <h3 id="pr-docs" className="text-sm font-semibold">{t('recon_documents_title')}</h3>
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label={t('doc_captures')}>{money(data.documents.captures)}</Stat>
                  <Stat label={t('doc_settled')}>{money(data.documents.settled_gross)}</Stat>
                  <Stat label={t('doc_refunds')}>{money(data.documents.refunds)}</Stat>
                  <Stat label={t('doc_deducted')}>{money(data.documents.deducted_refunds)}</Stat>
                </dl>
              </section>

              <section aria-labelledby="pr-accounts" className="space-y-2">
                <h3 id="pr-accounts" className="text-sm font-semibold">{t('recon_accounts_title')}</h3>
                <ul className="divide-y divide-border rounded border border-border text-sm">
                  {data.accounts.map((a) => (
                    <li key={a.account_id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                      <span><bdi dir="ltr" className="font-medium">{a.code}</bdi> · {a.name}</span>
                      <span className="flex flex-wrap items-center gap-1">
                        {a.sources.map((s) => <Badge key={s} tone="muted">{knownAccountSource(s) ? t(`account_source_${s}` as 'account_source_current') : s}</Badge>)}
                        {!a.is_active && <Badge tone="warning">{t('account_inactive')}</Badge>}
                        {money(a.balance)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>

              {data.per_gateway.length > 0 && (
                <section aria-labelledby="pr-gateways" className="space-y-2">
                  <h3 id="pr-gateways" className="text-sm font-semibold">{t('recon_gateways_title')}</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-muted">
                          <th className="p-1.5 text-start">{t('col_gateway')}</th>
                          <th className="p-1.5 text-start">{t('col_unsettled_captures')}</th>
                          <th className="p-1.5 text-start">{t('col_unsettled_refunds')}</th>
                          <th className="p-1.5 text-start">{t('col_expected')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.per_gateway.map((g) => (
                          <tr key={g.payment_gateway_id} className="border-t border-border">
                            <td className="p-1.5">{g.gateway_name ?? '—'}</td>
                            <td className="p-1.5">{money(g.unsettled_captures)}</td>
                            <td className="p-1.5">{money(g.unsettled_refunds)}</td>
                            <td className="p-1.5">{money(g.expected_balance)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {data.not_checked.length > 0 && (
                <section aria-labelledby="pr-notchecked" className="space-y-1">
                  <h3 id="pr-notchecked" className="text-xs font-semibold text-muted">{t('not_checked_title')}</h3>
                  <ul className="list-disc space-y-0.5 ps-5 text-xs text-muted">
                    {data.not_checked.map((k) => <li key={k}>{knownNotChecked(k) ? t(`not_checked_${k}` as 'not_checked_per_branch_ledger') : k}</li>)}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      )}
    </ReportShell>
  );
}
