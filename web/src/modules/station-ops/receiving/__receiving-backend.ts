import { ApiError } from '@/lib/api';
import { createBackend, type TenantData } from '../__test-harness';
import type { Attachment, Delivery, Supplier, TankReading } from './schemas';

/**
 * حزمة اختبار (للاختبارات فقط): خادم وهمي **بحالة** لدورة الاستلام. يحاكي أشكال الاستجابة وقواعد الدورة المثبتة في `FuelSupplyReceivingService`:
 * idempotency بالمفتاح (نفس الحمولة ⇒ الأصل، مختلفة ⇒ 422)، مفتاح دليل القراءة فريد، الاعتماد مرة واحدة، فصل المعتمِد، ومفتاح التكلفة يغيب لمن لا يملكها.
 * قواعد السقف والنطاق الحقيقية مختبَرة في الخادم (PHP) ولا تُعاد كتابتها هنا إلا كحقن أعطال صريح.
 */
export interface Post { path: string; method?: string; body: Record<string, unknown> }
export interface ReceivingWorld {
  data: TenantData;
  deliveries: Array<Delivery & { _key?: string }>;
  suppliers: Supplier[];
  readings: TankReading[];
  /** مرفقات كل استلام (معرّف الاستلام ← قائمة). */
  attachments?: Record<string, Attachment[]>;
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
const UID_ATT = (n: number) => `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`;

export function connectReceiving(world: ReceivingWorld, apiMock: { mockImplementation: (fn: (path: string, init?: { method?: string; body?: unknown; headers?: HeadersInit }) => Promise<never>) => unknown }) {
  const base = createBackend(world.data);
  let seq = 0;

  const view = (row: Delivery & { _key?: string }): Delivery => {
    const copy = clone(row) as Delivery & { _key?: string };
    delete copy._key;
    if (!world.canSeeCost) {
      delete (copy as { received_total_cost_minor?: number | null }).received_total_cost_minor;
      delete (copy as { cost_recorded_by?: string | null }).cost_recorded_by;
      delete (copy as { cost_recorded_at?: string | null }).cost_recorded_at;
    }
    const cost = (row as unknown as { received_total_cost_minor?: number | null }).received_total_cost_minor;
    (copy as { cost_recorded?: boolean }).cost_recorded = cost !== null && cost !== undefined;
    const files = world.attachments?.[row.id] ?? [];
    (copy as { attachments_count?: number }).attachments_count = files.length;
    (copy as { attachments?: Attachment[] }).attachments = clone(files);
    const lookup = (id?: string | null) => { const r = world.readings.find((x) => x.id === id); return r ? { id: r.id, quantity_milliliters: r.quantity_milliliters, quantity_liters: String(r.quantity_milliliters / 1000), measured_at: r.measured_at ?? null } : id ? { id } : null; };
    const raw = row as unknown as Record<string, string | null | undefined>;
    copy.readings = { before_physical: lookup(raw.before_physical_reading_id), after_physical: lookup(raw.after_physical_reading_id), before_atg: lookup(raw.before_atg_reading_id), after_atg: lookup(raw.after_atg_reading_id) };
    return copy;
  };

  const litersText = (value: number) => (value / 1000).toString();
  const documentPayload = (row: Delivery & { _key?: string }, variant: string) => {
    const r = row as unknown as Record<string, unknown>;
    const doc: Record<string, unknown> = {
      variant, generated_at: '2026-11-06T10:00:00+00:00', generated_by: 'Sup Visor', company: { name: 'Acme Fuel Co', vat_number: '300000000000003', cr_number: '1010', currency: 'SAR' },
      station: { code: 'A', name: 'Station A', city: null, address: null }, reference: `FD-${row.id.slice(0, 8).toUpperCase()}`, status: row.status,
      delivery_note_number: row.delivery_note_number ?? null, purchase_reference: row.purchase_reference ?? null,
      supplier: row.supplier ? { name: row.supplier.name ?? null, code: row.supplier.code ?? null } : null, product: { code: 'P1', name: 'Alpha' }, tank: row.tank ? { code: row.tank.code ?? null, name: row.tank.name ?? null } : null,
      warehouse: { code: 'WH', name: 'Main Warehouse' }, tanker_identifier: row.tanker_identifier ?? null, driver_name: row.driver_name ?? null,
      quantities: { dispatched_liters: litersText(row.dispatched_milliliters), received_liters: litersText(row.received_milliliters), transit_variance_liters: litersText(row.transit_variance_milliliters), transit_variance_percent: '-0.45' },
      readings: { before_physical: null, after_physical: null, before_atg: null, after_atg: null }, received_at: row.received_at ?? null, received_by: 'Creator', approved_by: row.approved_by ? 'Approver' : null, approved_at: row.approved_at ?? null,
      notes: row.notes ?? null, attachments: (world.attachments?.[row.id] ?? []).map((a) => ({ name: a.name, mime_type: a.mime_type ?? null, size: a.size })),
    };
    if (variant === 'financial') doc.cost = { currency: 'SAR', total_minor: (r.received_total_cost_minor as number | null) ?? null, per_liter: null, recorded_by: null, recorded_at: null };
    return doc;
  };
  const reportPayload = (rows: Array<Delivery & { _key?: string }>, variant: string) => ({
    variant, generated_at: '2026-11-06T10:00:00+00:00', generated_by: 'Sup Visor', company: { name: 'Acme Fuel Co', vat_number: null, cr_number: null, currency: 'SAR' }, filters: [], truncated: false,
    rows: rows.map((row) => ({
      reference: `FD-${row.id.slice(0, 8).toUpperCase()}`, received_at: row.received_at ?? null, status: row.status, delivery_note_number: row.delivery_note_number ?? null, station: 'Station A', supplier: row.supplier?.name ?? null, product: 'Alpha', tank: row.tank?.code ?? null,
      dispatched_liters: litersText(row.dispatched_milliliters), received_liters: litersText(row.received_milliliters), transit_variance_liters: litersText(row.transit_variance_milliliters),
      ...(variant === 'financial' ? { total_cost_minor: (row as unknown as { received_total_cost_minor?: number | null }).received_total_cost_minor ?? null } : {}),
    })),
    totals: { count: rows.length, dispatched_liters: '0', received_liters: '0', transit_variance_liters: '0', ...(variant === 'financial' ? { total_cost_minor: 0, uncosted_count: 0 } : {}) },
  });

  apiMock.mockImplementation(async (path: string, init?: { method?: string; body?: unknown; headers?: HeadersInit }) => {
    if (path === '/me') return { user: JSON.parse(localStorage.getItem('user') as string) } as never;
    const [route, search = ''] = path.split('?');
    const query = new URLSearchParams(search);

    if ((init?.method === 'POST' || init?.method === 'DELETE') && route.startsWith('/fuel-stations/')) {
      const isForm = typeof FormData !== 'undefined' && init.body instanceof FormData;
      const uploaded = isForm ? (init.body as FormData).getAll('attachments[]').filter((entry): entry is File => entry instanceof File) : [];
      const post: Post = { path: route, method: init.method, body: isForm ? { files: uploaded.map((file) => file.name) } : clone((init.body ?? {}) as Record<string, unknown>) };
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
          transit_variance_milliliters: ml(String(b.received_liters)) - ml(String(b.dispatched_liters)), received_total_cost_minor: b.received_total_cost_minor === undefined ? null : Number(b.received_total_cost_minor), stock_movement_id: null,
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
        const stored = (row as unknown as { received_total_cost_minor?: number | null }).received_total_cost_minor;
        if (stored === null || stored === undefined) throw new ApiError(422, 'FUEL_DELIVERY_COST_REQUIRED: لا يمكن اعتماد استلام قبل تسجيل تكلفته الفعلية.', {});
        const expected = (post.body as { expected_total_cost_minor?: number }).expected_total_cost_minor;
        if (expected !== undefined && expected !== stored) throw new ApiError(409, 'FUEL_DELIVERY_COST_CHANGED: تغيّرت تكلفة الاستلام بعد مراجعتك؛ أعد المراجعة.', {});
        if ((row.delivery_note_number ?? '').trim() === '' && (world.attachments?.[row.id] ?? []).length === 0) throw new ApiError(422, 'FUEL_DELIVERY_DOCUMENT_REQUIRED: يلزم رقم سند التسليم أو إرفاق صورة السند قبل الاعتماد.', {});
        row.status = 'approved';
        row.approved_by = world.viewerId;
        row.approved_at = '2026-11-06T09:00:00+00:00';
        drop();
        return { data: view(row) } as never;
      }
      const cost = /^\/fuel-stations\/deliveries\/([\w-]+)\/cost$/.exec(route);
      if (cost) {
        const row = world.deliveries.find((d) => d.id === cost[1]);
        if (!row) throw new ApiError(404, 'not found', {});
        const value = (post.body as { received_total_cost_minor?: number }).received_total_cost_minor;
        if (!Number.isInteger(value) || (value as number) < 1) throw new ApiError(422, 'تكلفة الاستلام الفعلية يجب أن تكون هللات صحيحة موجبة.', {});
        if (row.status !== 'draft') throw new ApiError(422, 'FUEL_DELIVERY_COST_LOCKED: لا يمكن تعديل تكلفة استلام معتمد.', {});
        (row as unknown as Record<string, unknown>).received_total_cost_minor = value;
        (row as unknown as Record<string, unknown>).cost_recorded_by = world.viewerId;
        (row as unknown as Record<string, unknown>).cost_recorded_at = '2026-11-06T09:30:00+00:00';
        drop();
        return { data: view(row) } as never;
      }

      const attach = /^\/fuel-stations\/deliveries\/([\w-]+)\/attachments$/.exec(route);
      if (attach && init.method === 'POST') {
        const row = world.deliveries.find((d) => d.id === attach[1]);
        if (!row) throw new ApiError(404, 'not found', {});
        world.attachments ??= {};
        const list = (world.attachments[row.id] ??= []);
        const out: Attachment[] = [];
        for (const file of uploaded) {
          const found = list.find((a) => a.name === file.name && a.size === file.size);
          if (found) { out.push(found); continue; }
          const created: Attachment = { id: UID_ATT(++seq), name: file.name, mime_type: file.type || 'application/pdf', size: file.size, uploaded_by: world.viewerId, created_at: '2026-11-06T09:10:00+00:00' };
          list.push(created);
          out.push(created);
        }
        drop();
        return { data: clone(out) } as never;
      }
      const attachment = /^\/fuel-stations\/deliveries\/([\w-]+)\/attachments\/([\w-]+)$/.exec(route);
      if (attachment && init.method === 'DELETE') {
        const row = world.deliveries.find((d) => d.id === attachment[1]);
        if (!row) throw new ApiError(404, 'not found', {});
        if (row.status !== 'draft') throw new ApiError(422, 'لا يمكن حذف مرفق استلام معتمد.', {});
        world.attachments![row.id] = (world.attachments![row.id] ?? []).filter((a) => a.id !== attachment[2]);
        drop();
        return null as never;
      }
      throw new ApiError(404, 'not found', {});
    }

    world.gets.push(path);
    if (route === '/fuel-stations/deliveries') {
      const needle = (query.get('q') ?? '').toLowerCase();
      const rows = world.deliveries.filter((d) => (!query.get('station_id') || d.station_id === query.get('station_id')) && (!query.get('status') || d.status === query.get('status'))
        && (needle === '' || (d.delivery_note_number ?? '').toLowerCase().includes(needle) || (d.purchase_reference ?? '').toLowerCase().includes(needle) || (d.supplier?.name ?? '').toLowerCase().includes(needle))
        && (!query.get('cost') || ((d as unknown as { received_total_cost_minor?: number | null }).received_total_cost_minor == null) === (query.get('cost') === 'missing')));
      const per = 50;
      const page = Number(query.get('page') ?? 1);
      return { data: rows.slice((page - 1) * per, page * per).map(view), meta: { current_page: page, last_page: Math.max(1, Math.ceil(rows.length / per)) } } as never;
    }
    const variant = query.get('variant') ?? 'operational';
    if ((route === '/fuel-stations/deliveries/report' || /\/document$/.test(route)) && variant === 'financial' && !world.canSeeCost) throw new ApiError(403, 'النسخة المالية تتطلب صلاحية عرض التكلفة.', {});
    if (route === '/fuel-stations/deliveries/report') {
      const rows = world.deliveries.filter((d) => !query.get('station_id') || d.station_id === query.get('station_id'));
      return { data: reportPayload(rows, variant) } as never;
    }
    const docMatch = /^\/fuel-stations\/deliveries\/([\w-]+)\/document$/.exec(route);
    if (docMatch) {
      const row = world.deliveries.find((d) => d.id === docMatch[1]);
      if (!row) throw new ApiError(404, 'not found', {});
      return { data: documentPayload(row, variant) } as never;
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
