/**
 * CUST-H4-7 — عميل قراءة عروض مساحة عمل Commerce
 * (`commerce/workspace/storefronts/{id}/offers`). نفس اتفاقية
 * `workspace-products.ts`: `{id}` محدِّد صفّ فقط، لا `tenant_id` في أي طلب،
 * والمستأجر من الجلسة عبر `SetTenant`.
 *
 * القراءة الواحدة تخدم المنتقي وترطيب الاختيارات والـCanvas معاً، فلا طلب
 * لكل عرض ولا طلب منتجٍ لكل عرض.
 *
 * CUST-H4-7b — الكتابة (إنشاء/تعديل/حذف) فوق **نفس** نقاط H4-6 حرفياً، بلا أي
 * نقطة جديدة. الجسم قائمة سماح ضيّقة: `product_id`, `starts_at`, `ends_at`,
 * `is_active`, `position` — لا سعر ولا خصم ولا نسبة ولا tenant_id أبداً (الخادم
 * يرفض أي مفتاح آخر بـ422، وهذا العميل لا يملك حتى وسيلة لإرساله).
 *
 * هذا العميل **لا يحسب** شيئاً: `is_live` و`reason` والسعرين و`discount_percent`
 * تُنقل كما أعادها الخادم (سلطة `StorefrontOfferResolver`)، ولا يُشتقّ هنا
 * أي سعر أو نسبة أو حالة حياة.
 */

import { api, ApiError, hasApiStatus } from '@/lib/api';
import { COMMERCE_STORE_ADMIN_LIST_PATH } from './stores';

export function commerceWorkspaceOffersPath(storefrontId: string): string {
  return `${COMMERCE_STORE_ADMIN_LIST_PATH}/${storefrontId}/offers`;
}

/** أسباب الحجب التي يعيدها `StorefrontOfferResolver` (للترجمة فقط، لا للمنطق). */
export const KNOWN_OFFER_REASONS = [
  'inactive',
  'scheduled',
  'expired',
  'product_unavailable',
  'variant_managed',
  'not_discounted',
  'price_unresolved',
  'out_of_stock',
  'fulfillment_not_configured',
  'availability_unresolved',
] as const;

export type KnownOfferReason = (typeof KNOWN_OFFER_REASONS)[number];

export function isKnownOfferReason(reason: string | null): reason is KnownOfferReason {
  return reason !== null && (KNOWN_OFFER_REASONS as readonly string[]).includes(reason);
}

export interface WorkspaceOfferMoney {
  amountMinor: number;
  currency: string;
}

export interface WorkspaceOfferProduct {
  name: string;
  nameEn: string | null;
  thumbnailUrl: string | null;
}

export interface WorkspaceOffer {
  /** `storefront_offers.id` — المرجع الوحيد الذي يُخزَّن في `OffersContent.offerIds`. */
  id: string;
  /** المنتج المُشار إليه (للتحرير ومنع التكرار؛ لا يُعرض للتاجر كمعرّف). */
  productId: string;
  /** ترتيب التهيئة (`position`) كما يعيده الخادم. */
  position: number;
  /** `null` حين حُذف المنتج (يبقى الصف مرئياً للمحرّر بسبب `product_unavailable`). */
  product: WorkspaceOfferProduct | null;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  /** كما أعادها الخادم؛ لا اشتقاق محلي. */
  isLive: boolean;
  /** سبب الحجب كنصٍّ خام (قد يكون خارج `KNOWN_OFFER_REASONS` مستقبلاً). */
  reason: string | null;
  referencePrice: WorkspaceOfferMoney | null;
  offerPrice: WorkspaceOfferMoney | null;
  /** مشتقّ في الخادم؛ قد يكون `0` لخصمٍ حقيقيٍّ أدنى من نصف بالمئة. */
  discountPercent: number | null;
}

interface Failure<Reason extends string> {
  ok: false;
  reason: Reason;
  message: string;
}

export type WorkspaceOffersOutcome =
  | { ok: true; data: WorkspaceOffer[]; maxOffers: number | null }
  | Failure<'forbidden' | 'not_found' | 'failed'>;

function classifyReadFailure(error: unknown): 'forbidden' | 'not_found' | 'failed' {
  if (hasApiStatus(error, 403)) return 'forbidden';
  if (hasApiStatus(error, 404)) return 'not_found';
  return 'failed';
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function mapMoney(raw: unknown): WorkspaceOfferMoney | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.amount_minor !== 'number' || !Number.isFinite(raw.amount_minor)) return null;
  if (typeof raw.currency !== 'string' || raw.currency === '') return null;
  return { amountMinor: raw.amount_minor, currency: raw.currency };
}

