import { api } from '@/lib/api';
import type { CustomerOption, OwnerCompanyLink, Paged, PageMeta, Tanker, TankerOwner, TankerStatus } from './types';

/**
 * TANKER-PR2 — **نقطة الشبكة الوحيدة** لواجهة أصحاب الصهاريج (يحرسه `boundary.test.ts`): مسارات PR-1 بيانات رئيسية فقط
 * (`fuel-stations/tanker-owners|tankers`) + قراءة عملاء المؤسسة لاختيار الشركة. لا تعبئة ولا سند ولا مخزون ولا فاتورة ولا قبض ولا عمولة ولا تسوية.
 * لا `tenant_id` في أي حمولة (المستأجر من الجلسة)، ولا `partner_id` للملف.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** معرّف المسار يجب أن يكون UUID — لا يُركَّب أي نص حر في عنوان الطلب. */
export function assertId(id: string): string {
  if (!UUID.test(id)) throw new Error('invalid_id');
  return id;
}

const OWNERS = '/fuel-stations/tanker-owners';
const TANKERS = '/fuel-stations/tankers';

interface Envelope<T> { data?: unknown; meta?: Partial<PageMeta> & Record<string, unknown> }

function rowsOf<T>(payload: unknown, guard: (row: unknown) => row is T): Paged<T> {
  const body = (payload ?? {}) as Envelope<T>;
  const data = Array.isArray(body.data) ? body.data.filter(guard) : [];
  const meta = body.meta ?? {};
  return {
    rows: data,
    meta: {
      current_page: Number(meta.current_page ?? 1) || 1,
      last_page: Number(meta.last_page ?? 1) || 1,
      per_page: Number(meta.per_page ?? (data.length || 50)) || 50,
      total: Number(meta.total ?? data.length) || 0,
    },
  };
}

const isObject = (row: unknown): row is Record<string, unknown> => typeof row === 'object' && row !== null;
const isOwner = (row: unknown): row is TankerOwner => isObject(row) && typeof row.id === 'string' && typeof row.name === 'string';
const isTanker = (row: unknown): row is Tanker => isObject(row) && typeof row.id === 'string' && typeof row.plate_number === 'string';
const isLink = (row: unknown): row is OwnerCompanyLink => isObject(row) && typeof row.id === 'string' && typeof row.valid_from === 'string';

/** استجابة سجل مفرد `{data: {...}}`؛ شكل مخالف ⇒ استثناء (الشاشة تعرض خطأ عاماً لا بيانات مشوّهة). */
function recordOf<T>(payload: unknown, guard: (row: unknown) => row is T): T {
  const data = (payload as { data?: unknown } | null)?.data;
  if (!guard(data)) throw new Error('malformed_response');
  return data;
}

export interface OwnerQuery { page?: number; q?: string; status?: TankerStatus | '' }

function qs(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter(([, value]) => value !== undefined && value !== '');
  return entries.length === 0 ? '' : `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()}`;
}

export async function listOwners(query: OwnerQuery = {}): Promise<Paged<TankerOwner>> {
  return rowsOf(await api<unknown>(`${OWNERS}${qs({ page: query.page && query.page > 1 ? query.page : undefined, q: query.q?.trim(), status: query.status })}`), isOwner);
}

export async function getOwner(id: string): Promise<TankerOwner> {
  return recordOf(await api<unknown>(`${OWNERS}/${assertId(id)}`), isOwner);
}

export interface OwnerPayload { name?: string; code?: string | null; phone?: string | null; notes?: string | null; status?: TankerStatus; reason?: string }

export async function createOwner(payload: OwnerPayload): Promise<TankerOwner> {
  return recordOf(await api<unknown>(OWNERS, { method: 'POST', body: payload }), isOwner);
}

export async function updateOwner(id: string, payload: OwnerPayload): Promise<TankerOwner> {
  return recordOf(await api<unknown>(`${OWNERS}/${assertId(id)}`, { method: 'PUT', body: payload }), isOwner);
}

export async function listTankers(ownerId: string, page = 1): Promise<Paged<Tanker>> {
  return rowsOf(await api<unknown>(`${TANKERS}${qs({ owner_id: assertId(ownerId), page: page > 1 ? page : undefined })}`), isTanker);
}

export interface TankerPayload {
  fuel_tanker_owner_id?: string;
  plate_number?: string;
  plate_country?: string | null;
  capacity_milliliters?: number | null;
  notes?: string | null;
  status?: TankerStatus;
  reason?: string;
}

export async function createTanker(payload: TankerPayload): Promise<Tanker> {
  return recordOf(await api<unknown>(TANKERS, { method: 'POST', body: payload }), isTanker);
}

export async function updateTanker(id: string, payload: TankerPayload): Promise<Tanker> {
  return recordOf(await api<unknown>(`${TANKERS}/${assertId(id)}`, { method: 'PUT', body: payload }), isTanker);
}

export async function listLinks(ownerId: string, page = 1): Promise<Paged<OwnerCompanyLink>> {
  return rowsOf(await api<unknown>(`${OWNERS}/${assertId(ownerId)}/company-links${qs({ page: page > 1 ? page : undefined })}`), isLink);
}

export interface LinkPayload { partner_id: string; valid_from?: string; valid_to?: string; note?: string; reason?: string }

export async function createLink(ownerId: string, payload: LinkPayload): Promise<OwnerCompanyLink> {
  return recordOf(await api<unknown>(`${OWNERS}/${assertId(ownerId)}/company-links`, { method: 'POST', body: payload }), isLink);
}

export interface EndLinkPayload { valid_to?: string; reason?: string }

export async function endLink(ownerId: string, linkId: string, payload: EndLinkPayload): Promise<OwnerCompanyLink> {
  return recordOf(await api<unknown>(`${OWNERS}/${assertId(ownerId)}/company-links/${assertId(linkId)}/end`, { method: 'POST', body: payload }), isLink);
}

/** عملاء المؤسسة (customer|both) لاختيار الشركة؛ الأطراف النظامية يخفيها الخادم، والتحقق النهائي في الخادم عند الربط. */
export const CUSTOMER_LOOKUP_LIMIT = 100;

export async function listCustomers(): Promise<{ options: CustomerOption[]; truncated: boolean }> {
  const payload = await api<unknown>(`/partners${qs({ type: 'customer', per_page: CUSTOMER_LOOKUP_LIMIT })}`);
  const data = Array.isArray((payload as { data?: unknown } | null)?.data) ? ((payload as { data: unknown[] }).data) : [];
  const options = data
    .filter(isObject)
    .filter((row) => typeof row.id === 'string' && typeof row.name === 'string' && row.is_active !== false)
    .map((row) => ({ id: row.id as string, name: row.name as string, code: typeof row.code === 'string' ? row.code : null }));
  return { options, truncated: data.length >= CUSTOMER_LOOKUP_LIMIT };
}
