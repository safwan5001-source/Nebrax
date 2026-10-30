'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import { ShieldAlert, TriangleAlert } from 'lucide-react';
import { EmptyState, ErrorState, LoadingState } from '@/components/nebrax';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { formatDateTime } from '@/lib/formatting';
import { withStoreParam } from '@/modules/commerce-workspace/active-store';
import { updateChannelSettings, type ChannelSettingChange, type ChannelSettings } from '../../channel';
import { useWholesaleChannel } from '../../channel-context';
import { WHOLESALE_BASE } from '../../nav';
import { errorReason } from '../../use-resource';
import { settingsMessages, type SettingsMessageKey } from './messages';

/** Server rejection → message key. `reason` codes come from `SalesChannelSettingsException`. */
export function saveErrorKey(error: unknown): SettingsMessageKey {
  const reason = errorReason(error);
  if (reason === 'wholesale_deployment_disabled') return 'error.wholesale_deployment_disabled';
  if (reason === 'channel_not_web') return 'error.channel_not_web';
  const status = typeof error === 'object' && error !== null && 'status' in error ? (error as { status?: unknown }).status : undefined;
  if (status === 404 || reason === 'not_found') return 'error.not_found';
  return 'error.generic';
}

/** Channel configuration: deployment switch (read-only), wholesale mark (confirmed write), price list (read-only), audit. */
export function ChannelConfig() {
  const locale = useLocale();
  const { t } = settingsMessages.forLocale(locale);
  const { store, channelId, settings, reloadSettings } = useWholesaleChannel();

  return (
    <section aria-labelledby="ws-channel-title" className="space-y-3">
      <div>
        <h2 id="ws-channel-title" className="text-base font-semibold text-text">{t('channelTitle')}</h2>
        <p className="text-sm text-muted">{t('channelHint', { store: store?.name ?? '—' })}</p>
      </div>
      {settings.status === 'loading' ? (
        <LoadingState variant="cards" rows={2} />
      ) : settings.status === 'error' ? (
        settings.kind === 'forbidden' ? (
          <EmptyState icon={ShieldAlert} title={t('channelForbidden')} />
        ) : (
          <ErrorState message={t('channelLoadError')} onRetry={reloadSettings} />
        )
      ) : channelId ? (
        <ChannelCard channelId={channelId} data={settings.data} storeId={store?.id ?? null} />
      ) : null}
    </section>
  );
}

