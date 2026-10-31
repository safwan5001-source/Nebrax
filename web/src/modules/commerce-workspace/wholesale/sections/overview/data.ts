import { fetchOrders } from '@/modules/commerce-workspace/orders/orders-api';
import type { OrderSummary } from '@/modules/commerce-workspace/orders/contract';
import { fetchMembershipCount, fetchMemberships, type Membership } from '../buyers/api';

export const OVERVIEW_LIST_SIZE = 5;

export type RecentOrders = { rows: OrderSummary[]; total: number };

/** Latest orders of the wholesale channel; the same response carries the real total (`meta.total`). */
export async function fetchRecentOrders(channelId: string): Promise<RecentOrders> {
  const query = new URLSearchParams({
    sales_channel_id: channelId,
    sort: 'created_at',
    direction: 'desc',
    page: '1',
    per_page: String(OVERVIEW_LIST_SIZE),
  });
  const { data, meta } = await fetchOrders(query);
  return { rows: data, total: meta.total };
}

export type MembershipOverview = { pending: { rows: Membership[]; total: number }; approved: number; suspended: number };

export async function fetchMembershipOverview(channelId: string): Promise<MembershipOverview> {
  const [pending, approved, suspended] = await Promise.all([
    fetchMemberships(channelId, { status: 'pending', perPage: OVERVIEW_LIST_SIZE }),
    fetchMembershipCount(channelId, 'approved'),
    fetchMembershipCount(channelId, 'suspended'),
  ]);
  return { pending: { rows: pending.data, total: pending.meta.total }, approved, suspended };
}
