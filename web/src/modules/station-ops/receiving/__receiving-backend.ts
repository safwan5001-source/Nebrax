import { ApiError } from '@/lib/api';
import { createBackend, type TenantData } from '../__test-harness';
import type { Delivery, Supplier, TankReading } from './schemas';

/**
 * حزمة اختبار (للاختبارات فقط): خادم وهمي **بحالة** لدورة الاستلام. يحاكي أشكال الاستجابة وقواعد الدورة المثبتة في `FuelSupplyReceivingService`:
 * idempotency بالمفتاح (نفس الحمولة ⇒ الأصل، مختلفة ⇒ 422)، مفتاح دليل القراءة فريد، الاعتماد مرة واحدة، فصل المعتمِد، ومفتاح التكلفة يغيب لمن لا يملكها.
 * قواعد السقف والنطاق الحقيقية مختبَرة في الخادم (PHP) ولا تُعاد كتابتها هنا إلا كحقن أعطال صريح.
 */
export interface Post { path: string; body: Record<string, unknown> }
export interface ReceivingWorld {
  data: TenantData;
  deliveries: Array<Delivery & { _key?: string }>;
  suppliers: Supplier[];
  readings: TankReading[];
  posts: Post[];
  gets: string[];
  viewerId: string;
  canSeeCost: boolean;
  /** سياسة المعتمِد المختلف. */
  distinctApprover: boolean;
  /** يُستدعى قبل تطبيق أي POST؛ يرمي ApiError أو خطأ شبكة. */
  beforePost?: (post: Post, world: ReceivingWorld) => void;
  /** ضياع الردّ بعد التطبيق لمسارات تطابق الدالة. */
  dropReplyAfterApply?: (post: Post) => boolean;
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const ml = (liters: string) => Math.round(Number(liters) * 1000);

export function connectReceiving(world: ReceivingWorld, apiMock: { mockImplementation: (fn: (path: string, init?: { method?: string; body?: unknown; headers?: HeadersInit }) => Promise<never>) => unknown }) {
  const base = createBackend(world.data);
  let seq = 0;

  const view = (row: Delivery & { _key?: string }): Delivery => {
    const copy = clone(row) as Delivery & { _key?: string };
    delete copy._key;
    if (!world.canSeeCost) delete (copy as { received_total_cost_minor?: number }).received_total_cost_minor;
    const lookup = (id?: string | null) => { const r = world.readings.find((x) => x.id === id); return r ? { id: r.id, quantity_milliliters: r.quantity_milliliters, quantity_liters: String(r.quantity_milliliters / 1000), measured_at: r.measured_at ?? null } : id ? { id } : null; };
    const raw = row as unknown as Record<string, string | null | undefined>;
    copy.readings = { before_physical: lookup(raw.before_physical_reading_id), after_physical: lookup(raw.after_physical_reading_id), before_atg: lookup(raw.before_atg_reading_id), after_atg: lookup(raw.after_atg_reading_id) };
    return copy;
  };

  apiMock.mockImplementation(async (path: string, init?: { method?: string; body?: unknown; headers?: HeadersInit }) => {
    if (path === '/me') return { user: JSON.parse(localStorage.getItem('user') as string) } as never;
    const [route, search = ''] = path.split('?');
    const query = new URLSearchParams(search);

    if (init?.method === 'POST' && route.startsWith('/fuel-stations/')) {
      const post: Post = { path: route, body: clone((init.body ?? {}) as Record<string, unknown>) };
      world.posts.push(post);
      world.beforePost?.(post, world);
      const drop = () => { if (world.dropReplyAfterApply?.(post)) throw new TypeError('Failed to fetch'); };

      if (route === '/fuel-stations/readings') {
        const b = post.body as { fuel_station_id: string; fuel_tank_id: string; reading_type: string; quantity_liters: string; evidence_key: string };
        if (world.readings.some((r) => r.evidence_key === b.evidence_key)) throw new ApiError(422, 'مفتاح دليل القياس مستخدم مسبقاً ولا يمكن تسجيل القياس مرتين.', {});
        const reading: TankReading = { id: `rd-${++seq}`, fuel_tank_id: b.fuel_tank_id, reading_type: b.reading_type, quantity_milliliters: ml(b.quantity_liters), evidence_key: b.evidence_key, measured_at: '2026-11-06T08:00:00+00:00' };
        world.readings.push(reading);
        drop();
        return { data: clone(reading) } as never;
      }

      if (route === '/fuel-stations/deliveries') {
        const b = post.body as Record<string, string | number>;
        const existing = world.deliveries.find((d) => d._key === b.idempotency_key);
        if (existing) {
          if (existing.received_milliliters !== ml(String(b.received_liters)) || existing.supplier_id !== b.supplier_id) throw new ApiError(422, 'FUEL_IDEMPOTENCY_PAYLOAD_MISMATCH: مفتاح idempotency مستعمل لاستلام وقود بمحتوى مختلف (received_milliliters).', {});
          return { data: view(existing) } as never;
        }
        if (b.delivery_note_number && world.deliveries.some((d) => d.supplier_id === b.supplier_id && d.delivery_note_number === b.delivery_note_number)) throw new ApiError(422, 'FUEL_DELIVERY_DUPLICATE: مفتاح الاستلام أو رقم إذن التسليم لهذا المورد مسجَّل مسبقاً.', {});
        const supplier = world.suppliers.find((s) => s.id === b.supplier_id);
        const tank = world.data.tanks.find((t) => t.id === b.fuel_tank_id);
        const row = {
          id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, _key: String(b.idempotency_key), status: 'draft', station_id: String(b.fuel_station_id), tank_id: String(b.fuel_tank_id),
          fuel_product_id: String(b.fuel_product_id), warehouse_id: String(b.warehouse_id), supplier_id: String(b.supplier_id), purchase_reference: (b.purchase_reference as string) ?? null,
          delivery_note_number: (b.delivery_note_number as string) ?? null, dispatched_milliliters: ml(String(b.dispatched_liters)), received_milliliters: ml(String(b.received_liters)),
          transit_variance_milliliters: ml(String(b.received_liters)) - ml(String(b.dispatched_liters)), received_total_cost_minor: Number(b.received_total_cost_minor), stock_movement_id: null,
          received_at: '2026-11-06T08:30:00+00:00', approved_at: null, approved_by: null, notes: (b.notes as string) ?? null, created_at: '2026-11-06T08:30:00+00:00', created_by: world.viewerId,
          tanker_identifier: (b.tanker_identifier as string) ?? null, driver_name: (b.driver_name as string) ?? null, supplier: supplier ? { id: supplier.id, name: supplier.name, code: supplier.code ?? null } : null,
          tank: tank ? { id: tank.id, name: tank.name, code: tank.code } : null, warehouse: { id: String(b.warehouse_id), name: 'Main Warehouse', code: 'WH' },
          before_physical_reading_id: (b.before_physical_reading_id as string) ?? null, after_physical_reading_id: (b.after_physical_reading_id as string) ?? null,
          before_atg_reading_id: (b.before_atg_reading_id as string) ?? null, after_atg_reading_id: (b.after_atg_reading_id as string) ?? null,
        } as unknown as Delivery & { _key?: string };
        world.deliveries.unshift(row);
        drop();
        return { data: view(row) } as never;
      }

      const approve = /^\/fuel-stations\/deliveries\/([\w-]+)\/approve$/.exec(route);
      if (approve) {
        const row = world.deliveries.find((d) => d.id === approve[1]);
        if (!row) throw new ApiError(404, 'not found', {});
        if (row.status !== 'draft') throw new ApiError(422, 'لا يمكن اعتماد استلام وقود غير مسوّد أو معتمد سابقاً.', {});
        if (world.distinctApprover && row.created_by === world.viewerId) throw new ApiError(422, 'FUEL_DISTINCT_APPROVER_REQUIRED: سياسة المحطة تتطلب أن يعتمد استلام الوقود مستخدمٌ غير الذي أنشأه.', {});
        row.status = 'approved';
        row.approved_by = world.viewerId;
        row.approved_at = '2026-11-06T09:00:00+00:00';
        drop();
        return { data: view(row) } as never;
      }
      throw new ApiError(404, 'not found', {});
    }

    world.gets.push(path);
    if (route === '/fuel-stations/deliveries') {
      const rows = world.deliveries.filter((d) => (!query.get('station_id') || d.station_id === query.get('station_id')) && (!query.get('status') || d.status === query.get('status')));
      const per = 50;
      const page = Number(query.get('page') ?? 1);
      return { data: rows.slice((page - 1) * per, page * per).map(view), meta: { current_page: page, last_page: Math.max(1, Math.ceil(rows.length / per)) } } as never;
    }
    const one = /^\/fuel-stations\/deliveries\/([\w-]+)$/.exec(route);
    if (one) {
      const row = world.deliveries.find((d) => d.id === one[1]);
      if (!row) throw new ApiError(404, 'not found', {});
      return { data: view(row) } as never;
    }
    if (route === '/fuel-stations/delivery-suppliers') {
      const q = (query.get('q') ?? '').toLowerCase();
      return { data: world.suppliers.filter((s) => q === '' || s.name.toLowerCase().includes(q)) } as never;
    }
    if (route === '/fuel-stations/readings') return { data: clone(world.readings.filter((r) => !query.get('fuel_tank_id') || r.fuel_tank_id === query.get('fuel_tank_id'))) } as never;
    return base.handler(path, init?.headers as Record<string, string> | undefined) as never;
  });
}
