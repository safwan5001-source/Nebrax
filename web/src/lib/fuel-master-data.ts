import { litersToMilliliters, millilitersToLiters } from './fuel-quantity';

export type FuelMasterDataKind = 'stations' | 'products' | 'tanks' | 'pumps' | 'nozzles';
export type FuelMasterDataForm = Record<string, string>;
export type FuelMasterDataRow = Record<string, string | number | boolean | null | undefined> & { id: string };

export const VOLUME_FIELDS = new Set([
  'capacity_milliliters',
  'safe_capacity_milliliters',
  'minimum_level_milliliters',
  'dead_stock_milliliters',
  'opening_volume_milliliters',
  'meter_opening_milliliters',
]);

export const MASTER_DATA_DEFAULTS: Record<FuelMasterDataKind, FuelMasterDataForm> = {
  stations: { branch_id: '', warehouse_id: '', code: '', name: '', city: '', timezone: 'Asia/Riyadh', status: 'active' },
  products: { product_id: '', code: '', name: '', density_kg_per_m3: '', tax_category: '', is_active: 'true' },
  tanks: {
    fuel_station_id: '', fuel_product_id: '', code: '', name: '', capacity_milliliters: '', safe_capacity_milliliters: '',
    minimum_level_milliliters: '0', dead_stock_milliliters: '0', opening_volume_milliliters: '0', status: 'active',
  },
  pumps: { fuel_station_id: '', pump_number: '', name: '', status: 'active' },
  nozzles: { fuel_pump_id: '', fuel_tank_id: '', fuel_product_id: '', nozzle_number: '', meter_opening_milliliters: '0', status: 'active' },
};

export function formForRow(kind: FuelMasterDataKind, row?: FuelMasterDataRow | null): FuelMasterDataForm {
  const form = { ...MASTER_DATA_DEFAULTS[kind] };
  if (!row) return form;

  for (const key of Object.keys(form)) {
    const value = row[key];
    if (value === null || value === undefined) {
      form[key] = '';
    } else if (VOLUME_FIELDS.has(key)) {
      form[key] = millilitersToLiters(typeof value === 'string' || typeof value === 'number' ? value : null);
    } else {
      form[key] = String(value);
    }
  }
  return form;
}

export function masterDataPayload(kind: FuelMasterDataKind, form: FuelMasterDataForm) {
  const body: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(form)) {
    if (VOLUME_FIELDS.has(key)) body[key] = litersToMilliliters(value, true) ?? 0;
    else if (key === 'density_kg_per_m3') body[key] = value.trim() === '' ? null : Number(value);
    else if (key === 'is_active') body[key] = value === 'true';
    else body[key] = value.trim() === '' ? null : value.trim();
  }

  // Device mappings are intentionally not part of the human-facing master-data form.
  // Existing ATG/controller values remain untouched on update because the API treats them as `sometimes`.
  if (kind === 'tanks') delete body.atg_source_key;
  if (kind === 'pumps' || kind === 'nozzles') delete body.controller_key;
  return body;
}

export function stationIdForPump(pumpId: string, pumps: FuelMasterDataRow[]): string | null {
  const pump = pumps.find((row) => row.id === pumpId);
  return pump ? String(pump.fuel_station_id ?? '') || null : null;
}

export function filteredTanksForPump(pumpId: string, pumps: FuelMasterDataRow[], tanks: FuelMasterDataRow[]) {
  const stationId = stationIdForPump(pumpId, pumps);
  return stationId ? tanks.filter((tank) => tank.fuel_station_id === stationId) : tanks;
}

export function filteredProductsForTank(tankId: string, products: FuelMasterDataRow[], tanks: FuelMasterDataRow[]) {
  const tank = tanks.find((row) => row.id === tankId);
  if (!tank?.fuel_product_id) return products;
  return products.filter((product) => product.id === tank.fuel_product_id);
}
