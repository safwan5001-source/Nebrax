import type { OrderSummary } from '../orders/contract';

/**
 * COPS-H3-5 — أعمدة لوحة الاستقبال. **تصنيف عرض فقط** لحالة يحسبها الخادم (`operational_status` من `CommerceOrderStatusProjector`) وعلم `alert.pending`
 * (عبر مجموعة معرّفات مركز التنبيه): لا يُشتقّ هنا أي انتقال ولا أهلية إجراء (الإجراءات من عقد قراءة التفاصيل وحده). حالة غير معروفة ⇒ خارج اللوحة
 * (لا تُخترع لها خانة). `awaiting_payment`/`payment_cancelled`/`draft`/`cancelled` خارج اللوحة عمداً: ليست طلبات استقبال (R-5).
 */
export const BOARD_COLUMNS = ['new', 'accepted', 'ready', 'dispatch', 'done'] as const;
export type BoardColumnKey = (typeof BOARD_COLUMNS)[number];

export function columnOf(order: Pick<OrderSummary, 'id' | 'operational_status'>, pendingIds: ReadonlySet<string>): BoardColumnKey | null {
  switch (order.operational_status) {
    case 'awaiting_acceptance':
      return 'new';
    case 'accepted':
      // مقبول (ضمنياً أو يدوياً) ولم يبدأ تنفيذه: «جديد» ما دام التنبيه الخادمي قائماً، وإلا ينتظر التجهيز.
      return pendingIds.has(order.id) ? 'new' : 'accepted';
    case 'preparing':
      return 'accepted';
    case 'ready':
      return 'ready';
    case 'out_for_delivery':
    case 'delivery_failed':
    case 'returned_to_store':
      return 'dispatch';
    case 'delivered':
    case 'picked_up':
      return 'done';
    default:
      return null;
  }
}

export type BoardGroups = Record<BoardColumnKey, OrderSummary[]>;

/** يوزّع الطلبات على الأعمدة محافظاً على ترتيب الخادم (الأحدث أولاً)، مع تقديم الطلبات التي تنتظر انتباهاً داخل «جديد». */
export function groupOrders(orders: readonly OrderSummary[], pendingIds: ReadonlySet<string>): BoardGroups {
  const groups: BoardGroups = { new: [], accepted: [], ready: [], dispatch: [], done: [] };
  for (const order of orders) {
    const key = columnOf(order, pendingIds);
    if (key !== null) groups[key].push(order);
  }
  const rank = (o: OrderSummary): number => (pendingIds.has(o.id) ? 0 : 1);
  groups.new = [...groups.new].sort((a, b) => rank(a) - rank(b)); // sort مستقر: يحفظ ترتيب الخادم داخل الرتبة

  return groups;
}

/** عمر الطلب بالدقائق الكاملة منذ لحظة الوصول (لا يقلّ عن صفر). `null` عند غياب/فساد التاريخ. */
export function elapsedMinutes(createdAt: string | null | undefined, nowMs: number): number | null {
  if (!createdAt) return null;
  const t = Date.parse(createdAt);
  if (Number.isNaN(t)) return null;

  return Math.max(0, Math.floor((nowMs - t) / 60_000));
}
