import { ApiError } from '@/lib/api';
import { nozzle, product, pump, shift, station, tank } from '../__fixtures__';
import type { Nozzle, Pump, Shift, Station, Tank } from '../schemas';

/**
 * حزمة اختبار (للاختبارات فقط): خادم وهمي **بحالة** لتسجيل تعبئة الصهاريج. يحاكي أشكال الاستجابة وقواعد الخادم الأساسية فقط (الوردية المفتوحة، idempotency بالمفتاح والمحتوى، السند المكرر،
 * البوابة المغلقة) — القواعد الحقيقية مختبَرة في PHP (`FuelTankerFillTest`/`FuelTankerFillStationSessionTest`) ولا تُعاد كتابتها هنا إلا كحقن أعطال صريح.
 */
export const UID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const ST = 'st1';
export const OWNER_A = UID(101);
export const OWNER_B = UID(102);
export const TANKER_A = UID(201);

export interface FillRowWorld {
  id: string; number: string; voucher_number: string; status: string; inventory_status: string; fuel_station_id: string; fuel_shift_id: string; fuel_pump_id: string; fuel_nozzle_id: string; fuel_tank_id: string;
  fuel_product_id: string; fuel_tanker_owner_id: string; fuel_tanker_id: string | null; quantity_milliliters: number; quantity_liters: string; capacity_overrun_milliliters: number | null;
  recorded_at: string; voided_at: string | null; owner: { id: string; name: string; code: string | null } | null; tanker: { id: string; plate_number: string; capacity_milliliters: number | null } | null; attachments_count: number;
  _key?: string; _fingerprint?: string;
}

export interface World {
  station: Station;
  pumps: Pump[];
  nozzles: Nozzle[];
  tanks: Tank[];
  openShift: Shift | null;
  settings: Record<string, unknown>;
  owners: Array<{ id: string; name: string; code: string | null; status: string }>;
  tankers: Array<{ id: string; fuel_tanker_owner_id: string; plate_number: string; capacity_milliliters: number | null; status: string }>;
  fills: FillRowWorld[];
  posts: Array<Record<string, unknown>>;
  gets: string[];
  /** البوابة مغلقة ⇒ 404 على كل مسارات التعبئة. */
  gateClosed: boolean;
  /** يُطبَّق الطلب ثم يضيع الردّ (انقطاع بعد الإرسال). */
  dropReplyAfterApply: boolean;
  /** يفشل الطلب قبل أن يصل (لا أثر). */
  failBeforeApply: boolean;
  /** رفض صريح من الخادم لكل POST. */
  rejectWith: { status: number; reason: string; message?: string } | null;
}

