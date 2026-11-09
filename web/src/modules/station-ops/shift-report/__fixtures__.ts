import { buildStationCatalog } from '../catalog';
import type { CollectionView } from '../collection';
import { meter, nozzle, product, pump, shiftDetail, station, tank } from '../__fixtures__';
import type { ShiftDetail } from '../schemas';
import ar from '@/messages/ar.json';
import en from '@/messages/en.json';

/** أدوات اختبار تقرير الوردية (للاختبارات فقط): رسائل حقيقية + كتالوج متعدد المضخات/المنتجات + لقطات تحصيل. */
type Tree = { [key: string]: string | Tree };

export const translator = (locale: 'ar' | 'en') => (key: string): string => {
  let cursor: string | Tree = ((locale === 'ar' ? ar : en) as unknown as { stationOps: { shiftReport: Tree } }).stationOps.shiftReport;
  for (const part of key.split('.')) {
    if (typeof cursor === 'string' || cursor === undefined) throw new Error(`missing message ${key}`);
    cursor = cursor[part];
  }
  if (typeof cursor !== 'string') throw new Error(`missing message ${key}`);
  return cursor;
};

export const STATION = station('a', { name: 'Station A', code: 'ST-A', city: 'Dammam', timezone: 'Asia/Riyadh' });

/** مضختان وثلاث فوهات على منتجين (n1,n2 على pump1؛ n3 على pump2). */
export const CATALOG = buildStationCatalog({
  station: STATION,
  products: [product('p1', 'Alpha'), product('p2', 'Beta')],
  pumps: [pump('pump1', 'a'), pump('pump2', 'a')],
  tanks: [tank('t1', 'a', 'p1'), tank('t2', 'a', 'p2')],
  nozzles: [nozzle('n1', 'a', 'pump1', 't1', 'p1'), nozzle('n2', 'a', 'pump1', 't2', 'p2'), nozzle('n3', 'a', 'pump2', 't1', 'p1')],
});

export const closedDetail = (over: Partial<ShiftDetail> = {}): ShiftDetail => shiftDetail('s1', 'a', {
  number: 'SH-100', status: 'closed', opened_at: '2026-11-03T05:00:00+00:00', closed_at: '2026-11-03T13:00:00+00:00',
  opening_float_minor: 20_000, counted_cash_minor: 25_000, expected_operational_cash_minor: 25_000, cash_variance_minor: 0, closed_by: 'u1',
  operational_meter_milliliters: 690_500 + 500_000 + 100_000,
  meter_readings: [
    meter('m1', 'n1', 'opening', 125_430_000), meter('m2', 'n1', 'closing', 126_120_500),
    meter('m3', 'n2', 'opening', 0), meter('m4', 'n2', 'closing', 500_000),
    meter('m5', 'n3', 'opening', 10_000), meter('m6', 'n3', 'closing', 110_000),
  ],
  ...over,
});

export const frozenCollection = (over: Partial<CollectionView> = {}): CollectionView => ({
  enabled: true, state: 'frozen', revision: 2,
  methods: [], methods_changed: false,
  close_readiness: { ready: true, blockers: [], reason_required: false },
  review: { visible: true, state: 'not_required', reason: null, note: null, reviewed_by: null, reviewed_at: null },
  declaration: {
    id: 'd1', revision: 2, status: 'frozen',
    lines: [
      { payment_method_id: 'm-cash', name: 'Cash', settlement_type: 'cash', amount_minor: 200_000, still_allowed: true },
      { payment_method_id: 'm-card', name: 'Card', settlement_type: 'bank', amount_minor: 83_100, still_allowed: true },
    ],
    collected_total_minor: 283_100, cash_declared_minor: 200_000, network_declared_minor: 83_100,
  },
  sales: {
    visible: true, complete: true, milliliters: 1_290_500, milliliters_complete: true, amount_minor: 283_100, tax_mode: 'tax_inclusive', evaluated_at: '2026-11-03T13:00:00+00:00',
    products: [
      { fuel_product_id: 'p1', name: 'Alpha', nozzle_count: 2, milliliters: 790_500, price_per_liter_minor: 200, price_source: 'station_override', amount_minor: 158_100, gaps: [] },
      { fuel_product_id: 'p2', name: 'Beta', nozzle_count: 1, milliliters: 500_000, price_per_liter_minor: 250, price_source: 'station_override', amount_minor: 125_000, gaps: [] },
    ] as CollectionView['sales']['products'],
    nozzles: [], gaps: [],
  },
  reconciliation: { visible: true, final: true, reason: null, collected_total_minor: 283_100, sales_minor: 283_100, difference_minor: 0, direction: 'none' },
  drawer: { frozen: true, opening_float_minor: 20_000, counted_cash_minor: 25_000, treasury_handover_minor: 0, cash_in_minor: 0, cash_out_minor: 0, expenses_minor: 0, implied_sales_cash: { visible: true, amount_minor: null, declared_difference_minor: null } },
  disclaimers: [],
  ...over,
});
