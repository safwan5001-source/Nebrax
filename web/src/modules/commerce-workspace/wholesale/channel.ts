import { api } from '@/lib/api';

/**
 * Wholesale channel settings — `GET/PUT /commerce/channels/{id}/pricing-settings` (H6 Batch F, permission
 * `commerce.channel_settings.manage`, owner/admin only). The only server source of the wholesale flag and the
 * deployment master switch; the browser never infers either.
 */

export type ChannelPriceList = { id: string; name: string; is_active: boolean };

export type ChannelSettingChange = {
  at: string | null;
  actor: { id: string; name: string } | null;
  changes: Record<string, { from: unknown; to: unknown }>;
};

export type ChannelSettings = {
  id: string;
  name: string;
  type: string;
  default_price_list: ChannelPriceList | null;
  wholesale_membership_enabled: boolean;
  /** Deployment master switch (`commerce.wholesale_buyer_enabled`), read-only. */
  wholesale_deployment_enabled: boolean;
  recent_changes?: ChannelSettingChange[];
};

export function channelSettingsPath(channelId: string): string {
  return `/commerce/channels/${encodeURIComponent(channelId)}/pricing-settings`;
}

export async function fetchChannelSettings(channelId: string): Promise<ChannelSettings> {
  const response = await api<{ data: ChannelSettings }>(channelSettingsPath(channelId));
  return response.data;
}

/** Writes only the keys supplied (the server rejects an empty body and `tenant_id`). */
export async function updateChannelSettings(
  channelId: string,
  changes: { default_price_list_id?: string | null; wholesale_membership_enabled?: boolean },
): Promise<ChannelSettings> {
  const response = await api<{ data: ChannelSettings }>(channelSettingsPath(channelId), { method: 'PUT', body: changes });
  return response.data;
}

/**
 * Why a data section can or cannot show wholesale data for the active channel.
 *  - `no_channel`: the active store has no sales channel;
 *  - `settings_unavailable`: settings could not be read (no permission / error) — the flag is unknown;
 *  - `deployment_off`: the deployment master switch is off (default) — wholesale is dark everywhere;
 *  - `channel_not_marked`: switch on, but this channel is not marked wholesale;
 *  - `active`: switch on and channel marked wholesale.
 */
export type WholesaleReadiness = 'loading' | 'no_channel' | 'settings_unavailable' | 'deployment_off' | 'channel_not_marked' | 'active';

export function deriveReadiness(input: {
  salesChannelId: string | null;
  settings: { status: 'loading' } | { status: 'ready'; data: ChannelSettings } | { status: 'error' };
}): WholesaleReadiness {
  if (!input.salesChannelId) return 'no_channel';
  if (input.settings.status === 'loading') return 'loading';
  if (input.settings.status === 'error') return 'settings_unavailable';
  const data = input.settings.data;
  if (!data.wholesale_deployment_enabled) return 'deployment_off';
  return data.wholesale_membership_enabled ? 'active' : 'channel_not_marked';
}
