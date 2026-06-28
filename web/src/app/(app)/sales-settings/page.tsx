'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  FileText,
  ListChecks,
  QrCode,
  LayoutTemplate,
  ListPlus,
  Tags,
  Tag,
  Truck,
  ClipboardList,
  ShoppingCart,
  ChevronLeft,
  type LucideIcon,
} from 'lucide-react';

interface Item { key: string; href: string | null; icon: LucideIcon }
interface Group { title: string; items: Item[] }

const GROUPS: Group[] = [
  {
    title: 'g_invoices',
    items: [
      { key: 'c_invoices', href: '/sales-settings/invoices', icon: FileText },
      { key: 'c_statuses', href: null, icon: ListChecks },
      { key: 'c_einvoice', href: null, icon: QrCode },
      { key: 'c_designs', href: null, icon: LayoutTemplate },
      { key: 'c_fields', href: null, icon: ListPlus },
      { key: 'c_pricelists', href: null, icon: Tags },
      { key: 'c_sources', href: null, icon: Tag },
      { key: 'c_shipping', href: null, icon: Truck },
    ],
  },
  {
    title: 'g_quotes',
    items: [{ key: 'c_quotes', href: '/sales-settings/quotes', icon: ClipboardList }],
  },
  {
    title: 'g_orders',
    items: [{ key: 'c_orders', href: null, icon: ShoppingCart }],
  },
];

export default function SalesSettingsHubPage() {
  const t = useTranslations('salesSettings');
  const tn = useTranslations('nav');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('hub_subtitle')}</p>
      </div>

      {GROUPS.map((group) => (
        <section key={group.title} className="space-y-3">
          <h2 className="text-sm font-medium text-muted">{t(group.title)}</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {group.items.map((item) => {
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
                  className="flex gap-3 rounded border border-border bg-surface p-4 transition-colors hover:border-primary"
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
      ))}
    </div>
  );
}
