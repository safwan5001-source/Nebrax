import type { EffectivePrice, FuelProduct, MeterReading, Nozzle, Pump, Shift, ShiftDetail, Station, Tank, TankReading } from './schemas';

/** بيانات اختبار فقط — موسومة صراحةً، ولا تُستورد من أي شيفرة إنتاج (يحرس ذلك read-only-guard.test.ts). */
export const station = (id: string, over: Partial<Station> = {}): Station => ({
  id, code: `ST-${id}`, name: `Station ${id}`, status: 'active', branch_id: null, city: null, region: null, timezone: null, license_number: null, license_expires_at: null, ...over,
});
export const product = (id: string, name: string, over: Partial<FuelProduct> = {}): FuelProduct => ({ id, code: id.toUpperCase(), name, is_active: true, ...over });
export const pump = (id: string, stationId: string, over: Partial<Pump> = {}): Pump => ({ id, fuel_station_id: stationId, pump_number: id.replace(/\D/g, '') || '1', name: null, status: 'active', ...over });
export const tank = (id: string, stationId: string, productId: string, over: Partial<Tank> = {}): Tank => ({ id, fuel_station_id: stationId, fuel_product_id: productId, code: id.toUpperCase(), name: `Tank ${id}`, capacity_milliliters: 20_000_000, minimum_level_milliliters: null, status: 'active', ...over });
export const nozzle = (id: string, stationId: string, pumpId: string, tankId: string, productId: string, over: Partial<Nozzle> = {}): Nozzle => ({ id, fuel_station_id: stationId, fuel_pump_id: pumpId, fuel_tank_id: tankId, fuel_product_id: productId, nozzle_number: id.replace(/\D/g, '') || '1', status: 'active', ...over });
/** صف «سعر فعّال» كما يعيده الخادم (القيم الافتراضية: سعر محطة، شامل الضريبة، قابل للبيع). */
export const effectivePrice = (stationId: string, productId: string, minor: number, over: Partial<EffectivePrice> = {}): EffectivePrice => ({
  fuel_product_id: productId, fuel_station_id: stationId, status: 'effective', source: 'station_override', price_per_liter_minor: minor, unit: 'L',
  tax_mode: 'tax_inclusive', effective_from: '2026-01-01T00:00:00+00:00', effective_until: null, sellable: true, blockers: [], ...over,
});
/** صف «غير مضبوط» كما يعيده الخادم حين لا سعر محطة ولا افتراضي فعّالاً. */
export const unpriced = (stationId: string, productId: string, over: Partial<EffectivePrice> = {}): EffectivePrice => ({
  fuel_product_id: productId, fuel_station_id: stationId, status: 'not_configured', source: null, price_per_liter_minor: null, unit: 'L',
  tax_mode: 'tax_inclusive', effective_from: null, effective_until: null, sellable: false, blockers: ['price_not_configured'], ...over,
});
export const shift = (id: string, stationId: string, over: Partial<Shift> = {}): Shift => ({ id, number: `SH-${id}`, status: 'open', station_id: stationId, opening_float_minor: 0, operational_liters: '0', cash_variance_minor: null, opened_at: '2026-11-03T05:00:00+00:00', closed_at: null, approved_at: null, cash_variance: null, ...over });
export const meter = (id: string, nozzleId: string, stage: 'opening' | 'closing', ml: number, over: Partial<MeterReading> = {}): MeterReading => ({ id, nozzle_id: nozzleId, reading_stage: stage, meter_milliliters: ml, measured_at: stage === 'opening' ? '2026-11-03T05:05:00+00:00' : '2026-11-03T13:02:00+00:00', ...over });
export const tankReading = (id: string, tankId: string, stage: 'opening' | 'closing', ml: number, over: Partial<TankReading> = {}): TankReading => ({ id, tank_id: tankId, reading_stage: stage, reading_type: 'physical', quantity_milliliters: ml, measured_at: '2026-11-03T05:10:00+00:00', ...over });
export const shiftDetail = (id: string, stationId: string, over: Partial<ShiftDetail> = {}): ShiftDetail => ({
  ...shift(id, stationId), branch_id: null, counted_cash_minor: null, expected_operational_cash_minor: null, operational_meter_milliliters: 0, locked_at: null,
  meter_readings: [], tank_readings: [], staff_assignments: [], cash_variance: null, ...over,
});
