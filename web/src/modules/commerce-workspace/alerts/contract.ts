/**
 * COPS-H3-3 (ADR-30) — عقد مركز التنبيه. الخادم مصدر الحقيقة: `alert.pending` (لم يُعالَج ولم يُقَرّ) يحكم الصوت والشارة؛ الواجهة لا تستنتجه من الأسباب.
 */
export type AlertMode = 'feed_attention' | 'attention_only';

export interface AlertConfig {
  enabled: boolean;
  mode: AlertMode;
  polling: { feed_ms: number; attention_ms: number; attention_only_ms: number };
}

export interface AttentionRow {
  order: {
    id: string;
    number: string | null;
    storefront_id: string | null;
    sales_channel_id: string | null;
    delivery_method: string | null;
    created_at: string | null;
  };
  payment: { method: string | null; status: string | null };
  reasons: string[];
  alert: { pending: boolean };
}

export interface AttentionResponse {
  data: AttentionRow[];
  meta: { truncated: boolean; window_hours: number; limit: number };
}

export interface FeedEvent {
  seq: number;
  type: string;
  occurred_at: string | null;
  order: { id: string; number: string | null };
}

export interface FeedResponse {
  data: FeedEvent[];
  meta: { after_seq: number; next_after_seq: number; has_more: boolean; limit: number; head_seq: number };
}

export interface AlertItem {
  orderId: string;
  number: string | null;
  createdAt: string | null;
  reasons: string[];
  deliveryMethod: string | null;
  paymentMethod: string | null;
}

export type AlertConnection = 'idle' | 'connecting' | 'live' | 'degraded' | 'offline';

/** لقطة الحالة التي يبثّها القائد وتعرضها كل التبويبات (قابلة للنسخ البنيوي عبر BroadcastChannel). */
export interface AlertSnapshot {
  connection: AlertConnection;
  /** آخر نجاح لأي طلب استطلاع (ms epoch) أو null. */
  lastSuccessAt: number | null;
  consecutiveFailures: number;
  /** غير المُعالَجة وغير المُسكَتة محلياً — أساس الصوت والشارة. */
  pending: AlertItem[];
  /** كل صفوف الانتباه المعروضة (للقائمة)، pending أولاً. */
  total: number;
  truncated: boolean;
  mode: AlertMode;
}

export const EMPTY_SNAPSHOT: AlertSnapshot = {
  connection: 'idle',
  lastSuccessAt: null,
  consecutiveFailures: 0,
  pending: [],
  total: 0,
  truncated: false,
  mode: 'feed_attention',
};

/** ADR-30 §5.1: «آخر اتصال ناجح» لا يتجاوز 30 ثانية وإلا تحذير مرئي. */
export const STALE_AFTER_MS = 30_000;
