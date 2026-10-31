'use client';

import { useLocale } from 'next-intl';
import { Store } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useWholesaleChannel } from '../channel-context';
import { commonMessages } from '../messages/common';

/** One-line truth about the active channel: store, deployment switch, wholesale mark, assigned price list. */
export function ChannelBar() {
  const locale = useLocale();
  const { t } = commonMessages.forLocale(locale);
  const { store, channelId, settings } = useWholesaleChannel();

  return (
    <section aria-label={t('channelLabel')} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded border border-border bg-surface px-3 py-2">
      <span className="inline-flex min-w-0 items-center gap-1.5 text-sm text-text">
        <Store aria-hidden className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.7} />
        <span className="text-xs text-muted">{t('channelLabel')}</span>
        <span className="truncate font-medium">{store?.name ?? t('channelNone')}</span>
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        {channelId === null ? (
          <Badge tone="warning">{t('channelNone')}</Badge>
        ) : settings.status === 'ready' ? (
          <>
            <Badge tone={settings.data.wholesale_deployment_enabled ? 'positive' : 'muted'}>
              {settings.data.wholesale_deployment_enabled ? t('badgeDeploymentOn') : t('badgeDeploymentOff')}
            </Badge>
            <Badge tone={settings.data.wholesale_membership_enabled ? 'positive' : 'muted'}>
              {settings.data.wholesale_membership_enabled ? t('badgeChannelMarked') : t('badgeChannelNotMarked')}
            </Badge>
            <Badge tone={settings.data.default_price_list ? 'neutral' : 'muted'}>
              {settings.data.default_price_list ? t('badgePriceList', { name: settings.data.default_price_list.name }) : t('badgeNoPriceList')}
            </Badge>
          </>
        ) : settings.status === 'error' ? (
          <Badge tone="muted">{t('badgeSettingsUnknown')}</Badge>
        ) : (
          <span className="text-xs text-muted" role="status">{t('loading')}</span>
        )}
      </div>
    </section>
  );
}
