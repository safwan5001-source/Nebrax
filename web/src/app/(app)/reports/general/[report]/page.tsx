'use client';

import { notFound, useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ReportsWorkspace, type ReportTab } from '@/components/reports/reports-workspace';

const GENERAL_REPORTS: Record<string, ReportTab> = {
  'trial-balance': 'trial',
  'income-statement': 'income',
  'balance-sheet': 'balance',
  'cost-center-profitability': 'costcenter',
};

const REPORT_KEYS: Record<ReportTab, string> = {
  trial: 'trialBalance',
  income: 'incomeStatement',
  balance: 'balanceSheet',
  costcenter: 'costCenterProfitability',
  aging: 'aging',
};

export default function GeneralReportPage() {
  const params = useParams<{ report: string }>();
  const t = useTranslations('reports.catalog');
  const tab = GENERAL_REPORTS[params.report];

  if (!tab) {
    notFound();
  }

  return <ReportsWorkspace initialTab={tab} allowedTabs={[tab]} heading={t(`reports.${REPORT_KEYS[tab]}.title`)} />;
}
