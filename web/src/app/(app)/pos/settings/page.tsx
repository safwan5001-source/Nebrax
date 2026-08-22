'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  ChevronLeft,
  Clock3,
  MonitorDown,
  Printer,
  Settings2,
  TabletSmartphone,
  type LucideIcon,
} from 'lucide-react';

interface PosSettingsItem {
  key: string;
  href: string | null;
  icon: LucideIcon;
}

const ITEMS: PosSettingsItem[] = [
  { key: 'configuration', href: '/pos/settings/configuration', icon: Settings2 },
  { key: 'shifts', href: '/pos/sessions', icon: Clock3 },
  { key: 'devices', href: '/pos/settings/devices', icon: TabletSmartphone },
  { key: 'printing', href: '/pos/settings/printing', icon: Printer },
  { key: 'desktop', href: null, icon: MonitorDown },
];

export default function PosSettingsPage() {
  const t = useTranslations('posSettings');
  const tn = useTranslations('nav');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('hub_subtitle')}</p>
      </div>

      <section className="space-y-3" aria-labelledby="pos-settings-heading">
        <h2 id="pos-settings-heading" className="text-sm font-medium text-muted">{t('group_setup')}</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ITEMS.map((item) => {
            const Icon = item.icon;
            const body = (
              <>
                <Icon className="h-6 w-6 shrink-0 text-primary" strokeWidth={1.6} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-text">{t(`c_${item.key}_t`)}</h3>
                    {!item.href && (
                      <span className="shrink-0 rounded bg-border px-1.5 py-0.5 text-[10px] font-normal text-muted">
                        {tn('soon')}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-muted">{t(`c_${item.key}_d`)}</p>
                </div>
                {item.href && <ChevronLeft className="mt-1 h-4 w-4 shrink-0 text-muted" strokeWidth={1.7} aria-hidden="true" />}
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
              <div key={item.key} className="flex gap-3 rounded border border-border bg-surface p-4 opacity-70" aria-disabled="true">
                {body}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
