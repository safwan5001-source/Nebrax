import type { EffectiveRow, HistoryRow, Nozzle, FuelProduct, Station, SuggestionRow } from './contract';

/** بيانات اختبار فقط (اصطناعية، لا محطة ولا سعر حقيقي). */
export const station = (id: string, name: string, over: Partial<Station> = {}): Station => ({ id, code: `ST-${id}`, name, status: 'active', timezone: 'Asia/Riyadh', ...over });
export const product = (id: string, name: string, over: Partial<FuelProduct> = {}): FuelProduct => ({ id, code: id.toUpperCase(), name, is_active: true, ...over });
export const nozzle = (id: string, stationId: string, productId: string, over: Partial<Nozzle> = {}): Nozzle => ({ id, fuel_station_id: stationId, fuel_product_id: productId, status: 'active', ...over });

export const effective = (stationId: string | null, productId: string, minor: number, over: Partial<EffectiveRow> = {}): EffectiveRow => ({
  fuel_product_id: productId, fuel_station_id: stationId, status: 'effective', source: stationId ? 'station_override' : 'tenant_default', price_per_liter_minor: minor,
  unit: 'L', tax_mode: 'tax_inclusive', effective_from: '2026-10-01T09:00:00+00:00', effective_until: null, sellable: true, blockers: [], ...over,
});
export const unset = (stationId: string | null, productId: string, over: Partial<EffectiveRow> = {}): EffectiveRow => ({
  fuel_product_id: productId, fuel_station_id: stationId, status: 'not_configured', source: null, price_per_liter_minor: null, unit: 'L', tax_mode: 'tax_inclusive',
  effective_from: null, effective_until: null, sellable: false, blockers: ['price_not_configured'], ...over,
});
export const suggestionOk = (stationId: string | null, productId: string, minor: number, over: Partial<SuggestionRow> = {}): SuggestionRow => ({
  fuel_product_id: productId, fuel_station_id: stationId, status: 'available', price_per_liter_minor: minor, unit: 'L', card_unit_name: 'L', tax_mode: 'tax_inclusive',
  blockers: [], current_scope_price_minor: null, matches_current: false, ...over,
});
export const suggestionBlocked = (stationId: string | null, productId: string, blockers: string[] = ['requires_liter_price']): SuggestionRow => ({
  fuel_product_id: productId, fuel_station_id: stationId, status: 'blocked', price_per_liter_minor: null, unit: 'L', card_unit_name: null, tax_mode: 'tax_inclusive',
  blockers, current_scope_price_minor: null, matches_current: false,
});
export const history = (id: string, stationId: string | null, productId: string, minor: number, over: Partial<HistoryRow> = {}): HistoryRow => ({
  id, fuel_station_id: stationId, fuel_product_id: productId, price_per_liter_minor: minor, effective_from: '2026-09-01T00:00:00+00:00', effective_until: null, status: 'active', reason: null, entry_source: 'manual', ...over,
});
