/**
 * سجلّ إجراءات المساعد في مركز الاستيراد (IMP-H8-S4b) — عميل `GET /ai-actions` (IMP-H8-S4a). قراءة فقط: الصف ملخّص (بلا مقترح ولا تكلفة)، والتفاصيل في شاشة المساعد
 * عبر `?action=`. الخادم هو السلطة في ما يُعرض (بوابات النوع والفرع والصلاحية)؛ لا تُخمَّن هنا.
 */
import { api, ApiError } from '@/lib/api';

export type AiActionStatus =
  | 'created' | 'editing' | 'ready_for_approval' | 'approved' | 'expired' | 'executing' | 'executed' | 'partially_failed' | 'failed' | 'cancelled';

export const AI_ACTION_STATUSES: AiActionStatus[] = [
  'created', 'editing', 'ready_for_approval', 'approved', 'expired', 'executing', 'executed', 'partially_failed', 'failed', 'cancelled',
];

export interface AiActionExecutionSummary {
  id: string;
  status: string;
  retry_count: number;
  started_at: string | null;
  finished_at: string | null;
  rows: Record<string, number>;
}

export interface AiActionHistoryItem {
  id: string;
  type: string;
  status: AiActionStatus;
  version: number;
  created_by: string;
  created_by_name: string | null;
  summary: { row_count: number | null; error_count: number | null; needs_review_count: number | null };
  execution: AiActionExecutionSummary | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface AiActionHistoryPage {
  data: AiActionHistoryItem[];
  meta: { current_page: number; last_page: number; per_page: number; total: number };
}

export interface AiActionHistoryQuery {
  page: number;
  perPage: number;
  status?: string;
  mine?: boolean;
}

/** مسار الشاشة التي تفتح الإجراء، حسب نوعه. نوعٌ بلا شاشة معروفة ⇒ `null` فلا رابط مُخمَّن. */
const OPEN_ROUTES: Record<string, string> = { 'product_import.v1': '/products/ai-import' };

export function aiActionHref(type: string, id: string): string | null {
  const route = OPEN_ROUTES[type];

  return route ? `${route}?action=${encodeURIComponent(id)}` : null;
}

export function aiActionsPath(query: AiActionHistoryQuery): string {
  const params = new URLSearchParams({ page: String(query.page), per_page: String(query.perPage) });
  if (query.status) params.set('status', query.status);
  if (query.mine) params.set('mine', '1');

  return `/ai-actions?${params.toString()}`;
}

export type AiActionsAvailability = 'ok' | 'unavailable';

/**
 * رفض 403 من الخادم (المنصة/المؤسسة لم تفعّل AI Actions، أو لا صلاحية) ليس خطأً تقنياً: القسم يُعرض «غير متاح» بلا زر إعادة محاولة.
 * أي خطأ آخر يُرمى ليُعرض كخطأ قابل للإعادة.
 */
export async function fetchAiActions(query: AiActionHistoryQuery): Promise<{ availability: AiActionsAvailability; page: AiActionHistoryPage | null }> {
  try {
    return { availability: 'ok', page: await api<AiActionHistoryPage>(aiActionsPath(query)) };
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) return { availability: 'unavailable', page: null };
    throw error;
  }
}
