'use client';

import { useCallback, useState } from 'react';
import { useLocale } from 'next-intl';
import { Info, ShieldAlert, Store as StoreIcon } from 'lucide-react';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/nebrax';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { formatDateTime } from '@/lib/formatting';
import { useCan } from '@/lib/use-can';
import { cn } from '@/lib/utils';
import { StoreGate } from '../flowers-admin/store-gate';
import { useUnsavedGuard } from '../flowers-admin/use-unsaved-guard';
import type { CommerceStoreOption } from '../stores';
import { classifyError, errorReason, useResource } from '../wholesale/use-resource';
import {
  deriveStatus,
  fetchCustomerAccountSettings,
  isCustomerAccountSettings,
  saveCustomerAccountsEnabled,
  type CustomerAccountSettings,
  type CustomerAccountsStatus,
} from './api';
import { customerAccountsMessages, type CustomerAccountsMessageKey } from './messages';

/** Server rejection → message key. `reason` codes come from `SalesChannelSettingsException`. */
export function saveErrorKey(error: unknown): CustomerAccountsMessageKey {
  const reason = errorReason(error);
  if (reason === 'customer_accounts_deployment_disabled') return 'error.customer_accounts_deployment_disabled';
  if (reason === 'channel_not_web') return 'error.channel_not_web';
  const kind = classifyError(error);
  if (kind === 'forbidden') return 'error.forbidden';
  if (kind === 'not_found') return 'error.not_found';
  return 'error.generic';
}

const STATUS_TONE: Record<CustomerAccountsStatus, 'positive' | 'muted' | 'warning'> = {
  active: 'positive',
  inactive: 'muted',
  gated_on: 'warning',
  gated_off: 'muted',
};

/**
 * Commerce → Store settings → Customer accounts. Permission-gated first (nothing is requested without
 * `commerce.channel_settings.manage`), then resolved to the selected store; the panel is keyed by store so a store
 * switch always starts clean and a draft for one channel can never be saved onto another.
 */
export function CustomerAccountsScreen() {
  const locale = useLocale();
  const { t } = customerAccountsMessages.forLocale(locale);
  const { can, hydrated } = useCan();

  let body;
  if (!hydrated) {
    body = <LoadingState variant="cards" rows={2} label={t('loading')} />;
  } else if (!can('commerce.channel_settings.manage')) {
    body = <EmptyState icon={ShieldAlert} title={t('forbiddenTitle')} description={t('forbiddenBody')} />;
  } else {
    body = <StoreGate>{(store) => <CustomerAccountsPanel key={store.id} store={store} />}</StoreGate>;
  }

  return (
    <div className="space-y-4">
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />
      {body}
    </div>
  );
}

export function CustomerAccountsPanel({ store }: { store: CommerceStoreOption }) {
  const locale = useLocale();
  const { t } = customerAccountsMessages.forLocale(locale);
  const channelId = store.salesChannelId;

  if (!channelId) {
    return <EmptyState icon={StoreIcon} title={t('noChannelTitle')} description={t('noChannelBody')} />;
  }

  return <ChannelAccountsCard store={store} channelId={channelId} />;
}

