import { api } from '@/lib/api';

/**
 * COPS-H4-6 (D-H4-06) — إتاحة طريقة دفع لكل قناة Commerce. يغلّف `GET|PUT payment-methods/{id}/channel-availability[/{channelId}]` (الصلاحيتان: المدفوعات + التجارة).
 * `override`: `true|false` تجاوز صريح، `null` = الافتراضي (`available_online`). `effective` ما يطبّقه Checkout فعلاً (يحسبه الخادم؛ لا حساب موازٍ هنا).
 */
export type ChannelAvailabilityRow = {
  channelId: string;
  name: string;
  type: string;
  isActive: boolean;
  override: boolean | null;
  effective: boolean;
};

export type ChannelAvailabilityView = {
  method: { id: string; name: string; isActive: boolean; availableOnline: boolean };
  channels: ChannelAvailabilityRow[];
};

export type AvailabilityChoice = 'default' | 'enabled' | 'disabled';

export function choiceOf(override: boolean | null): AvailabilityChoice {
  return override === null ? 'default' : override ? 'enabled' : 'disabled';
}

export function overrideOf(choice: AvailabilityChoice): boolean | null {
  return choice === 'default' ? null : choice === 'enabled';
}

type Raw = Record<string, unknown>;

export function mapChannelRow(raw: unknown): ChannelAvailabilityRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Raw;
  if (typeof row.sales_channel_id !== 'string' || typeof row.name !== 'string' || typeof row.type !== 'string' || typeof row.effective !== 'boolean') return null;
  if (row.override !== null && typeof row.override !== 'boolean') return null;

  return {
    channelId: row.sales_channel_id,
    name: row.name,
    type: row.type,
    isActive: row.is_active !== false,
    override: row.override as boolean | null,
    effective: row.effective,
  };
}

export function mapView(payload: unknown): ChannelAvailabilityView | null {
  const data = (payload as { data?: Raw } | null)?.data;
  const method = data?.payment_method as Raw | undefined;
  if (!data || !method || typeof method.id !== 'string' || !Array.isArray(data.channels)) return null;

  return {
    method: { id: method.id, name: String(method.name ?? ''), isActive: method.is_active !== false, availableOnline: method.available_online === true },
    channels: data.channels.map(mapChannelRow).filter((row): row is ChannelAvailabilityRow => row !== null),
  };
}

const path = (methodId: string) => `/payment-methods/${encodeURIComponent(methodId)}/channel-availability`;

export async function fetchChannelAvailability(methodId: string): Promise<ChannelAvailabilityView> {
  const view = mapView(await api<unknown>(path(methodId)));
  if (!view) throw new Error('channel availability response not recognised');

  return view;
}

export async function saveChannelAvailability(methodId: string, channelId: string, choice: AvailabilityChoice): Promise<ChannelAvailabilityRow> {
  const response = await api<unknown>(`${path(methodId)}/${encodeURIComponent(channelId)}`, { method: 'PUT', body: { is_enabled: overrideOf(choice) } });
  const row = mapChannelRow((response as { data?: unknown } | null)?.data);
  if (!row) throw new Error('channel availability response not recognised');

  return row;
}
