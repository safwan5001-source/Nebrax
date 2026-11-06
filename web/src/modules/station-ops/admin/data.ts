'use client';

import { useStationOps } from '../context';
import { StationOpsError } from '../read-client';
import { useScopedQuery, type QueryState, type ScopedQuery } from '../use-scoped-query';
import { adminGet, isValidStaffId, staffPath } from './admin-client';
import { auditPageSchema, candidatesResponse, staffListResponse, staffOneResponse, templatesResponse, type AuditPage, type Candidate, type StaffView, type TemplatesPayload } from './schemas';

/**
 * FUEL-B4 — خطافات القراءة. نفس ضمانات `useScopedQuery`: المفتاح يحمل (مستأجر|مستخدم|فرع|نطاق) فلا تسرّب ولا سباق ولا cache عابر.
 * بلا الصلاحية الحاكمة (`fuel.staff.manage`) لا يُرسل أي طلب: الحالة «ممنوع» الصريحة أصدق من تحميل لا ينتهي.
 */

export const STAFF_PERMISSION = 'fuel.staff.manage';

const FORBIDDEN: QueryState<never> = { status: 'error', error: new StationOpsError('forbidden', 403) };

function useGated<T>(scopeSuffix: string | null, fetcher: (signal: AbortSignal) => Promise<T>): ScopedQuery<T> & { allowed: boolean } {
  const { scopeKey, can } = useStationOps();
  const allowed = can(STAFF_PERMISSION);
  const query = useScopedQuery<T>(allowed && scopeSuffix !== null ? `${scopeKey}|admin|${scopeSuffix}` : null, fetcher);
  return { allowed, state: allowed ? query.state : FORBIDDEN, reload: query.reload };
}

export function useStaffList() {
  return useGated<StaffView[]>('staff', async (signal) => (await adminGet('/fuel-stations/staff', staffListResponse, { signal })).data);
}

export function useTemplates() {
  return useGated<TemplatesPayload>('templates', async (signal) => (await adminGet('/fuel-stations/staff/templates', templatesResponse, { signal })).data);
}

export function useCandidates(enabled: boolean) {
  return useGated<Candidate[]>(enabled ? 'candidates' : null, async (signal) => (await adminGet('/fuel-stations/staff/candidates', candidatesResponse, { signal })).data);
}

export function useStaffMember(id: string) {
  const valid = isValidStaffId(id);
  return useGated<StaffView>(valid ? `staff|${id}` : null, async (signal) => (await adminGet(staffPath(id), staffOneResponse, { signal })).data);
}

export type AuditOutcomeFilter = 'all' | 'applied' | 'denied';

export function useAuditPage(page: number, outcome: AuditOutcomeFilter) {
  return useGated<AuditPage>(`audit|${outcome}|${page}`, (signal) =>
    adminGet('/fuel-stations/staff/audit', auditPageSchema, { signal, query: { page, per_page: 20, outcome: outcome === 'all' ? undefined : outcome } }),
  );
}
