import { beforeEach, describe, expect, it, vi } from 'vitest';
import { summaryFixture } from '../orders/test-fixtures';

const fetchOrders = vi.hoisted(() => vi.fn());
vi.mock('../orders/orders-api', () => ({ fetchOrders }));

import { fetchBoard } from './reception-api';

const page = (data: unknown[], total = data.length) => ({ data, meta: { current_page: 1, per_page: 50, total, last_page: 1 } });

describe('fetchBoard (قراءة فقط)', () => {
  beforeEach(() => { fetchOrders.mockReset(); });

  it('عشرة استعلامات مرشَّحة خادمياً بالحقائق، كلها مؤكَّدة غير ملغاة ومحصورة بالمتجر', async () => {
    fetchOrders.mockResolvedValue(page([]));
    await fetchBoard('store-1');
    const queries = fetchOrders.mock.calls.map((c) => c[0] as URLSearchParams);
    expect(queries).toHaveLength(10);
    for (const q of queries) {
      expect(q.get('lifecycle_status')).toBe('confirmed');
      expect(q.get('storefront_id')).toBe('store-1');
      expect(q.get('sort')).toBe('created_at');
    }
    const fulfillment = queries.map((q) => q.get('fulfillment_status'));
    expect(fulfillment.filter((f) => f === 'not_started')).toHaveLength(3);
    // غير المبدوء مقسَّم بحالات الدفع الجاهزة (R-5) كي لا تجوّعه الطلبات الإلكترونية المهجورة.
    expect(queries.filter((q) => q.get('fulfillment_status') === 'not_started').map((q) => q.get('payment_status')).sort()).toEqual(['awaiting_collection', 'collected', 'paid']);
    expect(new Set(fulfillment)).toEqual(new Set(['not_started', 'preparing', 'ready', 'out_for_delivery', 'delivery_failed', 'returned_to_store', 'delivered', 'picked_up']));
  });

  it('بلا متجر نشط لا يُرسل storefront_id', async () => {
    fetchOrders.mockResolvedValue(page([]));
    await fetchBoard(null);
    expect((fetchOrders.mock.calls[0][0] as URLSearchParams).has('storefront_id')).toBe(false);
  });

  it('يزيل التكرار ويرتّب الأحدث أولاً ويعلن الاقتطاع لغير المنتهية فقط', async () => {
    const a = summaryFixture({ id: 'a', created_at: '2026-11-03T10:00:00Z' });
    const b = summaryFixture({ id: 'b', created_at: '2026-11-03T11:00:00Z' });
    fetchOrders.mockImplementation(async (q: URLSearchParams) => {
      const f = q.get('fulfillment_status');
      if (f === 'preparing') return page([a, b], 120); // أكثر من المعروض ⇒ اقتطاع
      if (f === 'delivered') return page([a], 400); // «المنتهية» اقتطاعها مقصود
      return page([]);
    });
    const result = await fetchBoard(null);
    expect(result.orders.map((o) => o.id)).toEqual(['b', 'a']);
    expect(result.truncated).toBe(true);

    fetchOrders.mockImplementation(async (q: URLSearchParams) => (q.get('fulfillment_status') === 'delivered' ? page([a], 400) : page([])));
    expect((await fetchBoard(null)).truncated).toBe(false);
  });

  it('فشل أي استعلام يُفشل الجلب كله (لا لوحة ناقصة صامتة)', async () => {
    fetchOrders.mockImplementation(async (q: URLSearchParams) => {
      if (q.get('fulfillment_status') === 'ready') throw new Error('boom');
      return page([]);
    });
    await expect(fetchBoard(null)).rejects.toThrow('boom');
  });

  it('الملف قراءة فقط', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(`${__dirname}/reception-api.ts`, 'utf8');
    expect(/method:\s*['"](POST|PUT|PATCH|DELETE)/i.test(src)).toBe(false);
  });
});