function ChannelCard({ channelId, data, storeId }: { channelId: string; data: ChannelSettings; storeId: string | null }) {
  const locale = useLocale();
  const { t } = settingsMessages.forLocale(locale);
  const { applySettings } = useWholesaleChannel();
  const { success: toastSuccess } = useToast();
  const [pending, setPending] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const marked = data.wholesale_membership_enabled;
  const deploymentOn = data.wholesale_deployment_enabled;
  // Turning ON is impossible (server 409) while the deployment switch is off; turning OFF is always allowed.
  const blockedOn = !marked && !deploymentOn;

  async function confirm() {
    if (pending === null || saving) return;
    setSaving(true);
    setError(null);
    try {
      const next = await updateChannelSettings(channelId, { wholesale_membership_enabled: pending });
      applySettings(next);
      toastSuccess(t('saveOk'));
      setPending(null);
    } catch (caught) {
      setError(t(saveErrorKey(caught)));
    } finally {
      setSaving(false);
    }
  }

  const close = () => {
    if (saving) return;
    setPending(null);
    setError(null);
  };

  return (
    <div className="divide-y divide-border rounded border border-border bg-surface">
      <div className="flex flex-col gap-1 p-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium text-text">{t('deploymentLabel')}</p>
          <p className="text-xs leading-relaxed text-muted">{t('deploymentHint')}</p>
        </div>
        <Badge tone={deploymentOn ? 'positive' : 'muted'} className="self-start">{deploymentOn ? t('deploymentOn') : t('deploymentOff')}</Badge>
      </div>

      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0 space-y-1">
          <p id="ws-mark-label" className="text-sm font-medium text-text">{t('markLabel')}</p>
          <p id="ws-mark-hint" className="text-xs leading-relaxed text-muted">{t('markHint')}</p>
          {blockedOn ? <p className="text-xs font-medium text-warning" role="note">{t('markBlockedDeployment')}</p> : null}
        </div>
        <div className="flex min-h-11 shrink-0 items-center gap-2">
          <span className="text-xs text-muted">{marked ? t('markOn') : t('markOff')}</span>
          <Switch
            checked={marked}
            disabled={blockedOn || saving}
            aria-labelledby="ws-mark-label"
            onCheckedChange={(next) => {
              setError(null);
              setPending(next);
            }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium text-text">{t('priceListLabel')}</p>
          {data.default_price_list ? (
            <p className="flex flex-wrap items-center gap-2 text-sm text-text">
              {data.default_price_list.name}
              {data.default_price_list.is_active ? null : <Badge tone="warning">{t('priceListInactive')}</Badge>}
            </p>
          ) : (
            <p className="text-sm text-muted">{t('priceListNone')}</p>
          )}
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={withStoreParam(`${WHOLESALE_BASE}/price-lists`, storeId)}>{t('priceListManage')}</Link>
        </Button>
      </div>

      <AuditTrail changes={data.recent_changes ?? []} />

      <Dialog open={pending !== null} onClose={close} title={pending ? t('confirmOnTitle') : t('confirmOffTitle')} closeLabel={t('confirmClose')}>
        <div className="space-y-3">
          {pending ? (
            <>
              <p className="flex items-start gap-2 text-sm leading-relaxed text-text">
                <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-warning" strokeWidth={1.7} />
                {t('confirmOnBody')}
              </p>
              <ul className="list-disc space-y-1 ps-5 text-sm text-muted">
                <li>{t('confirmOnPoint1')}</li>
                <li>{t('confirmOnPoint2')}</li>
                <li>{t('confirmOnPoint3')}</li>
              </ul>
            </>
          ) : (
            <p className="text-sm leading-relaxed text-text">{t('confirmOffBody')}</p>
          )}
          {error ? (
            <p role="alert" className="text-sm text-negative">{error}</p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={close} disabled={saving}>{t('confirmCancel')}</Button>
            <Button type="button" onClick={confirm} disabled={saving} aria-busy={saving}>
              {pending ? t('confirmOnAction') : t('confirmOffAction')}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function changeText(
  key: string,
  change: { from: unknown; to: unknown },
  t: (key: SettingsMessageKey) => string,
): string {
  if (key === 'wholesale_membership_enabled') {
    return `${change.from === true ? t('auditOn') : t('auditOffValue')} → ${change.to === true ? t('auditOn') : t('auditOffValue')}`;
  }
  if (key === 'default_price_list_id') {
    if (change.from == null && change.to != null) return t('auditAssigned');
    if (change.from != null && change.to == null) return t('auditCleared');
    return t('auditChanged');
  }
  return key;
}

function AuditTrail({ changes }: { changes: ChannelSettingChange[] }) {
  const locale = useLocale();
  const { t, label } = settingsMessages.forLocale(locale);

  return (
    <div className="space-y-2 p-4">
      <h3 className="text-sm font-medium text-text">{t('auditTitle')}</h3>
      {changes.length === 0 ? (
        <p className="text-sm text-muted">{t('auditEmpty')}</p>
      ) : (
        <ul className="space-y-2">
          {changes.map((event, index) => (
            <li key={`${event.at ?? 'x'}-${index}`} className="rounded border border-border p-2 text-sm" data-testid="audit-event">
              <p className="text-xs text-muted">
                <span className="num">{formatDateTime(event.at, locale)}</span>
                {' · '}
                {t('auditBy', { name: event.actor?.name ?? t('auditUnknownActor') })}
              </p>
              <ul className="mt-1 space-y-0.5">
                {Object.entries(event.changes ?? {}).map(([key, change]) => (
                  <li key={key} className="text-text">
                    <span className="text-muted">{label('auditKey', key)}: </span>
                    {changeText(key, change, t)}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
