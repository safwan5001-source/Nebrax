import { fetchOrders } from '../orders/orders-api';
import type { OrderSummary } from '../orders/contract';

/**
 * COPS-H3-5 — جلب لوحة الاستقبال: قراءة فقط عبر `GET commerce/orders` ومرشّحاته القائمة (لا نقطة جديدة، لا كتابة). كل طلب فرعي مرشّح خادمياً بحالة
 * واحدة كي لا تُجوِّع الطلبات المهجورة (إلكتروني لم يُدفع/ملغى الدفع) الطلبات الفعلية خارج أحدث N: غير المبدوء يُقسَّم بحالات دفع R-5 الجاهزة الثلاث.
 * اللوحة لا تفتح استطلاعاً: تُستدعى عند فتح الصفحة وتغيّر `revision` اللقطة المشتركة والتحديث اليدوي وبعد إجراء.
 */
export const BOARD_PAGE_SIZE = 50;
export const DONE_PAGE_SIZE = 10;

type Part = { params: Record<string, string>; perPage: number };

const READY_PAYMENT = ['awaiting_collection', 'collected', 'paid'] as const;

function parts(): Part[] {
  const out: Part[] = READY_PAYMENT.map((payment) => ({ params: { fulfillment_status: 'not_started', payment_status: payment }, perPage: BOARD_PAGE_SIZE }));
  for (const status of ['preparing', 'ready', 'out_for_delivery', 'delivery_failed', 'returned_to_store']) out.push({ params: { fulfillment_status: status }, perPage: BOARD_PAGE_SIZE });
  for (const status of ['delivered', 'picked_up']) out.push({ params: { fulfillment_status: status }, perPage: DONE_PAGE_SIZE });

  return out;
}

export interface BoardData {
  orders: OrderSummary[];
  /** وُجد أكثر مما عُرض في أحد المرشّحات (سقف الصفحة) ⇒ «افتح قائمة الطلبات للكل». */
  truncated: boolean;
}

export async function fetchBoard(storefrontId: string | null): Promise<BoardData> {
  const results = await Promise.all(
    parts().map((part) => {
      const query = new URLSearchParams({ ...part.params, lifecycle_status: 'confirmed', sort: 'created_at', direction: 'desc', per_page: String(part.perPage) });
      if (storefrontId) query.set('storefront_id', storefrontId);

      return fetchOrders(query);
    }),
  );
  const seen = new Set<string>();
  const orders: OrderSummary[] = [];
  let truncated = false;
  results.forEach((result, index) => {
    // ما فُوق سقف «المنتهية» عرضٌ مقصود (آخر N) لا اقتطاع يستدعي تنبيه المستخدم.
    const isDone = index >= results.length - 2;
    if (!isDone && result.meta.total > result.data.length) truncated = true;
    for (const order of result.data) {
      if (seen.has(order.id)) continue;
      seen.add(order.id);
      orders.push(order);
    }
  });
  orders.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));

  return { orders, truncated };
}
