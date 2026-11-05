import { vi } from 'vitest';
import type { EffectiveRow, FuelProduct, HistoryRow, Nozzle, Station, SuggestionRow } from './contract';
import { history } from './__fixtures__';

/**
 * خلفية وهمية تُعترض عند `fetch` (فتبقى `api()` الحقيقية بترويساتها ومساراتها). **للاختبارات فقط.**
 * تسجّل كل طلب، وتدعم تأخير مسار (hold) وفشله (fail) وتخصيص ردّ الحفظ.
 */
export interface World {
  stations: Station[];
  products: FuelProduct[];
  nozzles: Nozzle[];
  /** مفتاح النطاق: `station:<id>` أو `tenant`. */
  effective: Record<string, EffectiveRow[]>;
  suggestions: Record<string, SuggestionRow[]>;
  /** صفحات السجل لكل `<scopeKey>|<productId>`. */
  history: Record<string, HistoryRow[][]>;
}

export interface Call { method: string; path: string; search: URLSearchParams; body: Record<string, unknown> | null; headers: Record<string, string> }

type Reply = { status: number; body: unknown };

export function createBackend(world: World) {
  const calls: Call[] = [];
  const holds: Array<{ match: (call: Call) => boolean; promise: Promise<void> }> = [];
  const failures: Array<{ match: (call: Call) => boolean; reply?: Reply; error?: unknown; once: boolean }> = [];
  let onPost: (body: Record<string, unknown>, attempt: number) => Reply | Promise<Reply> = (body) => ({
    status: 201,
    body: { data: history('new-1', (body.fuel_station_id as string | null) ?? null, String(body.fuel_product_id), Number(body.price_per_liter_minor)), meta: { replayed: false, superseded_price_ids: [] } },
  });
  let postAttempts = 0;

  const scopeOf = (search: URLSearchParams) => (search.get('station_id') ? `station:${search.get('station_id')}` : 'tenant');

  async function handle(url: string, init: RequestInit): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> {
    const parsed = new URL(url, 'http://x');
    const path = parsed.pathname.replace(/^.*\/api/, '');
    const call: Call = {
      method: init.method ?? 'GET', path, search: parsed.searchParams,
      body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
      headers: (init.headers ?? {}) as Record<string, string>,
    };
    calls.push(call);
    for (const hold of holds) if (hold.match(call)) await hold.promise;
    for (let i = 0; i < failures.length; i += 1) {
      const f = failures[i];
      if (!f.match(call)) continue;
      if (f.once) failures.splice(i, 1);
      if (f.error) throw f.error;
      return reply(f.reply as Reply);
    }

    if (call.method === 'POST' && path === '/fuel-stations/prices') {
      postAttempts += 1;
      const result = await onPost(call.body ?? {}, postAttempts);
      return reply(result);
    }
    if (call.method !== 'GET') return reply({ status: 404, body: { message: 'no route' } });

    switch (path) {
      case '/fuel-stations/stations': return reply({ status: 200, body: { data: world.stations } });
      case '/fuel-stations/products': return reply({ status: 200, body: { data: world.products } });
      case '/fuel-stations/nozzles': return reply({ status: 200, body: { data: world.nozzles } });
      case '/fuel-stations/prices/effective': return reply({ status: 200, body: { data: world.effective[scopeOf(call.search)] ?? [] } });
      case '/fuel-stations/prices/suggestions': return reply({ status: 200, body: { data: world.suggestions[scopeOf(call.search)] ?? [] } });
      case '/fuel-stations/prices': {
        const pages = world.history[`${scopeOf(call.search)}|${call.search.get('fuel_product_id')}`] ?? [[]];
        const page = Number(call.search.get('page') ?? 1);
        return reply({ status: 200, body: { data: pages[page - 1] ?? [], meta: { current_page: page, last_page: pages.length } } });
      }
      default: return reply({ status: 404, body: { message: 'not found' } });
    }
  }

  const reply = (r: Reply) => ({ ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body });

  const fetchMock = vi.fn(handle);
  return {
    fetchMock,
    calls,
    callsTo: (fragment: string, method?: string) => calls.filter((c) => c.path.includes(fragment) && (!method || c.method === method)),
    posts: () => calls.filter((c) => c.method === 'POST'),
    hold(match: (call: Call) => boolean) {
      let release!: () => void;
      holds.push({ match, promise: new Promise<void>((resolve) => { release = resolve; }) });
      return () => release();
    },
    fail(match: (call: Call) => boolean, outcome: { reply?: Reply; error?: unknown }, once = false) { failures.push({ match, ...outcome, once }); },
    setPost(handler: typeof onPost) { onPost = handler; },
    world,
  };
}

export type Backend = ReturnType<typeof createBackend>;
