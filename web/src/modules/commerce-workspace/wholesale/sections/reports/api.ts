import { api } from '@/lib/api';
import { fetchOrders } from '@/modules/commerce-workspace/orders/orders-api';

/**
 * Reports are COUNTS only, each read from `meta.total` of a one-row page — the server counts, the browser never
 * adds up rows. There is no aggregate (revenue / average order / top-N) endpoint scoped to a sales channel, so none
 * is computed here. Orders: `GET /commerce/orders?sales_channel_id=…&per_page=1` (`commerce.orders.view`).
 * Buyers: `GET /commerce/wholesale/channels/{id}/memberships?status=…&per_page=1` (`commerce.wholesale.manage`).
 */

export const PERIOD_PRESETS = ['all', '7', '30', '90'] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

const pad = (n: number) => String(n).padStart(2, '0');

/** `from` date (Y-m-d, viewer-local calendar day) for a preset; `null` = all time. */
export function periodFrom(preset: PeriodPreset, now: Date = new Date()): string | null {
  if (preset === 'all') return null;
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - Number(preset));
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

export const PAYMENT_STATUS_VALUES = ['pending', 'awaiting_collection', 'collected', 'paid', 'cancelled'] as const;
export const PAYMENT_METHOD_VALUES = ['cod', 'pay_on_pickup', 'online'] as const;
export const DELIVERY_METHOD_VALUES = ['standard', 'pickup'] as const;
export const LIFECYCLE_VALUES = ['confirmed', 'cancelled'] as const;
export const MEMBERSHIP_STATUS_VALUES = ['pending', 'approved', 'rejected', 'suspended'] as const;

export type CountRow = { value: string; count: number };

function orderQuery(channelId: string, from: string | null, extra: Record<string, string> = {}): URLSearchParams {
  const query = new URLSearchParams({ sales_channel_id: channelId, per_page: '1', page: '1', ...extra });
  if (from) query.set('from', from);
  return query;
}

export async function countOrders(channelId: string, from: string | null, extra: Record<string, string> = {}): Promise<number> {
  const { meta } = await fetchOrders(orderQuery(channelId, from, extra));
  return meta.total;
}

/** One count per value of a single order filter (`payment_status`, `payment_method`, `delivery_method`, `lifecycle_status`). */
export async function countOrdersBy(
  channelId: string,
  from: string | null,
  filter: 'payment_status' | 'payment_method' | 'delivery_method' | 'lifecycle_status',
  values: readonly string[],
): Promise<CountRow[]> {
  return Promise.all(values.map(async (value) => ({ value, count: await countOrders(channelId, from, { [filter]: value }) })));
}

export function membershipsPath(channelId: string): string {
  return `/commerce/wholesale/channels/${encodeURIComponent(channelId)}/memberships`;
}

export async function countMemberships(channelId: string): Promise<CountRow[]> {
  return Promise.all(
    MEMBERSHIP_STATUS_VALUES.map(async (status) => {
      const query = new URLSearchParams({ status, per_page: '1' });
      const response = await api<{ meta?: { total?: number } }>(`${membershipsPath(channelId)}?${query.toString()}`);
      return { value: status, count: typeof response.meta?.total === 'number' ? response.meta.total : 0 };
    }),
  );
}
