import { buildOrdersQuery, parseOrdersState, type OrdersListState } from '@/modules/commerce-workspace/orders/contract';

/**
 * Wholesale orders = the staff orders endpoint locked to the wholesale sales channel. The channel is server-side
 * filtering by `sales_channel_id` — never derived from the storefront, and the URL can neither widen nor change it
 * (`channel`/`scope` URL params are ignored; they belong to the all-stores Orders screen).
 */
export function parseWholesaleOrdersState(params: URLSearchParams): OrdersListState {
  return { ...parseOrdersState(params), salesChannelId: '', scopeAll: true };
}

export function buildWholesaleOrdersQuery(state: OrdersListState, channelId: string): URLSearchParams {
  const query = buildOrdersQuery({ ...state, salesChannelId: '', scopeAll: true }, null);
  query.delete('storefront_id');
  query.set('sales_channel_id', channelId);
  return query;
}
