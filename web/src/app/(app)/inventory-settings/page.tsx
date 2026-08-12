'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  Package,
  Shapes,
  Tag,
  Scale,
  Warehouse,
  ScanLine,
  ListPlus,
  ChevronLeft,
  type LucideIcon,
} from 'lucide-react';

interface Item { key: string; href: string | null; icon: LucideIcon }

/** `href: null` = قسمٌ لم يُبنَ بعد — يظهر معطّلاً بوسم «قريباً» لا يختفي. */
const ITEMS: Item[] = [
  { key: 'c_products', href: '/inventory-settings/products', icon: Package },
  { key: 'c_categories', href: '/inventory-settings/categories', icon: Shapes },
  { key: 'c_brands', href: '/inventory-settings/brands', icon: Tag },
  { key: 'c_units', href: null, icon: Scale },
  { key: 'c_employee_warehouses', href: null, icon: Warehouse },
  { key: 'c_barcode', href: null, icon: ScanLine },
  { key: 'c_fields', href: null, icon: ListPlus },
];

export default function InventorySettingsHubPage() {
  const t = useTranslations('inventorySettings');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
      </div>

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
                      {t('soon')}
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
    </div>
  );
}
