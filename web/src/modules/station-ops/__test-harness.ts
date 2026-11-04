import type { FuelPrice, FuelProduct, Nozzle, Pump, Shift, Station, Tank } from './schemas';
import { ApiError } from '@/lib/api';

/**
 * حزمة اختبار: خادم أَوْج وهمي لمسارات GET الفعلية. **للاختبارات فقط** (يحرس read-only-guard.test.ts ألا يُستورد من الإنتاج).
 * يحاكي: الترقيم (pageSize)، مرشّحات station_id/status/fuel_product_id، تأخير الردود (hold)، وفشل مسار بعينه.
 */
export interface TenantData {
  stations: Station[];
  products: FuelProduct[];
  pumps: Pump[];
  nozzles: Nozzle[];
  tanks: Tank[];
  prices: FuelPrice[];
  shifts: Shift[];
}

export interface Hold { release: () => void }

export function createBackend(data: TenantData, options: { pageSize?: number } = {}) {
  const calls: string[] = [];
  const holds: Array<{ match: (url: string) => boolean; promise: Promise<void>; release: () => void }> = [];
  const failures: Array<{ match: (url: string) => boolean; error: unknown }> = [];
  const pageSize = options.pageSize ?? 50;

  function hold(match: (url: string) => boolean): Hold {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => { release = resolve; });
    holds.push({ match, promise, release });
    return { release };
  }

  function fail(match: (url: string) => boolean, error: unknown) {
    failures.push({ match, error });
  }

  function paginate<T>(rows: T[], query: URLSearchParams) {
    const page = Number(query.get('page') ?? 1);
    const last = Math.max(1, Math.ceil(rows.length / pageSize));
    return { data: rows.slice((page - 1) * pageSize, page * pageSize), meta: { current_page: page, last_page: last } };
  }

  async function handler(url: string): Promise<unknown> {
    calls.push(url);
    const [path, search = ''] = url.split('?');
    const query = new URLSearchParams(search);
    for (const h of holds) if (h.match(url)) await h.promise;
    for (const f of failures) if (f.match(url)) throw f.error;

    switch (path) {
      case '/fuel-stations/stations': return { data: data.stations };
      case '/fuel-stations/products': return { data: data.products };
      case '/fuel-stations/pumps': return { data: data.pumps };
      case '/fuel-stations/nozzles': return { data: data.nozzles };
      case '/fuel-stations/tanks': return { data: data.tanks };
      case '/fuel-stations/prices': {
        const rows = data.prices
          .filter((row) => !query.get('fuel_product_id') || row.fuel_product_id === query.get('fuel_product_id'))
          .filter((row) => !query.get('station_id') || row.fuel_station_id === query.get('station_id'));
        return paginate(rows, query);
      }
      case '/fuel-stations/shifts': {
        const rows = data.shifts
          .filter((row) => !query.get('station_id') || row.station_id === query.get('station_id'))
          .filter((row) => !query.get('status') || row.status === query.get('status'));
        return paginate(rows, query);
      }
      default: throw new ApiError(404, 'not found', {});
    }
  }

  return { calls, handler, hold, fail, callsTo: (fragment: string) => calls.filter((call) => call.includes(fragment)) };
}

export type Backend = ReturnType<typeof createBackend>;
