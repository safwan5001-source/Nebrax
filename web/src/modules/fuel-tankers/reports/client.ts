import { api } from '@/lib/api';
import { assertId } from '../client';
import { readReport, reportQueryEntries, type ReportFilters, type ReportPayload } from './logic';
import type { ReportKey } from './routes';

/**
 * TANKER-PR6B-6 (واجهات) — **نقطة الشبكة الوحيدة** لتقارير سندات التعبئة (يحرسه `reports-boundary.test.ts`): **GET وحده** على
 * `fuel-stations/tanker-fill-reports/{key}` لأربعة مفاتيح بيضاء. لا كتابة ولا ترحيل ولا عكس ولا `tenant_id` ولا ساعة عميل ولا حسابات.
 * الخادم يفرض البوابات الثلاث والصلاحيات ونطاق المحطة/الفرع؛ 404 موحَّد مغلقاً، و403 بـ`details.reason` لتقرير الحساب الوسيط لمقيَّد النطاق.
 */
const BASE = '/fuel-stations/tanker-fill-reports';

export async function getReport(key: ReportKey, filters: ReportFilters = {}): Promise<ReportPayload> {
  const entries = reportQueryEntries({
    ...filters,
    stationId: filters.stationId ? assertId(filters.stationId) : undefined,
    ownerId: filters.ownerId ? assertId(filters.ownerId) : undefined,
  });
  const qs = entries.length === 0 ? '' : `?${new URLSearchParams(entries).toString()}`;
  return readReport(key, await api<unknown>(`${BASE}/${key}${qs}`));
}