function mapProduct(raw: unknown): WorkspaceOfferProduct | null {
  if (!isRecord(raw) || typeof raw.name !== 'string') return null;
  return {
    name: raw.name,
    nameEn: typeof raw.name_en === 'string' ? raw.name_en : null,
    thumbnailUrl: typeof raw.thumbnail_url === 'string' ? raw.thumbnail_url : null,
  };
}

function mapOffer(row: unknown): WorkspaceOffer | null {
  if (!isRecord(row)) return null;
  if (typeof row.id !== 'string' || row.id === '') return null;
  const evaluation = row.evaluation;
  if (!isRecord(evaluation) || typeof evaluation.is_live !== 'boolean') return null;

  const isLive = evaluation.is_live;
  const referencePrice = mapMoney(evaluation.reference_price);
  const offerPrice = mapMoney(evaluation.offer_price);
  const percent =
    typeof evaluation.discount_percent === 'number' && Number.isFinite(evaluation.discount_percent)
      ? evaluation.discount_percent
      : null;
  // A row the server calls live must carry the full price proof; anything
  // less is a malformed payload, never something to patch up client-side.
  if (isLive && (referencePrice === null || offerPrice === null || percent === null)) return null;

  if (typeof row.product_id !== 'string' || row.product_id === '') return null;

  return {
    id: row.id,
    productId: row.product_id,
    position: typeof row.position === 'number' && Number.isFinite(row.position) ? row.position : 0,
    product: mapProduct(row.product),
    isActive: row.is_active !== false,
    startsAt: typeof row.starts_at === 'string' ? row.starts_at : null,
    endsAt: typeof row.ends_at === 'string' ? row.ends_at : null,
    isLive,
    reason: typeof evaluation.reason === 'string' ? evaluation.reason : null,
    referencePrice: isLive ? referencePrice : null,
    offerPrice: isLive ? offerPrice : null,
    discountPercent: isLive ? percent : null,
  };
}

/**
 * قراءة واحدة لكل المرشّحين (≤ 12) بالترتيب الذي يعيده الخادم. لا ترقيم ولا
 * `ids[]`: القائمة كاملة تخدم المنتقي وكل instances القسم معاً، والتحجيم إلى
 * `offerIds` كل قسم يتم في الواجهة دون أي طلب إضافي.
 */
export async function listWorkspaceOffers(
  storefrontId: string,
  signal?: AbortSignal,
): Promise<WorkspaceOffersOutcome> {
  try {
    const payload = await api<unknown>(commerceWorkspaceOffersPath(storefrontId), { signal });
    if (!isRecord(payload) || !Array.isArray(payload.data)) {
      return { ok: false, reason: 'failed', message: 'invalid_payload' };
    }
    const rows: WorkspaceOffer[] = [];
    for (const row of payload.data) {
      const offer = mapOffer(row);
      if (offer === null) return { ok: false, reason: 'failed', message: 'invalid_payload' };
      rows.push(offer);
    }
    const meta = isRecord(payload.meta) ? payload.meta : {};
    const maxOffers = typeof meta.max_offers === 'number' ? meta.max_offers : null;
    return { ok: true, data: rows, maxOffers };
  } catch (error) {
    return { ok: false, reason: classifyReadFailure(error), message: errorMessage(error, 'list_failed') };
  }
}

// ─── CUST-H4-7b — mutations (create / update / delete) ──────────────────────

export type WorkspaceOfferField = 'product_id' | 'starts_at' | 'ends_at' | 'is_active' | 'position';

/** رسالة الخادم لكل حقلٍ رفضه (422) — تُعرض كما أعادها الخادم، بلا إعادة تفسير. */
export type WorkspaceOfferFieldErrors = Partial<Record<WorkspaceOfferField, string>>;

export interface WorkspaceOfferMutationFailure {
  ok: false;
  /**
   * `conflict` = 409 (المنتج مُهيَّأ مسبقاً) · `validation` = 422 (منتج غير مؤهَّل،
   * نافذة غير صالحة، سقف التهيئة، حقل غير مسموح) · `not_found` = 404 (متجر أو عرض
   * أجنبي/محذوف) · `forbidden` = 403 · `failed` = أي شيء آخر (شبكة/5xx).
   */
  reason: 'forbidden' | 'not_found' | 'conflict' | 'validation' | 'failed';
  message: string;
  fieldErrors: WorkspaceOfferFieldErrors;
}

export type WorkspaceOfferMutationOutcome =
  | { ok: true; data: WorkspaceOffer }
  | WorkspaceOfferMutationFailure;

