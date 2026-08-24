export type MasterRelation = {
  id: string;
  fuel_station_id?: string | null;
  fuel_product_id?: string | null;
};

export type NozzleSelection = {
  pumpId: string;
  tankId: string;
  fuelProductId: string;
};

/** خيارات الخزانات التي تنتمي حصراً إلى المحطة المختارة. */
export function tanksForStation<T extends MasterRelation>(tanks: T[], stationId: string): T[] {
  return stationId === '' ? [] : tanks.filter((tank) => tank.fuel_station_id === stationId);
}

/** لا تسمح خريطة الفوهة إلا بخزانات محطة المضخة المختارة. */
export function tanksForPump<T extends MasterRelation>(pumps: MasterRelation[], tanks: T[], pumpId: string): T[] {
  const stationId = pumps.find((pump) => pump.id === pumpId)?.fuel_station_id ?? '';
  return tanksForStation(tanks, stationId);
}

/** منتج الفوهة مشتق من خزانها، لا يختاره المستخدم على نحو قد يخالف خريطة الساحة. */
export function nozzleSelectionForTank(pumpId: string, tank: MasterRelation | undefined): NozzleSelection | null {
  if (!tank?.id || !tank.fuel_product_id || pumpId === '') return null;

  return { pumpId, tankId: tank.id, fuelProductId: tank.fuel_product_id };
}