function ChannelAccountsCard({ store, channelId }: { store: CommerceStoreOption; channelId: string }) {
  const locale = useLocale();
  const { t } = customerAccountsMessages.forLocale(locale);
  const { success: toastSuccess } = useToast();

  const { state, reload } = useResource<CustomerAccountSettings>(async () => {
    const data = await fetchCustomerAccountSettings(channelId);
    if (!isCustomerAccountSettings(data)) throw new Error('invalid_settings_payload');
    return data;
  }, [channelId]);

  // Server-confirmed snapshot after a write; supersedes the initial read without another round-trip.
  const [held, setHeld] = useState<CustomerAccountSettings | null>(null);
  // The viewer's unsaved choice. `null` = untouched. It is never treated as persisted state.
  const [draft, setDraft] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const persisted = held ?? (state.status === 'ready' ? state.data : null);
  const dirty = persisted !== null && draft !== null && draft !== persisted.customer_accounts_enabled;
  useUnsavedGuard(dirty);

  const onToggle = useCallback(
    (next: boolean) => {
      if (!persisted) return;
      setError(null);
      setDraft(next === persisted.customer_accounts_enabled ? null : next);
    },
    [persisted],
  );

  const discard = () => {
    if (saving) return;
    setDraft(null);
    setError(null);
  };

  async function save() {
    if (!persisted || draft === null || saving) return;
    setSaving(true);
    setError(null);
    try {
      const next = await saveCustomerAccountsEnabled(channelId, draft);
      // Success is reported only when the server echoes the persisted value we asked for, for this channel.
      if (!isCustomerAccountSettings(next) || next.id !== channelId || next.customer_accounts_enabled !== draft) {
        setError(t('saveNotConfirmed'));
        return;
      }
      setHeld(next);
      setDraft(null);
      toastSuccess(t('saveOk'));
    } catch (caught) {
      setError(t(saveErrorKey(caught)));
      if (errorReason(caught) === 'customer_accounts_deployment_disabled') {
        // The gate state changed under us: re-read the real values so the screen stops offering the switch.
        void fetchCustomerAccountSettings(channelId).then(
          (fresh) => {
            if (isCustomerAccountSettings(fresh)) setHeld(fresh);
          },
          () => {},
        );
      }
    } finally {
      setSaving(false);
    }
  }

  if (state.status === 'loading' && !held) return <LoadingState variant="cards" rows={2} label={t('loading')} />;
  if (!persisted) {
    if (state.status === 'error' && state.kind === 'forbidden') {
      return <EmptyState icon={ShieldAlert} title={t('forbiddenTitle')} description={t('forbiddenBody')} />;
    }
    if (state.status === 'error' && state.kind === 'not_found') {
      return <ErrorState message={t('notFound')} />;
    }
    return <ErrorState message={t('loadError')} onRetry={reload} />;
  }

  const status = deriveStatus(persisted);
  const deploymentOn = persisted.customer_accounts_deployment_enabled;
  const shown = draft ?? persisted.customer_accounts_enabled;
  // Turning ON is impossible (server 409) while the deployment gate is closed; turning OFF is always allowed.
  const blockedOn = !persisted.customer_accounts_enabled && !deploymentOn;
  const lastChange = (persisted.recent_changes ?? []).find((event) => event.changes && 'customer_accounts_enabled' in event.changes);
  // A wholesale-marked channel keeps buyer-only rules of its own (shared sign-in via the wholesale gate, approved-buyer
  // cart/checkout): copy about guest checkout would be false there, so it is qualified instead.
  const wholesale = persisted.wholesale_membership_enabled === true;
  const valueText = (value: unknown) => (value === true ? t('valueOn') : t('valueOff'));

  return (
    <div className="divide-y divide-border rounded border border-border bg-surface" data-testid="customer-accounts-card">
      <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0 space-y-0.5">
          <p className="text-xs text-muted">{t('storeLabel')}</p>
          <p className="truncate text-sm font-semibold text-text" data-testid="selected-store">{store.name}</p>
          {persisted.name && persisted.name !== store.name ? (
            <p className="truncate text-xs text-muted" dir="auto">{persisted.name}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end" role="status" aria-live="polite">
          <span className="text-xs text-muted">{t('statusLabel')}</span>
          <Badge tone={STATUS_TONE[status]} wrap data-testid="accounts-status">{t(`status.${status}` as CustomerAccountsMessageKey)}</Badge>
        </div>
      </div>

      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <p id="ca-toggle-label" className="text-sm font-medium text-text">{t('toggleLabel')}</p>
            <p className="text-xs leading-relaxed text-muted">{t('toggleHint')}</p>
            {blockedOn ? <p className="text-xs font-medium text-warning" role="note">{t('blockedDeployment')}</p> : null}
          </div>
          <div className="flex min-h-11 shrink-0 items-center">
            <Switch
              checked={shown}
              disabled={blockedOn || saving}
              aria-labelledby="ca-toggle-label"
              onCheckedChange={onToggle}
            />
          </div>
        </div>

        <p
          className={cn('flex items-start gap-2 rounded border border-border p-3 text-sm leading-relaxed text-text', status === 'gated_on' && 'border-warning/40')}
          data-testid="status-body"
        >
          <Info aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted" strokeWidth={1.7} />
          <span>{t(`${wholesale ? 'statusBodyWholesale' : 'statusBody'}.${status}` as CustomerAccountsMessageKey)}</span>
        </p>

        {dirty && !shown ? <p className="text-xs leading-relaxed text-muted">{wholesale ? t('turnOffNoteWholesale') : `${t('turnOffNote')} ${t('guestNote')}`}</p> : null}

        {error ? <p role="alert" className="text-sm text-negative">{error}</p> : null}

        {dirty || saving ? (
          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:items-center sm:justify-end">
            <Badge tone="warning" className="self-start sm:me-auto">{t('unsaved')}</Badge>
            <Button type="button" variant="outline" onClick={discard} disabled={saving}>{t('discard')}</Button>
            <Button type="button" onClick={save} disabled={saving} aria-busy={saving}>{saving ? t('saving') : t('save')}</Button>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-1 p-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium text-text">{t('deploymentLabel')}</p>
          <p className="text-xs leading-relaxed text-muted">{t('deploymentHint')}</p>
        </div>
        <Badge tone={deploymentOn ? 'positive' : 'muted'} className="self-start">{deploymentOn ? t('deploymentOn') : t('deploymentOff')}</Badge>
      </div>

      <div className="space-y-1 p-4">
        <h3 className="text-sm font-medium text-text">{t('lastChange')}</h3>
        {lastChange ? (
          <p className="text-sm text-text" data-testid="last-change">
            <span className="num">{t('lastChangeBy', { date: formatDateTime(lastChange.at, locale), name: lastChange.actor?.name ?? t('lastChangeUnknownActor') })}</span>
            {' · '}
            {t('from_to', {
              from: valueText(lastChange.changes.customer_accounts_enabled?.from),
              to: valueText(lastChange.changes.customer_accounts_enabled?.to),
            })}
          </p>
        ) : (
          <p className="text-sm text-muted">{t('lastChangeNone')}</p>
        )}
      </div>
    </div>
  );
}
