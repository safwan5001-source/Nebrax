import type { FuelPrice, FuelProduct, Nozzle, Pump, Shift, Station, Tank } from './schemas';

/** بيانات اختبار فقط — موسومة صراحةً، ولا تُستورد من أي شيفرة إنتاج (يحرس ذلك read-only-guard.test.ts). */
export const station = (id: string, over: Partial<Station> = {}): Station => ({
  id, code: `ST-${id}`, name: `Station ${id}`, status: 'active', branch_id: null, city: null, region: null, timezone: null, license_number: null, license_expires_at: null, ...over,
});
export const product = (id: string, name: string, over: Partial<FuelProduct> = {}): FuelProduct => ({ id, code: id.toUpperCase(), name, is_active: true, ...over });
export const pump = (id: string, stationId: string, over: Partial<Pump> = {}): Pump => ({ id, fuel_station_id: stationId, pump_number: id.replace(/\D/g, '') || '1', name: null, status: 'active', ...over });
export const tank = (id: string, stationId: string, productId: string, over: Partial<Tank> = {}): Tank => ({ id, fuel_station_id: stationId, fuel_product_id: productId, code: id.toUpperCase(), name: `Tank ${id}`, capacity_milliliters: 20_000_000, minimum_level_milliliters: null, status: 'active', ...over });
export const nozzle = (id: string, stationId: string, pumpId: string, tankId: string, productId: string, over: Partial<Nozzle> = {}): Nozzle => ({ id, fuel_station_id: stationId, fuel_pump_id: pumpId, fuel_tank_id: tankId, fuel_product_id: productId, nozzle_number: id.replace(/\D/g, '') || '1', status: 'active', ...over });
export const price = (id: string, stationId: string | null, productId: string, minor: number, over: Partial<FuelPrice> = {}): FuelPrice => ({ id, fuel_station_id: stationId, fuel_product_id: productId, price_per_liter_minor: minor, effective_from: '2026-01-01T00:00:00+00:00', effective_until: null, status: 'active', ...over });
export const shift = (id: string, stationId: string, over: Partial<Shift> = {}): Shift => ({ id, number: `SH-${id}`, status: 'open', station_id: stationId, opening_float_minor: 0, operational_liters: '0', cash_variance_minor: null, opened_at: '2026-11-03T05:00:00+00:00', closed_at: null, approved_at: null, cash_variance: null, ...over });
