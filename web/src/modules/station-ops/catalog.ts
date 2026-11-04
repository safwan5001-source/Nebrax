import type { FuelProduct, Nozzle, Pump, Station, Tank } from './schemas';

/**
 * UI-0 — اشتقاق كتالوج التعبئة الفعلي للمحطة من علاقات أَوْج المسجّلة.
 *
 * القاعدة (مصفوفة الربط، شرط 4 من UI-0): سجلّ المنتجات على مستوى المستأجر، وليس كل منتج وقود «قابلاً للتعبئة».
 * المنتج قابل للتعبئة في المحطة المختارة فقط إن وُجدت **فوهة نشطة** فيها، مضختها نشطة، وخزانها نشط
 * ويحمل المنتج نفسه، والمحطة نفسها نشطة. لا قوائم ثابتة (91/95/ديزل) ولا أعداد افتراضية.
 *
 * دوال نقية بلا I/O. كل سجل خارج المحطة المختارة يُهمل (دفاع بالعمق — الخادم هو السلطة في العزل).
 */

export type NozzleBlockReason =
  | 'station_inactive'
  | 'nozzle_inactive'
  | 'pump_missing'
  | 'pump_inactive'
  | 'tank_missing'
  | 'tank_inactive'
  | 'product_missing'
  | 'product_inactive'
  | 'product_tank_mismatch';

export interface NozzleView {
  nozzle: Nozzle;
  pump: Pump | null;
  tank: Tank | null;
  product: FuelProduct | null;
  /** `null` = قابلة للتعبئة. */
  blockedBy: NozzleBlockReason | null;
}

export interface DispensableProduct {
  product: FuelProduct;
  nozzles: NozzleView[];
  pumpIds: string[];
  tankIds: string[];
}

export interface PumpView {
  pump: Pump;
  nozzles: NozzleView[];
}

export interface TankView {
  tank: Tank;
  product: FuelProduct | null;
  nozzleCount: number;
}

export interface StationCatalog {
  stationId: string;
  /** منتجات لها فوهة قابلة للتعبئة فعلاً في هذه المحطة فقط. */
  products: DispensableProduct[];
  /** منتجات وقود نشطة في السجل لا فوهة قابلة للتعبئة لها هنا — حالة تكوين صادقة، لا «منتج متاح». */
  unmappedProducts: FuelProduct[];
  pumps: PumpView[];
  tanks: TankView[];
}

export interface CatalogInput {
  station: Pick<Station, 'id' | 'status'>;
  products: FuelProduct[];
  pumps: Pump[];
  nozzles: Nozzle[];
  tanks: Tank[];
}

const ACTIVE = 'active';

function byLabel(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true });
}

export function buildStationCatalog(input: CatalogInput): StationCatalog {
  const stationId = input.station.id;
  const stationActive = input.station.status === ACTIVE;

  const productsById = new Map(input.products.map((product) => [product.id, product]));
  const pumps = input.pumps.filter((pump) => pump.fuel_station_id === stationId);
  const tanks = input.tanks.filter((tank) => tank.fuel_station_id === stationId);
  const nozzles = input.nozzles.filter((nozzle) => nozzle.fuel_station_id === stationId);
  const pumpsById = new Map(pumps.map((pump) => [pump.id, pump]));
  const tanksById = new Map(tanks.map((tank) => [tank.id, tank]));

  const nozzleViews: NozzleView[] = nozzles.map((nozzle) => {
    const pump = pumpsById.get(nozzle.fuel_pump_id) ?? null;
    const tank = tanksById.get(nozzle.fuel_tank_id) ?? null;
    const product = productsById.get(nozzle.fuel_product_id) ?? null;

    let blockedBy: NozzleBlockReason | null = null;
    if (!stationActive) blockedBy = 'station_inactive';
    else if (nozzle.status !== ACTIVE) blockedBy = 'nozzle_inactive';
    else if (!pump) blockedBy = 'pump_missing';
    else if (pump.status !== ACTIVE) blockedBy = 'pump_inactive';
    else if (!tank) blockedBy = 'tank_missing';
    else if (tank.status !== ACTIVE) blockedBy = 'tank_inactive';
    else if (!product) blockedBy = 'product_missing';
    else if (!product.is_active) blockedBy = 'product_inactive';
    else if (tank.fuel_product_id !== nozzle.fuel_product_id) blockedBy = 'product_tank_mismatch';

    return { nozzle, pump, tank, product, blockedBy };
  });

  const dispensable = new Map<string, NozzleView[]>();
  for (const view of nozzleViews) {
    if (view.blockedBy !== null || !view.product) continue;
    const list = dispensable.get(view.product.id) ?? [];
    list.push(view);
    dispensable.set(view.product.id, list);
  }

  const products: DispensableProduct[] = [...dispensable.entries()]
    .map(([productId, views]) => ({
      product: productsById.get(productId) as FuelProduct,
      nozzles: [...views].sort((a, b) => byLabel(a.nozzle.nozzle_number, b.nozzle.nozzle_number)),
      pumpIds: [...new Set(views.map((view) => view.nozzle.fuel_pump_id))],
      tankIds: [...new Set(views.map((view) => view.nozzle.fuel_tank_id))],
    }))
    .sort((a, b) => byLabel(a.product.code, b.product.code));

  const unmappedProducts = input.products
    .filter((product) => product.is_active && !dispensable.has(product.id))
    .sort((a, b) => byLabel(a.code, b.code));

  const pumpViews: PumpView[] = pumps
    .map((pump) => ({
      pump,
      nozzles: nozzleViews
        .filter((view) => view.nozzle.fuel_pump_id === pump.id)
        .sort((a, b) => byLabel(a.nozzle.nozzle_number, b.nozzle.nozzle_number)),
    }))
    .sort((a, b) => byLabel(a.pump.pump_number, b.pump.pump_number));

  const tankViews: TankView[] = tanks
    .map((tank) => ({
      tank,
      product: productsById.get(tank.fuel_product_id) ?? null,
      nozzleCount: nozzles.filter((nozzle) => nozzle.fuel_tank_id === tank.id).length,
    }))
    .sort((a, b) => byLabel(a.tank.code, b.tank.code));

  return { stationId, products, unmappedProducts, pumps: pumpViews, tanks: tankViews };
}
