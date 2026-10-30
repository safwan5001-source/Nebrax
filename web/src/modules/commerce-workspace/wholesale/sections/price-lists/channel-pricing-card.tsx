'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import { FormAlert } from '@/components/nebrax';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { useCan } from '@/lib/use-can';
import { useWholesaleChannel } from '../../channel-context';
import { errorReason } from '../../use-resource';
import { assignChannelPriceList, type PriceList } from './api';
import { priceListsMessages, type PriceListsMessageKey } from './messages';

const KNOWN_REASONS = ['price_list_inactive', 'price_list_not_found', 'channel_not_web', 'not_found'];

/** Assign / clear the channel default list. The only field ever written is `default_price_list_id`. */
export function ChannelPricingCard({ lists }: { lists: PriceList[] }) {
  const locale = useLocale();
  const { t } = priceListsMessages.forLocale(locale);
  const toast = useToast();
  const { can } = useCan();
  const { channelId, settings, applySettings } = useWholesaleChannel();
  const canAssign = can('commerce.channel_settings.manage');
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = settings.status === 'ready' ? settings.data.default_price_list : null;
  const currentFull = current ? lists.find((list) => list.id === current.id) : undefined;
  const currentActive = current ? (currentFull?.is_active ?? current.is_active) : true;
  const activeLists = lists.filter((list) => list.is_active);

  async function write(next: string | null) {
    if (busy || !channelId) return;
    setBusy(true);
    setError(null);
    try {
      applySettings(await assignChannelPriceList(channelId, next));
      setChoice('');
      toast.success(t(next ? 'channelAssigned' : 'channelCleared'));
    } catch (failure) {
      const reason = errorReason(failure);
      setError(t(reason && KNOWN_REASONS.includes(reason) ? (`err.${reason}` as PriceListsMessageKey) : 'err.generic'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label={t('channelTitle')} className="space-y-3 rounded border border-border bg-surface p-3">
      <h2 className="text-sm font-medium text-text">{t('channelTitle')}</h2>
      {settings.status === 'loading' ? (
        <p className="text-sm text-muted" role="status">…</p>
      ) : settings.status === 'error' ? (
        <p className="text-sm text-muted">{t('channelSettingsUnknown')}</p>
      ) : (
        <>
          <p className="text-sm text-text">
            <span className="text-xs text-muted">{t('channelCurrent')}: </span>
            {current ? (
              <>
                <bdi className="font-medium">{current.name}</bdi>{' '}
                <Badge tone={currentActive ? 'positive' : 'warning'}>{currentActive ? t('active') : t('inactive')}</Badge>
              </>
            ) : (
              <span className="text-muted">{t('channelNone')}</span>
            )}
          </p>
          {current && !currentActive ? <FormAlert tone="warning">{t('channelInactiveWarn')}</FormAlert> : null}
          {canAssign ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Select aria-label={t('channelPick')} value={choice} onChange={(event) => setChoice(event.target.value)} className="sm:max-w-xs" disabled={busy}>
                <option value="">{t('channelPick')}</option>
                {activeLists.map((list) => (
                  <option key={list.id} value={list.id}>{list.name}</option>
                ))}
              </Select>
              <Button type="button" className="min-h-11" disabled={busy || choice === '' || choice === current?.id} onClick={() => void write(choice)}>
                {t('channelAssign')}
              </Button>
              {current ? (
                <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => void write(null)}>
                  {t('channelClear')}
                </Button>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-muted">{t('channelNoPermission')}</p>
          )}
          {error ? <FormAlert tone="error">{error}</FormAlert> : null}
        </>
      )}
    </section>
  );
}
