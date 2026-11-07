import { ApiError } from '@/lib/api';
import { createBackend, type TenantData } from '../__test-harness';

/**
 * حزمة اختبار (للاختبارات فقط): خادم وهمي **بحالة** لقراءات الخزانات. يحاكي عقد الخادم المثبت في `FuelReconciliationService::recordReading`:
 * idempotency بمفتاح الدليل (نفس الحمولة ⇒ القراءة الأولى، مختلفة ⇒ 422)، رفض ما فوق السعة، وحساب `tank-levels` من القراءات المخزَّنة.
 * قواعد النطاق والزمن والتزامن الحقيقية مختبَرة في الخادم (PHP) ولا تُعاد كتابتها هنا إلا كحقن أعطال صريح.
 */
export interface StoredReading {
  id: string; fuel_tank_id: string; fuel_station_id: string; reading_type: 'physical' | 'atg'; quantity_milliliters: number;
  evidence_key: string; evidence: { method?: string; note?: string; late_reason?: string; late_request_id?: string } | null; recorded_by: string | null; recorder_name: string | null; measured_at: string;
}
export interface TankSpec { id: string; station: string; code: string; name: string; capacity: number; safe: number; minimum: number; dead: number; status?: string }
export interface Post { path: string; method?: string; body: Record<string, unknown> }
export interface StoredRequest {
  id: string; status: 'pending' | 'approved' | 'rejected'; fuel_tank_id: string; fuel_station_id: string; reading_type: 'physical' | 'atg'; quantity_milliliters: number;
  evidence_key: string; evidence: { method?: string; note?: string } | null; reason: string | null; measured_at: string; requested_at: string; requested_by: string; requester_name: string;
  decided_by: string | null; decider_name: string | null; decided_at: string | null; decision_note: string | null; fuel_tank_reading_id: string | null;
}
export interface PolicyState { policy: 'deny' | 'supervisor_approval' | 'authorized_user'; max_hours: number; reason_required: boolean }
export interface TanksWorld {
  data: TenantData;
  tanks: TankSpec[];
  readings: StoredReading[];
  posts: Post[];
  gets: string[];
  viewerId: string;
  viewerName: string;
  /** عمر الحداثة المضبوط للمحطة (دقائق) أو null = غير مضبوط. */
  staleAfter: number | null;
  now: string;
  /** سياسة التأريخ الرجعي الفعّالة للمحطة (الافتراضي deny). */
  policy?: PolicyState;
  /** هل يحمل المستخدم صلاحية التسجيل المباشر للمتأخرة (authorized_user)؟ */
  canLateRecord?: boolean;
  /** هل يحمل المستخدم الحوكمة (تعديل السياسة)؟ */
  canGovern?: boolean;
  requests?: StoredRequest[];
  beforePost?: (post: Post, world: TanksWorld) => void;
  dropReplyAfterApply?: (post: Post) => boolean;
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const toMl = (liters: string) => Math.round(Number(liters) * 1000);
const DEFAULT_POLICY: PolicyState = { policy: 'deny', max_hours: 24, reason_required: true };
const liters = (value: number) => (value / 1000).toString();

function readingRow(r: StoredReading) {
  return {
    id: r.id, reading_type: r.reading_type, quantity_milliliters: r.quantity_milliliters, quantity_liters: liters(r.quantity_milliliters), measured_at: r.measured_at,
    recorded_by: r.recorded_by, recorder: r.recorded_by ? { id: r.recorded_by, name: r.recorder_name } : null, evidence: r.evidence,
  };
}

export function connectTanks(world: TanksWorld, apiMock: { mockImplementation: (fn: (path: string, init?: { method?: string; body?: unknown; headers?: HeadersInit }) => Promise<never>) => unknown }) {
  const base = createBackend(world.data);
  let seq = 0;
  const latestOf = (tankId: string, type?: string) => world.readings
    .filter((r) => r.fuel_tank_id === tankId && (!type || r.reading_type === type))
    .sort((a, b) => (a.measured_at < b.measured_at ? 1 : a.measured_at > b.measured_at ? -1 : b.id.localeCompare(a.id)))[0] ?? null;

  const levelFor = (tank: TankSpec) => {
    const latest = latestOf(tank.id);
    const q = latest?.quantity_milliliters ?? null;
    const flags: string[] = [];
    if (q !== null) {
      if (q > tank.capacity) flags.push('above_capacity'); else if (tank.safe > 0 && q > tank.safe) flags.push('above_safe_capacity');
      if (tank.minimum > 0 && q < tank.minimum) flags.push('below_minimum_level');
      if (tank.dead > 0 && q < tank.dead) flags.push('below_dead_stock');
    }
    const age = latest ? Math.max(Math.floor((Date.parse(world.now) - Date.parse(latest.measured_at)) / 1000), 0) : null;
    const freshness = !latest ? 'none' : world.staleAfter === null ? 'unrated' : age !== null && age > world.staleAfter * 60 ? 'stale' : 'fresh';
    return {
      tank: { id: tank.id, code: tank.code, name: tank.name, status: tank.status ?? 'active', capacity_milliliters: tank.capacity, capacity_liters: liters(tank.capacity), safe_capacity_milliliters: tank.safe, minimum_level_milliliters: tank.minimum, dead_stock_milliliters: tank.dead },
      station: { id: tank.station, code: `ST-${tank.station}`, name: `Station ${tank.station}` },
      fuel_product: { id: 'p1', code: 'P1', name: 'Alpha' },
      backdating: (() => { const p = world.policy ?? DEFAULT_POLICY; return { ...p, can_submit: p.policy === 'supervisor_approval' ? true : p.policy === 'authorized_user' ? world.canLateRecord === true : false }; })(),
      latest: latest ? readingRow(latest) : null,
      latest_by_type: { physical: latestOf(tank.id, 'physical') ? readingRow(latestOf(tank.id, 'physical') as StoredReading) : null, atg: latestOf(tank.id, 'atg') ? readingRow(latestOf(tank.id, 'atg') as StoredReading) : null },
      level: {
        fill_basis_points: q === null ? null : Math.floor((q * 10000 + Math.floor(tank.capacity / 2)) / tank.capacity),
        available_milliliters: q === null ? null : Math.max(tank.capacity - q, 0), available_liters: q === null ? null : liters(Math.max(tank.capacity - q, 0)),
        safe_available_milliliters: q === null ? null : Math.max(tank.safe - q, 0), age_seconds: age, freshness, stale_after_minutes: world.staleAfter, flags, needs_review: flags.length > 0,
      },
    };
  };

  const requestView = (r: StoredRequest) => ({
    id: r.id, request_kind: 'late_reading', status: r.status, fuel_station_id: r.fuel_station_id, tank: { id: r.fuel_tank_id, name: world.tanks.find((t) => t.id === r.fuel_tank_id)?.name ?? null, code: null },
    fuel_tank_id: r.fuel_tank_id, reading_type: r.reading_type, quantity_milliliters: r.quantity_milliliters, quantity_liters: liters(r.quantity_milliliters), evidence_key: r.evidence_key, evidence: r.evidence,
    reason: r.reason, measured_at: r.measured_at, requested_at: r.requested_at, late_by_seconds: Math.max(Math.floor((Date.parse(r.requested_at) - Date.parse(r.measured_at)) / 1000), 0),
    requested_by: r.requested_by, requester: { id: r.requested_by, name: r.requester_name }, decided_by: r.decided_by, decider: r.decided_by ? { id: r.decided_by, name: r.decider_name } : null,
    decided_at: r.decided_at, decision_note: r.decision_note, fuel_tank_reading_id: r.fuel_tank_reading_id,
  });

  apiMock.mockImplementation(async (path: string, init?: { method?: string; body?: unknown; headers?: HeadersInit }) => {
    if (path === '/me') return { user: JSON.parse(localStorage.getItem('user') as string) } as never;
    const [route, search = ''] = path.split('?');
    const query = new URLSearchParams(search);
    world.gets.push(path);

    const decision = /^\/fuel-stations\/reading-requests\/([0-9a-fA-F-]{36})\/(approve|reject)$/.exec(route);
    if (init?.method === 'POST' && decision) {
      world.gets.pop();
      const post: Post = { path: route, method: 'POST', body: clone((init.body ?? {}) as Record<string, unknown>) };
      world.posts.push(post);
      world.beforePost?.(post, world);
      const request = (world.requests ?? []).find((r) => r.id === decision[1]);
      if (!request) throw new ApiError(404, 'not found', {});
      const note = String((post.body as { note?: string }).note ?? '').trim();
      if (request.status !== 'pending') throw new ApiError(409, 'FUEL_READING_REQUEST_ALREADY_DECIDED: قُرِّر هذا الطلب سابقاً.', { reason: 'request_already_decided', current_status: request.status });
      if (request.requested_by === world.viewerId) throw new ApiError(422, 'FUEL_READING_SELF_APPROVAL: لا يجوز البتّ في طلبك بنفسك.', {});
      if (decision[2] === 'reject' && note === '') throw new ApiError(422, 'FUEL_READING_REJECTION_NOTE_REQUIRED: سبب رفض القراءة المتأخرة إلزامي.', {});
      request.status = decision[2] === 'approve' ? 'approved' : 'rejected';
      request.decided_by = world.viewerId; request.decider_name = world.viewerName; request.decided_at = world.now; request.decision_note = note || null;
      if (decision[2] === 'approve') {
        const reading: StoredReading = {
          id: `rd-${++seq}`, fuel_tank_id: request.fuel_tank_id, fuel_station_id: request.fuel_station_id, reading_type: request.reading_type, quantity_milliliters: request.quantity_milliliters,
          evidence_key: request.evidence_key, evidence: { ...(request.evidence ?? {}), late_reason: request.reason ?? '' }, recorded_by: request.requested_by, recorder_name: request.requester_name, measured_at: request.measured_at,
        };
        world.readings.push(reading);
        request.fuel_tank_reading_id = reading.id;
      }
      if (world.dropReplyAfterApply?.(post)) throw new TypeError('Failed to fetch');
      return { data: requestView(request) } as never;
    }

    if (route === '/fuel-stations/reading-requests') {
      const status = query.get('status');
      const rows = (world.requests ?? []).filter((r) => (!query.get('station_id') || r.fuel_station_id === query.get('station_id')) && (!status || r.status === status))
        .sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1));
      return { data: rows.map(requestView), meta: { current_page: 1, last_page: 1, total: rows.length } } as never;
    }

    const settings = /^\/fuel-stations\/stations\/([0-9a-fA-F-]{36})\/settings$/.exec(route);
    if (settings && init?.method === 'PUT') {
      const post: Post = { path: route, method: 'PUT', body: clone((init.body ?? {}) as Record<string, unknown>) };
      world.gets.pop();
      world.posts.push(post);
      world.beforePost?.(post, world);
      if (world.canGovern !== true) throw new ApiError(403, 'تغيير سياسات حوكمة الوقود يتطلب صلاحية حوكمة الوقود.', {});
      const b = post.body as { tank_reading_backdating_policy?: PolicyState['policy'] | null; tank_reading_backdating_max_hours?: number | null; tank_reading_backdating_reason_required?: boolean | null };
      const current = world.policy ?? DEFAULT_POLICY;
      world.policy = {
        policy: b.tank_reading_backdating_policy === undefined ? current.policy : b.tank_reading_backdating_policy ?? 'deny',
        max_hours: b.tank_reading_backdating_max_hours === undefined ? current.max_hours : b.tank_reading_backdating_max_hours ?? 24,
        reason_required: b.tank_reading_backdating_reason_required === undefined ? current.reason_required : b.tank_reading_backdating_reason_required ?? true,
      };
      return { data: {} } as never;
    }
    if (settings && (!init?.method || init.method === 'GET')) {
      const p = world.policy ?? DEFAULT_POLICY;
      return { data: { tank_reading_backdating_policy: p.policy, tank_reading_backdating_max_hours: p.max_hours, tank_reading_backdating_reason_required: p.reason_required } } as never;
    }

    if (init?.method === 'POST' && route === '/fuel-stations/readings') {
      const post: Post = { path: route, method: 'POST', body: clone((init.body ?? {}) as Record<string, unknown>) };
      world.gets.pop();
      world.posts.push(post);
      world.beforePost?.(post, world);
      const b = post.body as { fuel_station_id: string; fuel_tank_id: string; reading_type: 'physical' | 'atg'; quantity_liters: string; evidence_key: string; evidence?: { method?: string; note?: string } };
      const tank = world.tanks.find((t) => t.id === b.fuel_tank_id && t.station === b.fuel_station_id);
      if (!tank) throw new ApiError(404, 'not found', {});
      const quantity = toMl(b.quantity_liters);
      const lateBody = post.body as { measured_at?: string; late_reason?: string };
      const requestsList = (world.requests ??= []);
      const sameRequest = requestsList.find((r) => r.evidence_key === b.evidence_key);
      if (sameRequest) {
        if (sameRequest.fuel_tank_id === tank.id && sameRequest.quantity_milliliters === quantity && sameRequest.measured_at === new Date(lateBody.measured_at ?? '').toISOString()) return { data: requestView(sameRequest) } as never;
        throw new ApiError(422, 'FUEL_READING_EVIDENCE_MISMATCH: مفتاح دليل القياس مستخدم مسبقاً ولا يمكن تسجيل القياس مرتين.', {});
      }
      const existing = world.readings.find((r) => r.evidence_key === b.evidence_key);
      if (existing) {
        if (existing.fuel_tank_id === tank.id && existing.reading_type === b.reading_type && existing.quantity_milliliters === quantity && existing.recorded_by === world.viewerId) return { data: clone(existing) } as never;
        throw new ApiError(422, 'FUEL_READING_EVIDENCE_MISMATCH: مفتاح دليل القياس مستخدم مسبقاً ولا يمكن تسجيل القياس مرتين.', {});
      }
      if (quantity > tank.capacity) throw new ApiError(422, 'FUEL_READING_EXCEEDS_CAPACITY: الكمية المقاسة تتجاوز سعة الخزان المعتمدة ولا تُقبل.', {});
      const policy = world.policy ?? DEFAULT_POLICY;
      const explicit = lateBody.measured_at ? Date.parse(lateBody.measured_at) : null;
      const nowMs = Date.parse(world.now);
      const backdated = explicit !== null && explicit < nowMs - 300_000;
      if (explicit !== null && explicit > nowMs + 300_000) throw new ApiError(422, 'FUEL_READING_FUTURE_TIME: وقت القياس في المستقبل ولا يُقبل.', {});
      if (backdated) {
        if (policy.policy === 'deny') throw new ApiError(422, 'FUEL_READING_BACKDATING_DENIED: سياسة المحطة لا تسمح بتسجيل قراءات بتاريخ سابق.', {});
        if (nowMs - (explicit as number) > policy.max_hours * 3_600_000) throw new ApiError(422, 'FUEL_READING_BACKDATING_TOO_OLD: القراءة أقدم من الحد الأقصى.', {});
        const reason = (lateBody.late_reason ?? '').trim();
        if (policy.reason_required && reason === '') throw new ApiError(422, 'FUEL_READING_BACKDATING_REASON_REQUIRED: سبب القراءة المتأخرة إلزامي.', {});
        if (policy.policy === 'supervisor_approval') {
          const request: StoredRequest = {
            id: `00000000-0000-4000-8000-${String(900 + ++seq).padStart(12, '0')}`, status: 'pending', fuel_tank_id: tank.id, fuel_station_id: tank.station, reading_type: b.reading_type, quantity_milliliters: quantity,
            evidence_key: b.evidence_key, evidence: b.evidence ?? null, reason: reason || null, measured_at: new Date(explicit as number).toISOString(), requested_at: world.now,
            requested_by: world.viewerId, requester_name: world.viewerName, decided_by: null, decider_name: null, decided_at: null, decision_note: null, fuel_tank_reading_id: null,
          };
          requestsList.push(request);
          if (world.dropReplyAfterApply?.(post)) throw new TypeError('Failed to fetch');
          return { data: requestView(request) } as never;
        }
        if (world.canLateRecord !== true) throw new ApiError(422, 'FUEL_READING_BACKDATING_NOT_AUTHORIZED: تسجيل قراءة بتاريخ سابق يتطلب صلاحية مخصَّصة لذلك.', {});
      }
      const reading: StoredReading = {
        id: `rd-${++seq}`, fuel_tank_id: tank.id, fuel_station_id: tank.station, reading_type: b.reading_type, quantity_milliliters: quantity,
        evidence_key: b.evidence_key, evidence: backdated ? { ...(b.evidence ?? {}), late_reason: (lateBody.late_reason ?? '').trim() } : b.evidence ?? null, recorded_by: world.viewerId, recorder_name: world.viewerName,
        measured_at: explicit !== null ? new Date(explicit).toISOString() : world.now,
      };
      world.readings.push(reading);
      if (world.dropReplyAfterApply?.(post)) throw new TypeError('Failed to fetch');
      return { data: clone(reading) } as never;
    }

    if (route === '/fuel-stations/tank-levels') {
      const stationId = query.get('station_id');
      return { data: world.tanks.filter((t) => !stationId || t.station === stationId).filter((t) => t.status !== 'inactive').map(levelFor), meta: { generated_at: world.now } } as never;
    }

    if (route === '/fuel-stations/readings') {
      const per = Number(query.get('per_page') ?? 0) || world.readings.length || 1;
      const rows = world.readings
        .filter((r) => !query.get('fuel_tank_id') || r.fuel_tank_id === query.get('fuel_tank_id'))
        .filter((r) => !query.get('reading_type') || r.reading_type === query.get('reading_type'))
        .sort((a, b) => (a.measured_at < b.measured_at ? 1 : a.measured_at > b.measured_at ? -1 : b.id.localeCompare(a.id)));
      const page = Number(query.get('page') ?? 1);
      const slice = rows.slice((page - 1) * per, page * per).map((r) => ({
        ...r, quantity_liters: liters(r.quantity_milliliters), recorder: r.recorded_by ? { id: r.recorded_by, name: r.recorder_name } : null, created_at: r.measured_at, flags: [] as string[], late_entry: !!(r.evidence && 'late_reason' in r.evidence), late_reason: (r.evidence as { late_reason?: string } | null)?.late_reason ?? null,
      }));
      return { data: slice, meta: { current_page: page, last_page: Math.max(1, Math.ceil(rows.length / per)), total: rows.length } } as never;
    }

    return base.handler(path, init?.headers as Record<string, string> | undefined) as never;
  });
}
