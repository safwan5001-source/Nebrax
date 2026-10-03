/**
 * CUST-H4-7 — عميل قراءة عروض مساحة عمل Commerce
 * (`commerce/workspace/storefronts/{id}/offers`). نفس اتفاقية
 * `workspace-products.ts`: `{id}` محدِّد صفّ فقط، لا `tenant_id` في أي طلب،
 * والمستأجر من الجلسة عبر `SetTenant`.
 *
 * **قراءة فقط.** تهيئة العرض نفسها (إنشاء/تعديل/حذف) تبقى سلطة CRUD الخاصة
 * بمساحة العمل (H4-6) ولا يستهلكها المخصِّص. القراءة الواحدة تخدم المنتقي
 * وترطيب الاختيارات والـCanvas معاً، فلا طلب لكل عرض ولا طلب منتجٍ لكل عرض.
 *
 * هذا العميل **لا يحسب** شيئاً: `is_live` و`reason` والسعرين و`discount_percent`
 * تُنقل كما أعادها الخادم (سلطة `StorefrontOfferResolver`)، ولا يُشتقّ هنا
 * أي سعر أو نسبة أو حالة حياة.
 */

import { api, hasApiStatus } from '@/lib/api';
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

  return {
    id: row.id,
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
