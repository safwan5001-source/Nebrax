'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { Globe, Gift, MapPin, Paintbrush, Plug, Settings2, Truck, UserRound, type LucideIcon } from 'lucide-react';
import { EmptyState, PageHeader } from '@/components/nebrax';
import { hiddenApplicationKeys } from '@/components/layout/nav-visibility';
import { api } from '@/lib/api';
import { currentUser } from '@/lib/auth';
import { withStoreParam } from '../active-store';
import { commerceWorkspaceMessage, type CommerceWorkspaceMessageKey } from '../messages';
import { useOptionalCommerceStoreContext } from '../store-context';
import { visibleSettingsSections } from './sections';

const ICONS: Record<string, LucideIcon> = {
  '/commerce/appearance': Paintbrush,
  '/commerce/domains': Globe,
  '/commerce/delivery': Truck,
  '/commerce/shipping-zones': MapPin,
  '/commerce/customer-accounts': UserRound,
  '/commerce/gifting': Gift,
  '/commerce/integrations': Plug,
};

/**
 * COPS-H4-1 — مركز إعدادات المتجر. بطاقات روابط فقط (لا نموذج، لا كتابة). حالة القدرات من `GET /applications/nav-state`
 * نفسه الذي يقرؤه الشريط الجانبي؛ فشله لا يُخفي شيئاً (كالشريط) لأن مسارات الخادم محروسة على أي حال. لا تُعرض بطاقات
 * قبل انتهاء الجلب كي لا تومض بطاقة قدرة معطَّلة.
 */
export function SettingsHub() {
  const locale = useLocale();
  const t = (key: CommerceWorkspaceMessageKey) => commerceWorkspaceMessage(locale, key);
  const storeId = useOptionalCommerceStoreContext()?.selectedStoreId ?? null;
  const [hiddenAppKeys, setHiddenAppKeys] = useState<Set<string> | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ data: Record<string, boolean> }>('/applications/nav-state')
      .then((res) => {
        if (cancelled) return;
        setHiddenAppKeys(Array.isArray(res.data) ? new Set() : hiddenApplicationKeys(res.data));
      })
      .catch(() => {
        if (!cancelled) setHiddenAppKeys(new Set());
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const sections = hiddenAppKeys ? visibleSettingsSections(hiddenAppKeys, currentUser()) : [];

  return (
    <div className="space-y-5">
      <PageHeader eyebrow={t('title')} title={t('settingsHub')} description={t('settingsHubDescription')} />
      {hiddenAppKeys === null ? (
        <p role="status" className="text-sm text-muted">
          {t('settingsHubLoading')}
        </p>
      ) : sections.length === 0 ? (
        <EmptyState icon={Settings2} title={t('settingsHubEmpty')} surface="panel" />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sections.map((section) => {
            const Icon = ICONS[section.href] ?? Settings2;

            return (
              <li key={section.href}>
                <Link
                  href={withStoreParam(section.href, storeId)}
                  className="flex h-full min-h-11 items-start gap-3 rounded border border-border bg-surface p-4 transition-colors hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-text">{t(section.labelKey)}</span>
                    <span className="mt-1 block text-sm text-muted">{t(section.descriptionKey)}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