export function buildWorld(over: Partial<World> = {}): World {
  const s = { ...station(ST, { name: 'Station One' }), timezone: 'Asia/Riyadh' } as Station;
  return {
    station: s,
    pumps: [pump('pu1', ST), pump('pu2', ST)],
    nozzles: [
      nozzle('nz1', ST, 'pu1', 'tk1', 'p1'),
      nozzle('nz2', ST, 'pu1', 'tk1', 'p1', { allowed_operations: ['direct_sale'] } as never),
      nozzle('nz3', ST, 'pu2', 'tk1', 'p1', { status: 'inactive' }),
    ],
    tanks: [tank('tk1', ST, 'p1', { name: 'Tank Diesel' })],
    openShift: shift('sh1', ST, { number: 'FSH-0001' }),
    settings: { tanker_selection_required: false, tanker_capacity_overrun_policy: 'allow_with_confirmation', tanker_voucher_unique_scope: 'station' },
    owners: [{ id: OWNER_A, name: 'Askar', code: 'ASK', status: 'active' }, { id: OWNER_B, name: 'Bakr', code: 'BKR', status: 'active' }],
    tankers: [{ id: TANKER_A, fuel_tanker_owner_id: OWNER_A, plate_number: 'ABJ 1234', capacity_milliliters: 5_000_000, status: 'active' }],
    fills: [], posts: [], gets: [], gateClosed: false, dropReplyAfterApply: false, failBeforeApply: false, rejectWith: null, ...over,
  };
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const publicRow = (row: FillRowWorld) => { const copy = clone(row); delete copy._key; delete copy._fingerprint; return copy; };

export function connect(world: World, apiMock: { mockImplementation: (fn: (path: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) => Promise<unknown>) => unknown }) {
  let seq = 0;
  apiMock.mockImplementation(async (url, init) => {
    const [path, search = ''] = url.split('?');
    const query = new URLSearchParams(search);
    const method = init?.method ?? 'GET';
    if (method === 'GET') world.gets.push(url);

    if (path.startsWith('/fuel-stations/tanker')) {
      if (world.gateClosed) throw new ApiError(404, 'غير موجود', { message: 'غير موجود' });
    }

    if (method === 'POST' && path === '/fuel-stations/tanker-fills') {
      const body = (init?.body ?? {}) as Record<string, unknown>;
      world.posts.push(body);
      if (world.failBeforeApply) throw new TypeError('Failed to fetch');
      if (world.rejectWith) throw new ApiError(world.rejectWith.status, world.rejectWith.message ?? 'رفض', { message: world.rejectWith.message ?? 'رفض', reason: world.rejectWith.reason });
      const key = String(body.idempotency_key);
      const { idempotency_key: _k, ...rest } = body;
      const fingerprint = JSON.stringify(rest);
      const existing = world.fills.find((row) => row._key === key);
      if (existing) {
        if (existing._fingerprint !== fingerprint) throw new ApiError(409, 'مفتاح منع التكرار استُخدم سابقاً بمحتوى مختلف', { reason: 'idempotency_key_reused' });
        return { data: publicRow(existing), meta: { replayed: true } };
      }
      if (!world.openShift) throw new ApiError(422, 'لا توجد وردية مفتوحة', { message: 'لا توجد وردية مفتوحة', reason: 'shift_required' });
      if (body.fuel_shift_id && body.fuel_shift_id !== world.openShift.id) throw new ApiError(422, 'الوردية المحددة ليست الوردية المفتوحة', { reason: 'shift_not_open' });
      if (world.fills.some((row) => row.voucher_number === body.voucher_number)) throw new ApiError(409, 'السند الورقي مسجَّل سابقاً', { reason: 'voucher_duplicate' });
      const nz = world.nozzles.find((row) => row.id === body.fuel_nozzle_id);
      const owner = world.owners.find((row) => row.id === body.fuel_tanker_owner_id) ?? null;
      const tk = world.tankers.find((row) => row.id === body.fuel_tanker_id) ?? null;
      const quantity = Number(body.quantity_milliliters);
      const row: FillRowWorld = {
        id: UID(900 + (seq += 1)), number: `FTF-2027-${String(seq).padStart(5, '0')}`, voucher_number: String(body.voucher_number), status: 'recorded', inventory_status: 'pending_integration',
        fuel_station_id: String(body.fuel_station_id), fuel_shift_id: world.openShift.id, fuel_pump_id: nz?.fuel_pump_id ?? 'pu1', fuel_nozzle_id: String(body.fuel_nozzle_id), fuel_tank_id: nz?.fuel_tank_id ?? 'tk1',
        fuel_product_id: nz?.fuel_product_id ?? 'p1', fuel_tanker_owner_id: String(body.fuel_tanker_owner_id), fuel_tanker_id: tk?.id ?? null, quantity_milliliters: quantity,
        quantity_liters: `${Math.trunc(quantity / 1000)}.${String(quantity % 1000).padStart(3, '0')}`,
        capacity_overrun_milliliters: tk?.capacity_milliliters && quantity > tk.capacity_milliliters ? quantity - tk.capacity_milliliters : null,
        recorded_at: '2027-01-26T09:00:00+03:00', voided_at: null, owner: owner ? { id: owner.id, name: owner.name, code: owner.code } : null,
        tanker: tk ? { id: tk.id, plate_number: tk.plate_number, capacity_milliliters: tk.capacity_milliliters } : null, attachments_count: 0, _key: key, _fingerprint: fingerprint,
      };
      world.fills.push(row);
      if (world.dropReplyAfterApply) throw new TypeError('Failed to fetch');
      return { data: publicRow(row), meta: { replayed: false } };
    }

    switch (path) {
      case '/fuel-stations/stations': return { data: [world.station] };
      case '/fuel-stations/products': return { data: [product('p1', 'Diesel')] };
      case '/fuel-stations/pumps': return { data: world.pumps };
      case '/fuel-stations/nozzles': return { data: world.nozzles };
      case '/fuel-stations/tanks': return { data: world.tanks };
      case '/fuel-stations/shifts': return { data: world.openShift && query.get('status') === 'open' ? [world.openShift] : [], meta: { current_page: 1, last_page: 1 } };
      case '/fuel-stations/tanker-owners': {
        const q = (query.get('q') ?? '').toLowerCase();
        return { data: world.owners.filter((row) => (!query.get('status') || row.status === query.get('status')) && (!q || row.name.toLowerCase().includes(q) || (row.code ?? '').toLowerCase().includes(q))), meta: { current_page: 1, last_page: 1 } };
      }
      case '/fuel-stations/tankers':
        return { data: world.tankers.filter((row) => (!query.get('owner_id') || row.fuel_tanker_owner_id === query.get('owner_id')) && (!query.get('status') || row.status === query.get('status'))), meta: { current_page: 1, last_page: 1 } };
      case '/fuel-stations/tanker-fills': {
        const rows = world.fills.filter((row) => (!query.get('station_id') || row.fuel_station_id === query.get('station_id')) && (!query.get('shift_id') || row.fuel_shift_id === query.get('shift_id')) && (!query.get('voucher_number') || row.voucher_number === query.get('voucher_number')));
        return { data: rows.map(publicRow), meta: { current_page: 1, last_page: 1 } };
      }
      default: {
        const settings = /^\/fuel-stations\/stations\/([\w-]+)\/settings$/.exec(path);
        if (settings) return { data: world.settings };
        const one = /^\/fuel-stations\/tanker-fills\/([0-9a-fA-F-]{36})$/.exec(path);
        if (one) {
          const row = world.fills.find((r) => r.id === one[1]);
          if (!row) throw new ApiError(404, 'غير موجود', {});
          return { data: publicRow(row) };
        }
        throw new ApiError(404, 'not found', {});
      }
    }
  });
}
