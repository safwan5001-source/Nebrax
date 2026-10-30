'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useCan } from '@/lib/use-can';
import { useCommerceStoreContext } from '@/modules/commerce-workspace/store-context';
import type { CommerceStoreOption } from '@/modules/commerce-workspace/stores';
import { deriveReadiness, fetchChannelSettings, type ChannelSettings, type WholesaleReadiness } from './channel';
import { useResource, type ResourceErrorKind } from './use-resource';

export type WholesaleChannelContextValue = {
  store: CommerceStoreOption | null;
  /** `sales_channels.id` of the active store; `null` when the store has none. */
  channelId: string | null;
  settings: { status: 'loading' } | { status: 'ready'; data: ChannelSettings } | { status: 'error'; kind: ResourceErrorKind };
  readiness: WholesaleReadiness;
  reloadSettings: () => void;
  /** Replaces the cached settings after a successful write (no extra round-trip). */
  applySettings: (next: ChannelSettings) => void;
};

const Context = createContext<WholesaleChannelContextValue | null>(null);

/**
 * Resolves the wholesale channel from the Commerce Workspace's active store (the shell already owns the store
 * selector — no second one here) and reads its pricing-settings once. Sections read `readiness` to decide between
 * real data and an honest gate state. Settings are only requested for viewers holding the settings permission.
 */
export function WholesaleChannelProvider({ children }: { children: ReactNode }) {
  const { catalog, selectedStoreId } = useCommerceStoreContext();
  const { can, hydrated } = useCan();
  const store = catalog.status === 'ready' ? (catalog.stores.find((candidate) => candidate.id === selectedStoreId) ?? null) : null;
  const channelId = store?.salesChannelId ?? null;
  const canReadSettings = hydrated && can('commerce.channel_settings.manage');

  const { state, reload } = useResource(
    () => (channelId ? fetchChannelSettings(channelId) : Promise.reject(new Error('no_channel'))),
    [channelId],
    { enabled: channelId !== null && canReadSettings },
  );
  // Post-write snapshot, scoped to one channel so a store switch never shows another channel's settings.
  const [held, setHeld] = useState<{ channelId: string | null; settings: ChannelSettings } | null>(null);
  const override = held && held.channelId === channelId ? held.settings : null;
  const applySettings = useCallback((next: ChannelSettings) => setHeld({ channelId, settings: next }), [channelId]);
  const reloadSettings = useCallback(() => {
    setHeld(null);
    reload();
  }, [reload]);

  const settings = useMemo<WholesaleChannelContextValue['settings']>(() => {
    if (channelId && !canReadSettings) return hydrated ? { status: 'error', kind: 'forbidden' } : { status: 'loading' };
    if (override) return { status: 'ready', data: override };
    if (state.status === 'ready') return { status: 'ready', data: state.data };
    if (state.status === 'error') return { status: 'error', kind: state.kind };
    return { status: 'loading' };
  }, [canReadSettings, channelId, hydrated, override, state]);

  const readiness = deriveReadiness({
    salesChannelId: channelId,
    settings: settings.status === 'error' ? { status: 'error' } : settings,
  });

  const value = useMemo<WholesaleChannelContextValue>(
    () => ({
      store,
      channelId,
      settings,
      readiness,
      reloadSettings,
      applySettings,
    }),
    [applySettings, channelId, readiness, reloadSettings, settings, store],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useWholesaleChannel(): WholesaleChannelContextValue {
  const value = useContext(Context);
  if (!value) throw new Error('useWholesaleChannel must be used inside WholesaleChannelProvider');
  return value;
}

export function useOptionalWholesaleChannel(): WholesaleChannelContextValue | null {
  return useContext(Context);
}
