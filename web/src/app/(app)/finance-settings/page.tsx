'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  Banknote,
  ChevronLeft,
  HandCoins,
  ReceiptText,
  Tags,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';

interface FinanceSettingItem {
  key: string;
  href: string | null;
  icon: LucideIcon;
}

const ITEMS: FinanceSettingItem[] = [
  { key: 'c_expenseCategories', href: '/expenses/categories', icon: Tags },
  { key: 'c_incomeCategories', href: null, icon: Banknote },
  { key: 'c_voucherSettings', href: null, icon: ReceiptText },
  { key: 'c_employeeCashboxes', href: null, icon: WalletCards },
  { key: 'c_settlementTypes', href: '/finance-settings/settlement-types', icon: HandCoins },
];

export default function FinanceSettingsPage() {
  const t = useTranslations('financeSettings');
  const tn = useTranslations('nav');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('hubSubtitle')}</p>
      </div>

      <section className="space-y-3" aria-labelledby="finance-settings-heading">
        <h2 id="finance-settings-heading" className="text-sm font-medium text-muted">{t('groupSetup')}</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ITEMS.map((item) => {
            const Icon = item.icon;
            const body = (
              <>
                <Icon className="h-6 w-6 shrink-0 text-primary" strokeWidth={1.6} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-text">{t(`${item.key}_t`)}</h3>
                    {!item.href && (
                      <span className="shrink-0 rounded bg-border px-1.5 py-0.5 text-[10px] font-normal text-muted">
                        {tn('soon')}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-muted">{t(`${item.key}_d`)}</p>
                </div>
                {item.href && <ChevronLeft className="mt-1 h-4 w-4 shrink-0 text-muted" strokeWidth={1.7} />}
              </>
            );

            return item.href ? (
              <Link
                key={item.key}
                href={item.href}
                className="flex gap-3 rounded border border-border bg-surface p-4 transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                {body}
              </Link>
            ) : (
              <div key={item.key} className="flex gap-3 rounded border border-border bg-surface p-4 opacity-70">
                {body}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
