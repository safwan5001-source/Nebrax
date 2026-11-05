import { ApiError } from '@/lib/api';
import { createBackend, type TenantData } from './__test-harness';
import { meter, shiftDetail, shift as shiftRow, tankReading } from './__fixtures__';
import type { CashMovement, ShiftDetail } from './schemas';

/**
 * حزمة اختبار (للاختبارات فقط): خادم وهمي **بحالة** يحاكي قواعد `FuelShiftService` الفعلية للكتابات الست — بالنص العربي الحرفي لرسائل
 * الخادم — كي تُختبر الشاشات ضد سلوك العقد (idempotency بالمفتاح، سجل واحد لكل فوهة/مرحلة، الإغلاق يرفض closing<opening، التغطية…) لا ضد
 * ما نتمنى. يسجّل كل POST ويتيح حقن أعطال (انقطاع بعد التطبيق، 5xx، رفض 422).
 */
export interface PostCall { path: string; body: Record<string, unknown>; headers?: Record<string, string> }
export type Fault =
  | { match: (call: PostCall) => boolean; mode: 'network_after_apply' | 'network_before_apply' | 'server_error_after_apply'; times?: number }
  | { match: (call: PostCall) => boolean; mode: 'reject'; status: number; message: string; times?: number };

export function createWriteBackend(data: TenantData, options: { policy?: Record<string, boolean>; userId?: string } = {}) {
  const base = createBackend(data);
  data.details = data.details ?? {};
  const posts: PostCall[] = [];
  const faults: Array<Fault & { used: number }> = [];
  let counter = 0;
  const openKeys = new Map<string, string>(); // idempotency_key → shift id
  const cashKeys = new Map<string, { shiftId: string; movementId: string }>();
  const policy = { shift_opening_meter_reading_required: true, shift_closing_meter_reading_required: true, shift_opening_tank_reading_required: true, shift_closing_tank_reading_required: true, shift_opening_cash_float_required: true, shift_mandatory_staff_assignment: false, shift_allow_close_with_pending_cash_variance: true, ...options.policy };
  if (!data.settings) data.settings = Object.fromEntries(data.stations.map((s) => [s.id, policy]));

  const reject = (message: string, status = 422): never => { throw new ApiError(status, message, { message }); };
  const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  const detailOf = (id: string): ShiftDetail => data.details?.[id] ?? reject('not found', 404);
  const syncRow = (d: ShiftDetail) => {
    const index = data.shifts.findIndex((s) => s.id === d.id);
    const row = shiftRow(d.id, d.station_id, { number: d.number, status: d.status, opening_float_minor: d.opening_float_minor, opened_at: d.opened_at, closed_at: d.closed_at, cash_variance_minor: d.cash_variance_minor, operational_liters: d.operational_liters });
    if (index >= 0) data.shifts[index] = row; else data.shifts.unshift(row);
  };
  const lockOpen = (id: string): ShiftDetail => {
    const d = detailOf(id);
    if (d.status !== 'open') reject('الشفت ليس مفتوحاً ولا يقبل حركة تشغيلية جديدة.');
    return d;
  };
  const activeNozzles = (stationId: string) => data.nozzles.filter((n) => n.fuel_station_id === stationId && n.status === 'active');
  const activeTanks = (stationId: string) => data.tanks.filter((t) => t.fuel_station_id === stationId && t.status === 'active');
  const totals = (d: ShiftDetail) => {
    const sum = (type: string) => (d.cash_movements ?? []).filter((m) => m.type === type).reduce((a, m) => a + m.amount_minor, 0);
    return { in: sum('cash_in'), out: sum('cash_out'), expense: sum('expense') };
  };

  function apply(call: PostCall): ShiftDetail {
    const { path, body } = call;
    if (path === '/fuel-stations/shifts/open') {
      const key = String(body.idempotency_key ?? '');
      if (!key) reject('idempotency_key مطلوب.');
      const station = data.stations.find((s) => s.id === body.fuel_station_id) ?? reject('not found', 404);
      if (policy.shift_opening_cash_float_required && body.opening_float_minor === undefined) reject('سياسة المحطة تتطلب تسجيل float نقدي افتتاحي صريح، ولو كانت قيمته صفراً.');
      const existingId = openKeys.get(key);
      if (existingId) return detailOf(existingId); // الأثر الأول لأي مفتاح موجود — حتى لو أُغلقت الوردية أو اختلف الـpayload
      if (Object.values(data.details ?? {}).some((d) => d.station_id === station.id && d.status === 'open')) reject('توجد وردية وقود مفتوحة للمحطة؛ يجب إغلاقها أو تصحيحها عبر المسار المدقق أولاً.');
      counter += 1;
      const created = shiftDetail(`new-${counter}`, station.id, {
        number: `SH-NEW-${counter}`, status: 'open', opening_float_minor: Number(body.opening_float_minor ?? 0), opened_at: '2026-11-05T05:00:00+00:00',
        meter_readings: [], tank_readings: [], staff_assignments: [], cash_movements: [],
      });
      data.details![created.id] = created;
      openKeys.set(key, created.id);
      syncRow(created);
      return created;
    }
    const match = /^\/fuel-stations\/shifts\/([\w-]+)\/(staff|meter-readings|tank-readings|cash-movements|close)$/.exec(path);
    if (!match) return reject('not found', 404);
    const [, id, action] = match;
    const d = action === 'close' ? lockOpen(id) : action === 'staff' ? lockOpen(id) : lockOpen(id);

    if (action === 'staff') {
      if ((d.staff_assignments ?? []).some((s) => s.user_id === body.user_id)) reject('العامل مسند بالفعل إلى هذا الشفت.');
      d.staff_assignments = [...(d.staff_assignments ?? []), { user_id: String(body.user_id) }];
    } else if (action === 'meter-readings') {
      const nozzleId = String(body.fuel_nozzle_id);
      const stage = body.reading_stage as 'opening' | 'closing';
      const ml = Number(body.meter_milliliters);
      const nozzle = data.nozzles.find((n) => n.id === nozzleId);
      if (!nozzle || nozzle.fuel_station_id !== d.station_id || nozzle.status !== 'active') reject('الفوهة لا تنتمي إلى المحطة أو الفرع النشطين، أو ليست متاحة تشغيلياً.');
      const evidence = String(body.evidence_key);
      const byKey = d.meter_readings.find((r) => (r as unknown as { evidence_key?: string }).evidence_key === evidence);
      if (byKey) {
        if (byKey.nozzle_id === nozzleId && byKey.reading_stage === stage && byKey.meter_milliliters === ml) return d;
        reject('مفتاح دليل قراءة العداد استُخدم سابقاً لسجل مختلف.');
      }
      if (d.meter_readings.some((r) => r.nozzle_id === nozzleId && r.reading_stage === stage)) reject('قراءة العداد لهذه الفوهة والمرحلة مسجلة بالفعل ولا يعاد استخدامها.');
      d.meter_readings = [...d.meter_readings, Object.assign(meter(`mr-${d.meter_readings.length + 1}`, nozzleId, stage, ml), { evidence_key: evidence })];
    } else if (action === 'tank-readings') {
      const tankId = String(body.fuel_tank_id);
      const stage = body.reading_stage as 'opening' | 'closing';
      const ml = Number(body.quantity_milliliters);
      const type = String(body.reading_type ?? 'physical');
      const tank = data.tanks.find((t) => t.id === tankId);
      if (!tank || tank.fuel_station_id !== d.station_id || tank.status !== 'active') reject('الخزان لا ينتمي إلى المحطة أو الفرع النشطين، أو ليس متاحاً تشغيلياً.');
      const evidence = String(body.evidence_key);
      const byKey = d.tank_readings.find((r) => (r as unknown as { evidence_key?: string }).evidence_key === evidence);
      if (byKey) {
        if (byKey.tank_id === tankId && byKey.reading_stage === stage && byKey.quantity_milliliters === ml && byKey.reading_type === type) return d;
        reject('مفتاح دليل قراءة الخزان استُخدم سابقاً لسجل مختلف.');
      }
      if (d.tank_readings.some((r) => r.tank_id === tankId && r.reading_stage === stage)) reject('قراءة الخزان لهذه المرحلة مسجلة بالفعل ولا يعاد استخدامها.');
      d.tank_readings = [...d.tank_readings, Object.assign(tankReading(`tr-${d.tank_readings.length + 1}`, tankId, stage, ml, { reading_type: type }), { evidence_key: evidence })];
    } else if (action === 'cash-movements') {
      const key = String(body.idempotency_key ?? '');
      const prior = cashKeys.get(key);
      if (prior) {
        if (prior.shiftId !== d.id) reject('مفتاح منع التكرار استُخدم لحركة شفت أخرى.');
        return d; // الأثر الأول — ولو اختلف المبلغ
      }
      const amount = Number(body.amount_minor);
      const t = totals(d);
      const expected = d.opening_float_minor + t.in - t.out - t.expense;
      if ((body.type === 'cash_out' || body.type === 'expense') && amount > expected) reject('لا يمكن إخراج أو تسجيل مصروف نقدي يتجاوز الرصيد التشغيلي المتوقع للشفت.');
      const movement: CashMovement = { id: `cm-${(d.cash_movements ?? []).length + 1}`, type: String(body.type), amount_minor: amount, reason: String(body.reason), recorded_at: '2026-11-05T06:00:00+00:00' };
      d.cash_movements = [...(d.cash_movements ?? []), movement];
      cashKeys.set(key, { shiftId: d.id, movementId: movement.id });
    } else if (action === 'close') {
      const stationId = d.station_id;
      const need = (flag: boolean, ids: string[], have: Set<string>, label: string) => {
        if (flag && ids.some((x) => !have.has(x))) reject(`سياسة المحطة تتطلب قراءات ${label} لكل أصول المحطة النشطة قبل إغلاق الشفت.`);
      };
      const stageSet = (rows: Array<{ reading_stage: string }>, field: 'nozzle_id' | 'tank_id', stage: string) => new Set((rows as Array<Record<string, string>>).filter((r) => r.reading_stage === stage).map((r) => r[field]));
      need(policy.shift_opening_meter_reading_required, activeNozzles(stationId).map((n) => n.id), stageSet(d.meter_readings, 'nozzle_id', 'opening'), 'افتتاحية للعدادات');
      need(policy.shift_closing_meter_reading_required, activeNozzles(stationId).map((n) => n.id), stageSet(d.meter_readings, 'nozzle_id', 'closing'), 'ختامية للعدادات');
      need(policy.shift_opening_tank_reading_required, activeTanks(stationId).map((t) => t.id), stageSet(d.tank_readings, 'tank_id', 'opening'), 'افتتاحية للخزانات');
      need(policy.shift_closing_tank_reading_required, activeTanks(stationId).map((t) => t.id), stageSet(d.tank_readings, 'tank_id', 'closing'), 'ختامية للخزانات');
      let meterTotal = 0;
      for (const n of activeNozzles(stationId)) {
        const o = d.meter_readings.find((r) => r.nozzle_id === n.id && r.reading_stage === 'opening');
        const c = d.meter_readings.find((r) => r.nozzle_id === n.id && r.reading_stage === 'closing');
        if (o && c) {
          if (c.meter_milliliters < o.meter_milliliters) reject('قراءة إغلاق العداد لا تكون أقل من قراءة الفتح لنفس الفوهة.');
          meterTotal += c.meter_milliliters - o.meter_milliliters;
        }
      }
      const counted = Number(body.counted_cash_minor);
      const t = totals(d);
      const expected = d.opening_float_minor + t.in - t.out - t.expense;
      const variance = counted - expected;
      if (variance !== 0 && !policy.shift_allow_close_with_pending_cash_variance) reject('سياسة المحطة تمنع إغلاق الشفت قبل حل فرق النقد التشغيلي.');
      Object.assign(d, {
        status: 'closed', closed_at: '2026-11-05T13:00:00+00:00', counted_cash_minor: counted, expected_operational_cash_minor: expected, cash_variance_minor: variance,
        operational_meter_milliliters: meterTotal, operational_liters: String(meterTotal / 1000),
        cash_variance: { status: variance === 0 ? 'not_required' : 'pending_review', variance_direction: variance === 0 ? 'none' : variance > 0 ? 'overage' : 'shortage' },
      });
    }
    syncRow(d);
    return d;
  }

  async function handler(path: string, options?: { method?: string; body?: unknown; headers?: HeadersInit }): Promise<unknown> {
    if (options?.method !== 'POST') return base.handler(path, options?.headers as Record<string, string> | undefined);
    const call: PostCall = { path, body: (options.body ?? {}) as Record<string, unknown>, headers: options.headers as Record<string, string> | undefined };
    posts.push(call);
    const fault = faults.find((f) => f.match(call) && f.used < (f.times ?? 1));
    if (fault) {
      fault.used += 1;
      if (fault.mode === 'network_before_apply') throw new TypeError('Failed to fetch');
      if (fault.mode === 'reject') throw new ApiError(fault.status, fault.message, { message: fault.message });
      apply(call); // التطبيق يتم في الخادم ثم يضيع الردّ
      if (fault.mode === 'network_after_apply') throw new TypeError('Failed to fetch');
      throw new ApiError(503, 'حدث خطأ', {});
    }
    return { data: clone(apply(call)) };
  }

  return {
    handler,
    posts,
    base,
    postsTo: (suffix: string) => posts.filter((p) => p.path.endsWith(suffix)),
    fail: (fault: Fault) => { faults.push({ ...fault, used: 0 }); },
    detail: (id: string) => data.details![id],
    openKeysUsed: () => [...openKeys.keys()],
  };
}

export type WriteBackend = ReturnType<typeof createWriteBackend>;
