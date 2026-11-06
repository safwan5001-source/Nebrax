import { ApiError } from '@/lib/api';
import { createBackend, type TenantData } from '../__test-harness';

/**
 * حزمة اختبار (للاختبارات فقط): خادم وهمي **بحالة** لقراءات الخزانات. يحاكي عقد الخادم المثبت في `FuelReconciliationService::recordReading`:
 * idempotency بمفتاح الدليل (نفس الحمولة ⇒ القراءة الأولى، مختلفة ⇒ 422)، رفض ما فوق السعة، وحساب `tank-levels` من القراءات المخزَّنة.
 * قواعد النطاق والزمن والتزامن الحقيقية مختبَرة في الخادم (PHP) ولا تُعاد كتابتها هنا إلا كحقن أعطال صريح.
 */
export interface StoredReading {
  id: string; fuel_tank_id: string; fuel_station_id: string; reading_type: 'physical' | 'atg'; quantity_milliliters: number;
  evidence_key: string; evidence: { method?: string; note?: string } | null; recorded_by: string | null; recorder_name: string | null; measured_at: string;
}
export interface TankSpec { id: string; station: string; code: string; name: string; capacity: number; safe: number; minimum: number; dead: number; status?: string }
export interface Post { path: string; body: Record<string, unknown> }
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
  beforePost?: (post: Post, world: TanksWorld) => void;
  dropReplyAfterApply?: (post: Post) => boolean;
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const toMl = (liters: string) => Math.round(Number(liters) * 1000);
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
      latest: latest ? readingRow(latest) : null,
      latest_by_type: { physical: latestOf(tank.id, 'physical') ? readingRow(latestOf(tank.id, 'physical') as StoredReading) : null, atg: latestOf(tank.id, 'atg') ? readingRow(latestOf(tank.id, 'atg') as StoredReading) : null },
      level: {
        fill_basis_points: q === null ? null : Math.floor((q * 10000 + Math.floor(tank.capacity / 2)) / tank.capacity),
        available_milliliters: q === null ? null : Math.max(tank.capacity - q, 0), available_liters: q === null ? null : liters(Math.max(tank.capacity - q, 0)),
        safe_available_milliliters: q === null ? null : Math.max(tank.safe - q, 0), age_seconds: age, freshness, stale_after_minutes: world.staleAfter, flags, needs_review: flags.length > 0,
      },
    };
  };

  apiMock.mockImplementation(async (path: string, init?: { method?: string; body?: unknown; headers?: HeadersInit }) => {
    if (path === '/me') return { user: JSON.parse(localStorage.getItem('user') as string) } as never;
    const [route, search = ''] = path.split('?');
    const query = new URLSearchParams(search);
    world.gets.push(path);

    if (init?.method === 'POST' && route === '/fuel-stations/readings') {
      const post: Post = { path: route, body: clone((init.body ?? {}) as Record<string, unknown>) };
      world.gets.pop();
      world.posts.push(post);
      world.beforePost?.(post, world);
      const b = post.body as { fuel_station_id: string; fuel_tank_id: string; reading_type: 'physical' | 'atg'; quantity_liters: string; evidence_key: string; evidence?: { method?: string; note?: string } };
      const tank = world.tanks.find((t) => t.id === b.fuel_tank_id && t.station === b.fuel_station_id);
      if (!tank) throw new ApiError(404, 'not found', {});
      const quantity = toMl(b.quantity_liters);
      const existing = world.readings.find((r) => r.evidence_key === b.evidence_key);
      if (existing) {
        if (existing.fuel_tank_id === tank.id && existing.reading_type === b.reading_type && existing.quantity_milliliters === quantity && existing.recorded_by === world.viewerId) return { data: clone(existing) } as never;
        throw new ApiError(422, 'FUEL_READING_EVIDENCE_MISMATCH: مفتاح دليل القياس مستخدم مسبقاً ولا يمكن تسجيل القياس مرتين.', {});
      }
      if (quantity > tank.capacity) throw new ApiError(422, 'FUEL_READING_EXCEEDS_CAPACITY: الكمية المقاسة تتجاوز سعة الخزان المعتمدة ولا تُقبل.', {});
      const reading: StoredReading = {
        id: `rd-${++seq}`, fuel_tank_id: tank.id, fuel_station_id: tank.station, reading_type: b.reading_type, quantity_milliliters: quantity,
        evidence_key: b.evidence_key, evidence: b.evidence ?? null, recorded_by: world.viewerId, recorder_name: world.viewerName, measured_at: world.now,
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
        ...r, quantity_liters: liters(r.quantity_milliliters), recorder: r.recorded_by ? { id: r.recorded_by, name: r.recorder_name } : null, created_at: r.measured_at, flags: [] as string[],
      }));
      return { data: slice, meta: { current_page: page, last_page: Math.max(1, Math.ceil(rows.length / per)), total: rows.length } } as never;
    }

    return base.handler(path, init?.headers as Record<string, string> | undefined) as never;
  });
}
