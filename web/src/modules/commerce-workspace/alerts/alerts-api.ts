import { api } from '@/lib/api';
import type { AlertConfig, AttentionResponse, FeedResponse } from './contract';

/**
 * قراءة فقط: GET وحدها (يحرسه alerts-readonly.test.ts). الإقرار (H3-4) في ملف مستقل.
 * لا يستعمل ETag من العميل عمداً: `api()` المشترك لا يكشف ترويسات الرد، وصفحة التغذية الفارغة صغيرة؛ ETag الخادم متاح لاحقاً دون تغيير عقد.
 */
export async function fetchAlertConfig(): Promise<AlertConfig> {
  const res = await api<{ data: AlertConfig }>('/commerce/alerts/config');
  return res.data;
}

export function fetchFeedPage(afterSeq: number): Promise<FeedResponse> {
  return api<FeedResponse>(`/commerce/orders/feed?after_seq=${afterSeq}&limit=100`);
}

/** مؤشّر الرأس الحالي بلا أحداث (D-H3-02). */
export async function fetchFeedHead(): Promise<number> {
  const res = await api<FeedResponse>('/commerce/orders/feed?tail=1');
  return res.meta.head_seq;
}

/** `pending=1`: الخادم يصفّي «ما يستدعي التنبيه» قبل السقف فلا يحجبه 100 طلب معالَج أقدم منه. */
export function fetchAttention(): Promise<AttentionResponse> {
  return api<AttentionResponse>('/commerce/orders/attention?limit=100&pending=1');
}
