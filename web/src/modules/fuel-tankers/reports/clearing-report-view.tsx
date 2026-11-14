'use client';

import { useTranslations } from 'next-intl';
import { ClipboardList } from 'lucide-react';
import { EmptyState } from '@/components/nebrax';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MinorAmount } from '../fills/parts';
import type { ClearingAccountRow, ClearingReport, ReportMeta } from './logic';
import { BalanceScopeNotice, FindingBadges } from './parts';

/**
 * ③ الحساب الوسيط: الأرصدة **على مستوى الأستاذ** (مؤسسة أو فروع) — لا على مستوى محطة أبداً. سطر القيد يحمل الفرع لا المحطة، فلا يُقسَّم رصيد حساب مشترك بين المحطات بالتقدير.
 * يصل هذا العرض لمن يملك `products.view_cost` و`accounts.view` وبلا تقييد محطات/مخازن فقط (الخادم يرفض غيره 403)؛ والواجهة لا تخمّن ولا تُظهر أرصدة تلقائياً.
 */
export function ClearingReportView({ data, meta }: { data: ClearingReport; meta: ReportMeta }) {
  const t = useTranslations('fuelTankerReports');
  return (
    <div className="space-y-3" data-report-view="clearing-account">
      <BalanceScopeNotice scope={data.scope} notApplicable={meta.balance_filters_not_applicable} />
      <p className="text-sm text-muted" data-period="">{t('clearing.period', { from: data.period.from ?? '—', to: data.period.to ?? '—' })}</p>
      {data.accounts.length === 0 ? (
        <EmptyState icon={ClipboardList} title={t('clearing.emptyTitle')} description={t('clearing.emptyBody')} />
      ) : (
        <ul className="space-y-3">
          {data.accounts.map((account) => <li key={account.account.id}><AccountCard row={account} scopeLevel={data.scope.level} /></li>)}
        </ul>
      )}
    </div>
  );
}

function AccountCard({ row, scopeLevel }: { row: ClearingAccountRow; scopeLevel: string }) {
  const t = useTranslations('fuelTankerReports');
  const differs = row.unexplained_difference_minor !== 0;
  const tile = (key: string, minor: number, emphasis?: 'negative') => (
    <div key={key} data-balance={key}><dt className="text-xs text-muted">{t(`clearing.balance.${key}`)}</dt><dd className={`font-semibold ${emphasis ? 'text-negative' : 'text-text'}`}><MinorAmount minor={minor} /></dd></div>
  );
  return (
    <Card data-clearing-account={row.account.code ?? row.account.id} data-differs={differs ? 'true' : 'false'}>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle><span className="num" dir="ltr">{row.account.code ?? '—'}</span> <bdi>{row.account.name ?? ''}</bdi></CardTitle>
          <div className="flex flex-wrap gap-1.5">
            {row.account.is_current ? <Badge tone="positive">{t('clearing.current')}</Badge> : <Badge tone="warning">{t('clearing.notCurrent')}</Badge>}
            <Badge tone="muted" data-ledger-level={scopeLevel}>{scopeLevel === 'branches' ? t('clearing.levelBranches') : t('clearing.levelOrganization')}</Badge>
          </div>
        </div>
        <p className="text-xs text-muted">{t('clearing.ledgerNote')}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          {tile('opening', row.opening_balance_minor)}
          {tile('debits', row.period_debits_minor)}
          {tile('credits', row.period_credits_minor)}
          {tile('closing', row.closing_balance_minor)}
        </dl>
        <dl className="grid grid-cols-1 gap-3 rounded-md border border-border p-3 text-sm sm:grid-cols-3">
          <div><dt className="text-xs text-muted">{t('clearing.tankerNet')}</dt><dd className="font-medium"><MinorAmount minor={row.tanker.net_all_time_minor} /></dd></div>
          {tile('supported', row.supported_balance_minor)}
          {tile('difference', row.unexplained_difference_minor, differs ? 'negative' : undefined)}
        </dl>
        <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <dl className="rounded-md border border-border p-3" data-side="tanker">
            <dt className="mb-1 text-xs font-semibold text-text">{t('clearing.tankerEntries')}</dt>
            <dd className="flex justify-between gap-2"><span className="text-muted">{t('clearing.balance.debits')}</span><MinorAmount minor={row.tanker.debits_minor} /></dd>
            <dd className="flex justify-between gap-2"><span className="text-muted">{t('clearing.balance.credits')}</span><MinorAmount minor={row.tanker.credits_minor} /></dd>
          </dl>
          <dl className="rounded-md border border-border p-3" data-side="other">
            <dt className="mb-1 text-xs font-semibold text-text">{t('clearing.otherEntries')}</dt>
            <dd className="flex justify-between gap-2"><span className="text-muted">{t('clearing.balance.debits')}</span><MinorAmount minor={row.other.debits_minor} /></dd>
            <dd className="flex justify-between gap-2"><span className="text-muted">{t('clearing.balance.credits')}</span><MinorAmount minor={row.other.credits_minor} /></dd>
            <dd className="flex justify-between gap-2"><span className="text-muted">{t('clearing.otherNet')}</span><MinorAmount minor={row.other.net_all_time_minor} /></dd>
          </dl>
        </div>
        {row.findings.length > 0 ? <FindingBadges findings={row.findings} /> : <Badge tone="positive" data-clean="">{t('clearing.clean')}</Badge>}
        {row.other_entries.length > 0 ? (
          <details className="rounded-md border border-border px-3 py-2" data-other-entries="">
            <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-text">{t('clearing.otherEntriesList', { count: row.other_entries.length })}</summary>
            <ul className="space-y-1.5 pb-2 text-sm">
              {row.other_entries.map((entry) => (
                <li key={entry.entry_id} className="rounded-md border border-border p-2">
                  <p className="font-medium text-text"><bdi className="num" dir="ltr">{entry.number ?? '—'}</bdi> · <span className="num" dir="ltr">{entry.entry_date ?? '—'}</span>{entry.source ? <> · <span className="text-muted">{entry.source}</span></> : null}</p>
                  {entry.description ? <p className="text-muted"><bdi>{entry.description}</bdi></p> : null}
                  <p className="text-xs text-muted">{t('clearing.balance.debits')}: <MinorAmount minor={entry.debit_minor} /> · {t('clearing.balance.credits')}: <MinorAmount minor={entry.credit_minor} /></p>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}