export type WorkspaceOfferDeleteOutcome = { ok: true } | WorkspaceOfferMutationFailure;

/** ما يملك التاجر كتابته — مرآة قائمة السماح في H4-6، لا غير. */
export interface WorkspaceOfferWrite {
  productId?: string;
  /** ISO-8601 بإزاحة (مثل `2026-12-01T09:00:00.000Z`) أو `null` للمسح. */
  startsAt?: string | null;
  endsAt?: string | null;
  isActive?: boolean;
  /** `null`/غياب عند الإنشاء = إلحاق في النهاية (الافتراضي في الخادم). */
  position?: number | null;
}

const WRITABLE_FIELDS: readonly WorkspaceOfferField[] = ['product_id', 'starts_at', 'ends_at', 'is_active', 'position'];

function toBody(input: WorkspaceOfferWrite): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (input.productId !== undefined) body.product_id = input.productId;
  if (input.startsAt !== undefined) body.starts_at = input.startsAt;
  if (input.endsAt !== undefined) body.ends_at = input.endsAt;
  if (input.isActive !== undefined) body.is_active = input.isActive;
  if (input.position !== undefined && input.position !== null) body.position = input.position;
  return body;
}

function extractFieldErrors(body: unknown): WorkspaceOfferFieldErrors {
  const out: WorkspaceOfferFieldErrors = {};
  if (!isRecord(body) || !isRecord(body.errors)) return out;
  for (const field of WRITABLE_FIELDS) {
    const messages = body.errors[field];
    const first = Array.isArray(messages) ? messages.find((m): m is string => typeof m === 'string' && m !== '') : undefined;
    if (first) out[field] = first;
  }
  return out;
}

function classifyMutationFailure(error: unknown, fallback: string): WorkspaceOfferMutationFailure {
  const message = errorMessage(error, fallback);
  if (hasApiStatus(error, 403)) return { ok: false, reason: 'forbidden', message, fieldErrors: {} };
  if (hasApiStatus(error, 404)) return { ok: false, reason: 'not_found', message, fieldErrors: {} };
  if (hasApiStatus(error, 409)) return { ok: false, reason: 'conflict', message, fieldErrors: {} };
  if (hasApiStatus(error, 422)) {
    // `ApiError.body` in production; the dev demo router throws plain objects with the same `body`.
    const body = typeof error === 'object' && error !== null && 'body' in error ? (error as { body: unknown }).body : undefined;
    return { ok: false, reason: 'validation', message, fieldErrors: extractFieldErrors(body) };
  }
  return { ok: false, reason: 'failed', message, fieldErrors: {} };
}

function mapSingle(payload: unknown): WorkspaceOffer | null {
  if (!isRecord(payload)) return null;
  return mapOffer(payload.data);
}

export async function createWorkspaceOffer(
  storefrontId: string,
  input: WorkspaceOfferWrite,
  signal?: AbortSignal,
): Promise<WorkspaceOfferMutationOutcome> {
  try {
    const payload = await api<unknown>(commerceWorkspaceOffersPath(storefrontId), {
      method: 'POST',
      body: toBody(input),
      signal,
    });
    const data = mapSingle(payload);
    if (data === null) return { ok: false, reason: 'failed', message: 'invalid_payload', fieldErrors: {} };
    return { ok: true, data };
  } catch (error) {
    return classifyMutationFailure(error, 'create_failed');
  }
}

export async function updateWorkspaceOffer(
  storefrontId: string,
  offerId: string,
  input: WorkspaceOfferWrite,
  signal?: AbortSignal,
): Promise<WorkspaceOfferMutationOutcome> {
  try {
    const payload = await api<unknown>(`${commerceWorkspaceOffersPath(storefrontId)}/${offerId}`, {
      method: 'PATCH',
      body: toBody(input),
      signal,
    });
    const data = mapSingle(payload);
    if (data === null) return { ok: false, reason: 'failed', message: 'invalid_payload', fieldErrors: {} };
    return { ok: true, data };
  } catch (error) {
    return classifyMutationFailure(error, 'update_failed');
  }
}

export async function deleteWorkspaceOffer(
  storefrontId: string,
  offerId: string,
  signal?: AbortSignal,
): Promise<WorkspaceOfferDeleteOutcome> {
  try {
    await api<unknown>(`${commerceWorkspaceOffersPath(storefrontId)}/${offerId}`, { method: 'DELETE', signal });
    return { ok: true };
  } catch (error) {
    return classifyMutationFailure(error, 'delete_failed');
  }
}
