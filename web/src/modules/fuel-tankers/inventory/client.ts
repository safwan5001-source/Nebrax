import { api } from '@/lib/api';
import { assertId } from '../client';
import { readReview, type Readiness, type ReviewPage } from './logic';

/**
 * TANKER-PR6A — نقطة الشبكة الوحيدة لشاشة مراجعة الدمج المخزني: **GET واحد** على مسار القراءة. لا كتابة ولا ترحيل ولا مسار آخر، ولا `tenant_id` في أي معامل.
 * الخادم يفرض البوابة والصلاحية ونطاق المحطة والعزل (404 موحَّد مغلقاً).
 */
const REVIEW = '/fuel-stations/tanker-fills/inventory-review';

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
