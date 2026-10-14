'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Clock, Minus, Unplug, UserCheck, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  COMMUNICATION_CHANNEL_ORDER,
  PROVIDER_STATUS_ORDER,
  providersByChannel,
  type ProviderStatus,
} from '@/lib/communications-providers';
import { CHANNEL_ICONS, CommunicationProviderMark } from './communications-provider-mark';
import { IntegrationBreadcrumb } from './integration-shell';

/**
 * كتالوج مزوّدي الاتصالات (AWJ-COMMS-UX-01) — وصفٌ ثابت للاطلاع فقط، بلا شبكة ولا حالة مستأجر.
 *
 * الحالات الثلاث المعروضة للمزوّدين وصفيّة (`ProviderStatus`)، و«متصل فعلاً» تظهر في دليل المعاني
 * فقط بعبارة «لا يوجد» لأن النوع نفسه لا يسمح بها: لا شارة اتصال ولا تفعيل. لا زر ولا رابط ربط ولا
 * حقل مفتاح ولا إرسال تجريبي؛ الرابط الوحيد في الصفحة مسار التنقّل (وزر العودة حين تُرفض الصلاحية).
 */

const STATUS_VIEW: Record<ProviderStatus, { tone: 'muted' | 'neutral' | 'warning'; icon: LucideIcon }> = {
  theoretical: { tone: 'muted', icon: Minus },
  planned: { tone: 'neutral', icon: Clock },
  owner_approval: { tone: 'warning', icon: UserCheck },
};

export function CommunicationsCatalog({ allowed }: { allowed: boolean }) {
  const t = useTranslations('integrationCenter');

  return (
    <div className="space-y-4 pb-16 md:pb-0" data-testid="communications-catalog">
      <IntegrationBreadcrumb
        items={[
          { label: t('title'), href: '/integrations' },
          { label: t('communications.title') },
        ]}
      />
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-text">{t('communications.title')}</h1>
        <p className="max-w-3xl text-sm leading-relaxed text-muted">{t('communications.subtitle')}</p>
      </header>

      {!allowed ? (
        <div
          className="space-y-2 rounded-md border border-dashed border-border bg-surface p-4"
          data-testid="communications-restricted"
        >
          <p role="note" className="text-sm leading-relaxed text-text">{t('communications.denied')}</p>
          <Link
            href="/integrations"
            className="inline-block text-sm font-medium text-primary hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {t('backToCenter')}
          </Link>
        </div>
      ) : (
        <>
          <p
            role="note"
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm leading-relaxed text-text"
            data-testid="communications-truth-note"
          >
            {t('communications.truthNote')}
          </p>

          <section aria-labelledby="comms-legend" className="space-y-3 rounded-md border border-border bg-surface p-4" data-testid="communications-legend">
            <h2 id="comms-legend" className="text-sm font-semibold text-text">{t('communications.legend.title')}</h2>
            <div className="space-y-1.5" data-testid="communications-legend-future">
              <h3 className="text-xs font-semibold text-muted">{t('communications.legend.futureTitle')}</h3>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm md:grid-cols-3">
                {PROVIDER_STATUS_ORDER.map((status) => (
                  <div key={status} className="space-y-0.5">
                    <dt className="font-medium text-text">{t(`communications.status.${status}.label`)}</dt>
                    <dd className="text-xs leading-relaxed text-muted">{t(`communications.status.${status}.description`)}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="space-y-1.5 border-t border-border pt-3" data-testid="communications-legend-connected">
              <h3 className="text-xs font-semibold text-muted">{t('communications.legend.actualTitle')}</h3>
              <dl className="text-sm">
                <dt className="font-medium text-text">{t('communications.legend.connected.label')}</dt>
                <dd className="text-xs leading-relaxed text-muted">{t('communications.legend.connected.description')}</dd>
              </dl>
            </div>
          </section>

          {COMMUNICATION_CHANNEL_ORDER.map((channel) => {
            const ChannelIcon = CHANNEL_ICONS[channel];
            const headingId = `comms-channel-${channel}`;
            return (
              <section key={channel} aria-labelledby={headingId} className="space-y-2" data-channel={channel}>
                <h2 id={headingId} className="flex items-center gap-2 text-base font-semibold text-text">
                  <ChannelIcon className="h-5 w-5 text-muted" strokeWidth={1.6} aria-hidden="true" />
                  {t(`communications.channels.${channel}`)}
                </h2>
                <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" role="list">
                  {providersByChannel(channel).map((provider) => {
                    const view = STATUS_VIEW[provider.status];
                    const StatusIcon = view.icon;
                    return (
                      <li
                        key={provider.key}
                        className="flex flex-col gap-2 rounded-md border border-border bg-surface p-4"
                        data-testid={`communications-provider-${provider.key}`}
                        data-status={provider.status}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <CommunicationProviderMark provider={provider} />
                          <bdi className="min-w-0 break-words text-sm font-semibold text-text">{provider.name}</bdi>
                        </div>
                        <p className="text-xs text-muted">
                          {t('communications.vendor')}: <bdi>{provider.vendor}</bdi>
                        </p>
                        <div>
                          <Badge tone={view.tone} wrap>
                            <StatusIcon className="h-3 w-3" aria-hidden="true" />
                            {t(`communications.status.${provider.status}.label`)}
                          </Badge>
                        </div>
                        <p className="text-xs leading-relaxed text-muted">
                          {t(`communications.status.${provider.status}.description`)}
                        </p>
                        <p
                          className="mt-auto flex items-center gap-1 border-t border-border pt-2 text-xs font-medium text-muted"
                          data-testid={`communications-not-connected-${provider.key}`}
                        >
                          <Unplug className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          {t('communications.notConnected')}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}

          <p className="text-xs leading-relaxed text-muted" data-testid="communications-boundary">
            {t('communications.boundary')}
          </p>
          <p className="text-xs leading-relaxed text-muted" data-testid="communications-logo-note">
            {t('communications.logoNote')}
          </p>
        </>
      )}
    </div>
  );
}
