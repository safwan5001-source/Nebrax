import type { z } from 'zod';
import { api, ApiError } from '@/lib/api';
import {
  createResponse,
  effectiveResponse,
  historyResponse,
  nozzlesResponse,
  productsResponse,
  stationsResponse,
  suggestionsResponse,
  type CreateResult,
  type PriceScope,
} from './contract';

export type PricesErrorKind = 'unauthorized' | 'forbidden' | 'not_found' | 'offline' | 'timeout' | 'server' | 'invalid_shape' | 'rejected';

/** فشل مصنَّف. `rejected` = رفض عمل من الخادم (409/422) برمز `reason` وجسمه للسياق. */
export class PricesError extends Error {
  constructor(
    public readonly kind: PricesErrorKind,
    public readonly status?: number,
    public readonly reason?: string,
    public readonly body?: Record<string, unknown>,
    message?: string,
  ) {
    super(message ?? kind);
    this.name = 'PricesError';
  }
}

/** يتعرف على ApiError بالبنية (status + body) لا بـ`instanceof` وحده: يصمد أمام تعدد نسخ الوحدة (حزم/اختبارات). */
function asApiError(error: unknown): { status: number; message: string; body: unknown } | null {
  if (error instanceof ApiError) return error;
  if (typeof error === 'object' && error !== null && typeof (error as { status?: unknown }).status === 'number' && error instanceof Error) {
    return error as unknown as { status: number; message: string; body: unknown };
  }
  return null;
}

function classify(error: unknown): PricesError {
  if (error instanceof PricesError) return error;
  const http = asApiError(error);
  if (http) {
    const body = (http.body && typeof http.body === 'object' ? http.body : {}) as Record<string, unknown>;
    const reason = typeof body.reason === 'string' ? body.reason : undefined;
    if (http.status === 401) return new PricesError('unauthorized', 401);
    if (http.status === 403) return new PricesError('forbidden', 403, reason, body, http.message);
    if (http.status === 404) return new PricesError('not_found', 404);
    if (http.status === 409 || http.status === 422) return new PricesError('rejected', http.status, reason, body, http.message);
    return new PricesError('server', http.status);
  }
  if (error instanceof Error && error.name === 'AbortError') return new PricesError('timeout');
  return new PricesError('offline');
}

function parse<S extends z.ZodTypeAny>(schema: S, body: unknown): z.infer<S> {
  const result = schema.safeParse(body);
  if (!result.success) throw new PricesError('invalid_shape');
  return result.data;
}

async function get<S extends z.ZodTypeAny>(path: string, schema: S, query: Record<string, string | number | undefined>, signal?: AbortSignal): Promise<z.infer<S>> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== '') search.set(key, String(value));
  const url = search.size > 0 ? `${path}?${search.toString()}` : path;
  let body: unknown;
  try {
    body = await api<unknown>(url, { method: 'GET', signal });
  } catch (error) {
    throw classify(error);
  }
  return parse(schema, body);
}

const scopeQuery = (scope: PriceScope) => (scope.kind === 'station' ? { station_id: scope.stationId } : { scope: 'tenant_default' });

export const listStations = (signal?: AbortSignal) => get('/fuel-stations/stations', stationsResponse, {}, signal);
export const listProducts = (signal?: AbortSignal) => get('/fuel-stations/products', productsResponse, {}, signal);
export const listNozzles = (signal?: AbortSignal) => get('/fuel-stations/nozzles', nozzlesResponse, {}, signal);
export const listEffective = (scope: PriceScope, signal?: AbortSignal) => get('/fuel-stations/prices/effective', effectiveResponse, scopeQuery(scope), signal);
export const listSuggestions = (scope: PriceScope, signal?: AbortSignal) =>
  get('/fuel-stations/prices/suggestions', suggestionsResponse, scope.kind === 'station' ? { station_id: scope.stationId } : {}, signal);
export const listHistory = (scope: PriceScope, fuelProductId: string, page: number, signal?: AbortSignal) =>
  get('/fuel-stations/prices', historyResponse, { ...scopeQuery(scope), fuel_product_id: fuelProductId, page }, signal);

export interface CreatePricePayload {
  fuel_station_id: string | null;
  fuel_product_id: string;
  price_per_liter_minor: number;
  start_now?: true;
  effective_from?: string;
  reason?: string;
  idempotency_key: string;
  supersede?: true;
  source?: { type: 'product_card'; confirm_tax_mode: string; confirm_unit: 'L' };
}

/** مهلة الحفظ. بعدها يُعاد `timeout` (لا نعرف إن حُفظ) ويبقى مفتاح التكرار نفسه عند إعادة المحاولة فلا يتكرر السعر. */
export const SAVE_TIMEOUT_MS = 20_000;

export async function createPrice(payload: CreatePricePayload, timeoutMs: number = SAVE_TIMEOUT_MS): Promise<CreateResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let body: unknown;
  try {
    body = await api<unknown>('/fuel-stations/prices', { method: 'POST', body: payload, signal: controller.signal });
  } catch (error) {
    throw classify(error);
  } finally {
    clearTimeout(timer);
  }
  return parse(createResponse, body);
}
