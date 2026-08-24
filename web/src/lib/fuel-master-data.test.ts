import { describe, expect, it } from 'vitest';
import { nozzleSelectionForTank, tanksForPump, tanksForStation } from './fuel-master-data';

const pumps = [
  { id: 'pump-a', fuel_station_id: 'station-a' },
  { id: 'pump-b', fuel_station_id: 'station-b' },
];

const tanks = [
  { id: 'tank-a-95', fuel_station_id: 'station-a', fuel_product_id: 'fuel-95' },
  { id: 'tank-a-diesel', fuel_station_id: 'station-a', fuel_product_id: 'fuel-diesel' },
  { id: 'tank-b-91', fuel_station_id: 'station-b', fuel_product_id: 'fuel-91' },
];

describe('Fuel master data human selectors', () => {
  it('keeps tank choices scoped to the selected station', () => {
    expect(tanksForStation(tanks, 'station-a').map((tank) => tank.id)).toEqual(['tank-a-95', 'tank-a-diesel']);
    expect(tanksForStation(tanks, '')).toEqual([]);
  });

  it('keeps nozzle tank choices scoped to the selected pump station', () => {
    expect(tanksForPump(pumps, tanks, 'pump-b').map((tank) => tank.id)).toEqual(['tank-b-91']);
    expect(tanksForPump(pumps, tanks, 'unknown')).toEqual([]);
  });

  it('derives the fuel product from the selected tank for nozzle mapping', () => {
    expect(nozzleSelectionForTank('pump-a', tanks[0])).toEqual({ pumpId: 'pump-a', tankId: 'tank-a-95', fuelProductId: 'fuel-95' });
    expect(nozzleSelectionForTank('', tanks[0])).toBeNull();
  });
});
