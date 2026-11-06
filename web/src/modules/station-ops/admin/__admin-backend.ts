import { ApiError } from '@/lib/api';
import { createBackend, type TenantData } from '../__test-harness';
import type { AuditEvent, Candidate, StaffView, TemplatesPayload } from './schemas';

/**
 * حزمة اختبار (للاختبارات فقط): خادم وهمي بحالة لواجهات إدارة الموظفين. يحاكي **أشكال الاستجابة وقواعد التعارض** (النسخة، 409، استبدال المحطات،
 * إضافة/سحب تفاضلي)؛ أما قواعد السقف والمحجوز والنطاق الحقيقية فمختبَرة في الخادم (PHP) ولا تُعاد كتابتها هنا إلا كحقن أعطال صريح.
 */
export interface PutCall { path: string; body: Record<string, unknown> }
export interface AdminWorld {
  data: TenantData;
  staff: StaffView[];
  templates: TemplatesPayload;
  candidates: Candidate[];
  audit: AuditEvent[];
  puts: PutCall[];
  gets: string[];
  /** يُستدعى قبل تطبيق الـPUT؛ يرمي ApiError أو خطأ شبكة ليحاكي رفضاً/عطلاً. */
  beforePut?: (call: PutCall, world: AdminWorld) => void;
  /** يحاكي انقطاعاً بعد التطبيق (الكتابة تمت لكن الردّ ضاع). */
  dropResponseAfterApply?: boolean;
  /** يحاكي تعديل مسؤول آخر قبل وصول الطلب. */
  concurrentEdit?: (world: AdminWorld) => void;
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function connectAdmin(world: AdminWorld, apiMock: { mockImplementation: (fn: (path: string, init?: { method?: string; body?: unknown; headers?: HeadersInit }) => Promise<never>) => unknown }) {
  const base = createBackend(world.data);
  let revision = 100;

  apiMock.mockImplementation(async (path: string, init?: { method?: string; body?: unknown; headers?: HeadersInit }) => {
    if (path === '/me') return { user: JSON.parse(localStorage.getItem('user') as string) } as never;
    const [route, search = ''] = path.split('?');
    const query = new URLSearchParams(search);

    if (route.startsWith('/fuel-stations/staff')) {
      if (init?.method === 'PUT') {
        const id = route.split('/').pop() as string;
        const call: PutCall = { path: route, body: clone((init.body ?? {}) as Record<string, unknown>) };
        world.puts.push(call);
        world.beforePut?.(call, world);
        world.concurrentEdit?.(world);
        const row = world.staff.find((s) => s.user.id === id);
        if (!row) throw new ApiError(404, 'not found', {});
        if (call.body.expected_revision !== row.revision) {
          throw new ApiError(409, 'تغيّر إسناد هذا الموظف', { message: 'x', reason: 'staff_revision_conflict', current_revision: row.revision });
        }
        const perms = new Set(row.fuel_permissions);
        for (const key of (call.body.remove_permissions as string[] | undefined) ?? []) perms.delete(key);
        for (const key of (call.body.add_permissions as string[] | undefined) ?? []) perms.add(key);
        row.fuel_permissions = [...perms].sort();
        row.template = world.templates.templates.find((t) => [...t.permissions].sort().join('|') === row.fuel_permissions.join('|'))?.key ?? (row.fuel_permissions.length === 0 ? 'none' : 'custom');
        if (Array.isArray(call.body.station_ids)) row.station_ids = [...(call.body.station_ids as string[])].sort();
        row.fuel_station_scope = 'assigned';
        row.revision = `rev-${++revision}`;
        world.candidates = world.candidates.filter((c) => c.id !== id);
        if (world.dropResponseAfterApply) throw new TypeError('Failed to fetch');
        return { data: clone(row) } as never;
      }
      world.gets.push(path);
      if (route === '/fuel-stations/staff') return { data: clone(world.staff) } as never;
      if (route === '/fuel-stations/staff/templates') return { data: clone(world.templates) } as never;
      if (route === '/fuel-stations/staff/candidates') return { data: clone(world.candidates) } as never;
      if (route === '/fuel-stations/staff/audit') {
        const per = Number(query.get('per_page') ?? 25);
        const page = Number(query.get('page') ?? 1);
        const outcome = query.get('outcome');
        const rows = world.audit.filter((e) => !outcome || e.outcome === outcome);
        return { data: clone(rows.slice((page - 1) * per, page * per)), meta: { current_page: page, last_page: Math.max(1, Math.ceil(rows.length / per)), per_page: per, total: rows.length } } as never;
      }
      const id = route.split('/').pop() as string;
      const row = world.staff.find((s) => s.user.id === id) ?? world.candidates.map((c) => ({ user: c, role: 'staff', template: 'none', fuel_permissions: [], fuel_station_scope: null, station_ids: [], revision: `rev-c-${c.id.slice(-3)}` })).find((r) => r.user.id === id);
      if (!row) throw new ApiError(404, 'not found', {});
      return { data: clone(row) } as never;
    }
    return base.handler(path, init?.headers as Record<string, string> | undefined) as never;
  });
}
