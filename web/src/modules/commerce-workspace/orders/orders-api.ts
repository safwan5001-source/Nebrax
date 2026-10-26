import { api } from '@/lib/api';
import type { OrderDetail, OrderSummary, OrdersMeta } from './contract';

/** قراءة فقط: GET وحدها. لا طريقة كتابة في هذا الملف عمداً (يحرسه orders-readonly.test.ts). */
export const COMMERCE_ORDERS_PATH = '/commerce/orders';

export async function fetchOrders(query: URLSearchParams): Promise<{ data: OrderSummary[]; meta: OrdersMeta }> {
  const response = await api<{ data: OrderSummary[]; meta?: OrdersMeta }>(`${COMMERCE_ORDERS_PATH}?${query.toString()}`);
  const data = Array.isArray(response.data) ? response.data : [];

  return {
    data,
    meta: response.meta ?? { current_page: 1, per_page: data.length || 1, total: data.length, last_page: 1 },
  };
}

export async function fetchOrder(id: string): Promise<OrderDetail> {
  const response = await api<{ data: OrderDetail }>(`${COMMERCE_ORDERS_PATH}/${encodeURIComponent(id)}`);

  return response.data;
}
