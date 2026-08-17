'use client';

import Link from 'next/link';
import { notFound, useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Boxes,
  CalendarDays,
  ClipboardList,
  Contact,
  FileSpreadsheet,
  Landmark,
  Package,
  Receipt,
  Scale,
  ShoppingCart,
  type LucideIcon,
  Users,
  WalletCards,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export const REPORT_CATEGORY_SLUGS = [
  'sales',
  'purchases',
  'general',
  'customers',
  'inventory',
] as const;

export type ReportCategorySlug = (typeof REPORT_CATEGORY_SLUGS)[number];
type ReportStatus = 'ready' | 'soon';

interface ReportDefinition {
  key: string;
  href?: string;
  icon: LucideIcon;
  status: ReportStatus;
}

interface ReportCategoryDefinition {
  slug: ReportCategorySlug;
  icon: LucideIcon;
  reports: ReportDefinition[];
}

const REPORT_CATEGORIES: ReportCategoryDefinition[] = [
  {
    slug: 'sales',
    icon: BarChart3,
    reports: [
      { key: 'posSession', href: '/pos/report', icon: Receipt, status: 'ready' },
      { key: 'salesByPeriod', href: '/reports/sales/by-period', icon: CalendarDays, status: 'ready' },
      { key: 'salesByCustomer', href: '/reports/sales/by-customer', icon: Users, status: 'ready' },
      { key: 'salesByProduct', href: '/reports/sales/by-product', icon: Package, status: 'ready' },
      { key: 'salesByRepresentative', href: '/reports/sales/by-salesperson', icon: Contact, status: 'ready' },
      { key: 'salesProfitability', href: '/reports/sales/profitability', icon: Scale, status: 'ready' },
      { key: 'salesPaymentsByPeriod', href: '/reports/sales/payments', icon: WalletCards, status: 'ready' },
    ],
  },
  {
    slug: 'purchases',
    icon: ShoppingCart,
    reports: [
      { key: 'supplierAging', href: '/reports/purchases/aging', icon: CalendarDays, status: 'ready' },
      { key: 'supplierStatement', href: '/suppliers', icon: BookOpen, status: 'ready' },
      { key: 'purchasesByPeriod', href: '/reports/purchases/by-period', icon: BarChart3, status: 'ready' },
      { key: 'purchasesBySupplier', href: '/reports/purchases/by-supplier', icon: Users, status: 'ready' },
      { key: 'purchasesByProduct', href: '/reports/purchases/by-product', icon: Package, status: 'ready' },
      { key: 'purchasesByEmployee', href: '/reports/purchases/by-employee', icon: Contact, status: 'ready' },
      { key: 'supplierBalances', href: '/reports/purchases/balances', icon: WalletCards, status: 'ready' },
      { key: 'supplierPaymentsByPeriod', href: '/reports/purchases/payments', icon: CalendarDays, status: 'ready' },
    ],
  },
  {
    slug: 'general',
    icon: Landmark,
    reports: [
      { key: 'trialBalance', href: '/reports/general/trial-balance', icon: Scale, status: 'ready' },
      { key: 'incomeStatement', href: '/reports/general/income-statement', icon: FileSpreadsheet, status: 'ready' },
      { key: 'balanceSheet', href: '/reports/general/balance-sheet', icon: Landmark, status: 'ready' },
      { key: 'costCenterProfitability', href: '/reports/general/cost-center-profitability', icon: BarChart3, status: 'ready' },
      { key: 'accountLedger', href: '/reports/general/account-ledger', icon: BookOpen, status: 'ready' },
      { key: 'cashFlow', href: '/reports/general/cash-flow', icon: WalletCards, status: 'ready' },
      { key: 'journalEntries', href: '/reports/general/journal-entries', icon: ClipboardList, status: 'ready' },
      { key: 'taxReport', href: '/reports/general/tax-report', icon: Receipt, status: 'ready' },
    ],
  },
  {
    slug: 'customers',
    icon: Users,
    reports: [
      { key: 'customerAging', href: '/reports/customers/aging', icon: CalendarDays, status: 'ready' },
      { key: 'customerStatement', href: '/partners', icon: BookOpen, status: 'ready' },
      { key: 'customerDirectory', href: '/partners', icon: Users, status: 'ready' },
      { key: 'customerBalances', icon: WalletCards, status: 'soon' },
      { key: 'customerSales', icon: BarChart3, status: 'soon' },
      { key: 'customerPayments', icon: Receipt, status: 'soon' },
      { key: 'customerAppointments', icon: CalendarDays, status: 'soon' },
    ],
  },
  {
    slug: 'inventory',
    icon: Boxes,
    reports: [
      { key: 'stockBalances', href: '/inventory', icon: Boxes, status: 'ready' },
      { key: 'productMovements', href: '/inventory', icon: ClipboardList, status: 'ready' },
      { key: 'stockCount', href: '/stocktaking', icon: ClipboardList, status: 'ready' },
      { key: 'inventoryValue', icon: WalletCards, status: 'soon' },
      { key: 'inventoryOperations', icon: BarChart3, status: 'soon' },
      { key: 'warehouseBalances', icon: Package, status: 'soon' },
      { key: 'inventoryAging', icon: CalendarDays, status: 'soon' },
      { key: 'inventoryTurnover', icon: Scale, status: 'soon' },
    ],
  },
];

function isReportCategorySlug(value: string): value is ReportCategorySlug {
  return REPORT_CATEGORY_SLUGS.some((slug) => slug === value);
}

function categoryBySlug(slug: ReportCategorySlug) {
  return REPORT_CATEGORIES.find((category) => category.slug === slug);
}

function ReportCard({ report }: { report: ReportDefinition }) {
  const t = useTranslations('reports.catalog');
  const Icon = report.icon;
  const card = (
    <Card
      className={cn(
        'h-full transition-colors',
        report.status === 'ready' && 'group-hover:border-primary/40 group-hover:bg-primary-soft/30'
      )}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-3 p-4 pb-2">
        <div className="min-w-0">
          <CardTitle className="text-base font-semibold text-text">{t(`reports.${report.key}.title`)}</CardTitle>
          <p className="mt-1 text-sm leading-6 text-muted">{t(`reports.${report.key}.description`)}</p>
        </div>
        <Icon aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-muted" strokeWidth={1.7} />
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-3 p-4 pt-2">
        <Badge tone={report.status === 'ready' ? 'neutral' : 'muted'}>
          {report.status === 'ready' ? t('available') : t('soon')}
        </Badge>
        {report.status === 'ready' ? (
          <span className="inline-flex items-center gap-1 text-sm font-medium text-primary">
            {t('open')}
            <ArrowRight className="h-4 w-4 rtl:rotate-180" strokeWidth={1.7} />
          </span>
        ) : (
          <span className="text-xs text-muted">{t('soonHint')}</span>
        )}
      </CardContent>
    </Card>
  );

  if (report.status !== 'ready' || !report.href) {
    return card;
  }

  return (
    <Link
      href={report.href}
      className="group block rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      {card}
    </Link>
  );
}

export function ReportsCatalog() {
  const t = useTranslations('reports.catalog');

  return (
    <div className="space-y-6">
      <header className="max-w-3xl">
        <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
        <p className="mt-1 text-sm leading-6 text-muted">{t('description')}</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {REPORT_CATEGORIES.map((category) => {
          const Icon = category.icon;
          const available = category.reports.filter((report) => report.status === 'ready').length;

          return (
            <Link
              key={category.slug}
              href={`/reports/${category.slug}`}
              className="group block rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <Card className="h-full transition-colors group-hover:border-primary/40 group-hover:bg-primary-soft/30">
                <CardHeader className="flex flex-row items-start justify-between gap-3 p-4">
                  <div>
                    <CardTitle className="text-base font-semibold text-text">{t(`categories.${category.slug}.title`)}</CardTitle>
                    <p className="mt-1 text-sm leading-6 text-muted">{t(`categories.${category.slug}.description`)}</p>
                  </div>
                  <Icon aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-muted" strokeWidth={1.7} />
                </CardHeader>
                <CardContent className="flex items-center justify-between gap-3 border-t border-border p-4">
                  <span className="text-sm text-muted">{t('reportCount', { total: category.reports.length, available })}</span>
                  <ArrowRight className="h-4 w-4 text-primary rtl:rotate-180" strokeWidth={1.7} />
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export function ReportCategoryPage() {
  const params = useParams<{ category: string }>();
  const t = useTranslations('reports.catalog');
  const slug = params.category;

  if (!isReportCategorySlug(slug)) {
    notFound();
  }

  const category = categoryBySlug(slug);
  if (!category) {
    notFound();
  }

  const Icon = category.icon;

  return (
    <div className="space-y-6">
      <header className="max-w-3xl">
        <Link
          href="/reports"
          className="inline-flex items-center gap-1 text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <ArrowRight className="h-4 w-4 rtl:rotate-180" strokeWidth={1.7} />
          {t('backToReports')}
        </Link>
        <div className="mt-3 flex items-start gap-3">
          <Icon aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-muted" strokeWidth={1.7} />
          <div>
            <h1 className="text-xl font-semibold text-text">{t(`categories.${category.slug}.title`)}</h1>
            <p className="mt-1 text-sm leading-6 text-muted">{t(`categories.${category.slug}.description`)}</p>
          </div>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        {category.reports.map((report) => <ReportCard key={report.key} report={report} />)}
      </div>
    </div>
  );
}
