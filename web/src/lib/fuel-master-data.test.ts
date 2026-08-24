import { describe, expect, it } from 'vitest';
import {
  filteredProductsForTank,
  filteredTanksForPump,
  formForRow,
  masterDataPayload,
  type FuelMasterDataRow,
} from './fuel-master-data';

describe('fuel master-data UX boundaries', () => {
  it('shows tank quantities in liters and submits integer milliliters', () => {
    const form = formForRow('tanks', {
      id: 'tank-1', fuel_station_id: 'station-1', fuel_product_id: 'fuel-1', code: 'T1', name: 'Tank 1',
      capacity_milliliters: 12_500_000, safe_capacity_milliliters: 12_000_000,
      minimum_level_milliliters: 500_000, dead_stock_milliliters: 250_000, opening_volume_milliliters: 3_125_000,
      atg_source_key: 'private-device-mapping', status: 'active',
    });

    expect(form.capacity_milliliters).toBe('12500');
    expect(form.opening_volume_milliliters).toBe('3125');
    expect(form).not.toHaveProperty('atg_source_key');

    const payload = masterDataPayload('tanks', form);
    expect(payload.capacity_milliliters).toBe(12_500_000);
    expect(payload.opening_volume_milliliters).toBe(3_125_000);
    expect(payload).not.toHaveProperty('atg_source_key');
  });

  it('never exposes or submits controller mappings in pump/nozzle forms', () => {
    const pump = formForRow('pumps', { id: 'p1', fuel_station_id: 's1', pump_number: '01', name: 'Pump', controller_key: 'secret-map', status: 'active' });
    const nozzle = formForRow('nozzles', { id: 'n1', fuel_pump_id: 'p1', fuel_tank_id: 't1', fuel_product_id: 'f1', nozzle_number: '1', meter_opening_milliliters: 10_000, controller_key: 'secret-map', status: 'active' });

    expect(pump).not.toHaveProperty('controller_key');
    expect(nozzle).not.toHaveProperty('controller_key');
    expect(masterDataPayload('pumps', pump)).not.toHaveProperty('controller_key');
    expect(masterDataPayload('nozzles', nozzle)).not.toHaveProperty('controller_key');
  });

  it('filters nozzle tanks to the selected pump station and fuel product to the selected tank', () => {
    const pumps = [
      { id: 'p1', fuel_station_id: 's1' }, { id: 'p2', fuel_station_id: 's2' },
    ] as FuelMasterDataRow[];
    const tanks = [
      { id: 't1', fuel_station_id: 's1', fuel_product_id: 'f1' },
      { id: 't2', fuel_station_id: 's2', fuel_product_id: 'f2' },
    ] as FuelMasterDataRow[];
    const products = [{ id: 'f1' }, { id: 'f2' }] as FuelMasterDataRow[];

    expect(filteredTanksForPump('p1', pumps, tanks).map((row) => row.id)).toEqual(['t1']);
    expect(filteredProductsForTank('t1', products, tanks).map((row) => row.id)).toEqual(['f1']);
  });
});
