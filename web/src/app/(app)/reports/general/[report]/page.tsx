'use client';

import { notFound, useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ReportsWorkspace, type ReportTab } from '@/components/reports/reports-workspace';
import { GeneralAdvancedReportsWorkspace, type GeneralAdvancedReportTab } from '@/components/reports/general-advanced-reports-workspace';

type GeneralReport =
  | { kind: 'standard'; tab: ReportTab; key: 'trialBalance' | 'incomeStatement' | 'balanceSheet' | 'costCenterProfitability' }
  | { kind: 'advanced'; tab: GeneralAdvancedReportTab; key: 'accountLedger' | 'cashFlow' | 'journalEntries' | 'taxReport' };

const GENERAL_REPORTS: Record<string, GeneralReport> = {
  'trial-balance': { kind: 'standard', tab: 'trial', key: 'trialBalance' },
  'income-statement': { kind: 'standard', tab: 'income', key: 'incomeStatement' },
  'balance-sheet': { kind: 'standard', tab: 'balance', key: 'balanceSheet' },
  'cost-center-profitability': { kind: 'standard', tab: 'costcenter', key: 'costCenterProfitability' },
  'account-ledger': { kind: 'advanced', tab: 'ledger', key: 'accountLedger' },
  'cash-flow': { kind: 'advanced', tab: 'cashflow', key: 'cashFlow' },
  'journal-entries': { kind: 'advanced', tab: 'journal', key: 'journalEntries' },
  'tax-report': { kind: 'advanced', tab: 'tax', key: 'taxReport' },
};

export default function GeneralReportPage() {
  const params = useParams<{ report: string }>();
  const t = useTranslations('reports.catalog');
  const report = GENERAL_REPORTS[params.report];

  if (!report) notFound();

  const heading = t(`reports.${report.key}.title`);
  if (report.kind === 'standard') {
    return <ReportsWorkspace initialTab={report.tab} allowedTabs={[report.tab]} heading={heading} />;
  }

  return <GeneralAdvancedReportsWorkspace tab={report.tab} heading={heading} />;
}
