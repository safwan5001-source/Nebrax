import { api } from '@/lib/api';
import { assertId } from '../client';
import { readReconciliation, readReview, type Readiness, type Reconciliation, type ReviewPage } from './logic';

/**
 * TANKER-PR6A/6B-0 — نقطة الشبكة الوحيدة لشاشة مراجعة الدمج المخزني: **GET وحده** على مسارَي القراءة (المراجعة والمطابقة). لا كتابة ولا ترحيل ولا مسار آخر، ولا `tenant_id` في أي معامل.
 * الخادم يفرض البوابة والصلاحية ونطاق المحطة والعزل (404 موحَّد مغلقاً).
 */
const REVIEW = '/fuel-stations/tanker-fills/inventory-review';
const RECONCILIATION = '/fuel-stations/tanker-fills/inventory-review/reconciliation';

export interface ReviewQuery {
  stationId?: string;
  readiness?: Readiness | '';
  overdue?: boolean;
  page?: number;
}

export async function getInventoryReview(query: ReviewQuery = {}): Promise<ReviewPage> {
  const params = new URLSearchParams();
  if (query.stationId) params.set('station_id', assertId(query.stationId));
  if (query.readiness) params.set('readiness', query.readiness);
  if (query.overdue) params.set('overdue', '1');
  if (query.page && query.page > 1) params.set('page', String(query.page));
  const qs = params.toString();
  return readReview(await api<unknown>(qs ? `${REVIEW}?${qs}` : REVIEW));
}

/** PR-6B-0: مطابقة مجمّع تكلفة الوقود مع رصيد المخزن والأستاذ (قراءة فقط؛ القيمة تظهر لمن يملك `products.view_cost` وبلا تقييد مخزن/محطة، والخادم هو السلطة). */
export async function getReconciliation(): Promise<Reconciliation> {
  return readReconciliation(await api<unknown>(RECONCILIATION));
}
