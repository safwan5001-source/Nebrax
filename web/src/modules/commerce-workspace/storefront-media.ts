/**
 * CUST-HV V4b — عميل مكتبة وسائط المُخصِّص (V2a) ومشتقّات الاستخدام (V2b).
 *
 * يغلّف نقاط `commerce/workspace/storefront-media*` بنفس اتفاقية العملاء
 * الأخرى: لا `tenant_id` ولا مفتاح تخزين ولا مسار في أي طلب، والمستأجر من
 * الجلسة. الاستجابات لا تحوي مساراً داخلياً — الروابط الموقَّعة قصيرة الأجل
 * للمعاينة داخل المحرر فقط، ولا تدخل المستند أبداً (V0 §7.8).
 *
 * `MediaRef` ↔ تحويل المشتقّات: حقول الإطار (`crop/rotate/focal/fit`) في
 * المرجع **هي** مدخلات `StorefrontMediaTransform` حرفياً (مفتاح المشتقّ يُحسب
 * على الخادم) — فلا توأم TS لدالة التجزئة يمكن أن ينجرف.
 */

import { api, hasApiStatus } from '@/lib/api';
import type { MediaRef } from '@/modules/store-experience-builder/presentation/media-ref';

export const COMMERCE_STOREFRONT_MEDIA_PATH = '/commerce/workspace/storefront-media';

export function commerceStorefrontMediaPath(mediaId: string): string {
  return `${COMMERCE_STOREFRONT_MEDIA_PATH}/${mediaId}`;
}

export type MediaVariantsState = 'pending' | 'ready' | 'failed';

export interface StorefrontMediaAsset {
  id: string;
  name: string;
  mime: string;
  size: number;
  width: number;
  height: number;
  altAr: string | null;
  altEn: string | null;
  variantsState: MediaVariantsState;
  variantsError: string | null;
  /** Signed, short-lived — editor preview only. */
  thumbnailUrl: string | null;
  previewUrl: string | null;
  usageCount: number | null;
}

export interface StorefrontMediaLibraryMeta {
  nextCursor: string | null;
  hasMore: boolean;
  uploadsEnabled: boolean;
  maxFilesPerRequest: number;
  maxBytes: number;
  library: { assets: number; maxAssets: number; bytes: number; maxBytes: number };
}

export interface StorefrontMediaPage {
  items: StorefrontMediaAsset[];
  meta: StorefrontMediaLibraryMeta;
}

type RawAsset = Record<string, unknown>;

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function mapStorefrontMediaAsset(raw: RawAsset): StorefrontMediaAsset {
  const state = raw.variants_state;
  return {
    id: String(raw.id ?? ''),
    name: str(raw.name) ?? '',
    mime: str(raw.mime) ?? '',
    size: num(raw.size),
    width: num(raw.width),
    height: num(raw.height),
    altAr: str(raw.alt_ar),
    altEn: str(raw.alt_en),
    variantsState: state === 'ready' || state === 'failed' ? state : 'pending',
    variantsError: str(raw.variants_error),
    thumbnailUrl: str(raw.thumbnail_url),
    previewUrl: str(raw.preview_url),
    usageCount: typeof raw.usage_count === 'number' ? raw.usage_count : null,
  };
}

export async function listStorefrontMedia(params: {
  q?: string;
  unused?: boolean;
  cursor?: string | null;
  signal?: AbortSignal;
} = {}): Promise<StorefrontMediaPage> {
  const query = new URLSearchParams();
  if (params.q?.trim()) query.set('q', params.q.trim());
  if (params.unused) query.set('unused', '1');
  if (params.cursor) query.set('cursor', params.cursor);
  const qs = query.toString();
  const res = await api<{ data: RawAsset[]; meta: Record<string, unknown> }>(
    `${COMMERCE_STOREFRONT_MEDIA_PATH}${qs ? `?${qs}` : ''}`,
    { signal: params.signal },
  );
  const meta = res.meta ?? {};
  const lib = (meta.library ?? {}) as Record<string, unknown>;
  return {
    items: (res.data ?? []).map(mapStorefrontMediaAsset),
    meta: {
      nextCursor: str(meta.next_cursor),
      hasMore: meta.has_more === true,
      uploadsEnabled: meta.uploads_enabled === true,
      maxFilesPerRequest: num(meta.max_files_per_request) || 1,
      maxBytes: num(meta.max_bytes),
      library: {
        assets: num(lib.assets),
        maxAssets: num(lib.max_assets),
        bytes: num(lib.bytes),
        maxBytes: num(lib.max_bytes),
      },
    },
  };
}

export type UploadOutcome =
  | { status: 'created' | 'duplicate'; name: string; asset: StorefrontMediaAsset }
  | { status: 'rejected'; name: string; code: string; message: string };

/** One file per request so each file has its own progress/error (V0 §7.10). */
export async function uploadStorefrontMedia(file: File): Promise<UploadOutcome> {
  const form = new FormData();
  form.append('files[]', file);
  const res = await api<{ data: Array<Record<string, unknown>> }>(COMMERCE_STOREFRONT_MEDIA_PATH, {
    method: 'POST',
    body: form,
  });
  const first = res.data?.[0];
  if (!first) {
    return { status: 'rejected', name: file.name, code: 'upload_failed', message: '' };
  }
  if (first.status === 'rejected') {
    const err = (first.error ?? {}) as Record<string, unknown>;
    return {
      status: 'rejected',
      name: str(first.name) ?? file.name,
      code: str(err.code) ?? 'upload_failed',
      message: str(err.message) ?? '',
    };
  }
  return {
    status: first.status === 'duplicate' ? 'duplicate' : 'created',
    name: str(first.name) ?? file.name,
    asset: mapStorefrontMediaAsset(first.media as RawAsset),
  };
}

export async function updateStorefrontMediaAlt(
  mediaId: string,
  patch: { altAr?: string | null; altEn?: string | null; name?: string },
): Promise<StorefrontMediaAsset> {
  const body: Record<string, unknown> = {};
  if (patch.altAr !== undefined) body.alt_ar = patch.altAr;
  if (patch.altEn !== undefined) body.alt_en = patch.altEn;
  if (patch.name !== undefined) body.name = patch.name;
  const res = await api<{ data: RawAsset }>(commerceStorefrontMediaPath(mediaId), {
    method: 'PATCH',
    body,
  });
  return mapStorefrontMediaAsset(res.data);
}

export async function retryStorefrontMedia(mediaId: string): Promise<StorefrontMediaAsset> {
  const res = await api<{ data: RawAsset }>(`${commerceStorefrontMediaPath(mediaId)}/retry`, {
    method: 'POST',
  });
  return mapStorefrontMediaAsset(res.data);
}

/** `null` = not found (deleted elsewhere / another tenant's id): the stale state. */
export async function fetchStorefrontMediaAsset(
  mediaId: string,
  signal?: AbortSignal,
): Promise<StorefrontMediaAsset | null> {
  try {
    const res = await api<{ data: RawAsset }>(commerceStorefrontMediaPath(mediaId), { signal });
    return mapStorefrontMediaAsset(res.data);
  } catch (error) {
    if (hasApiStatus(error, 404)) return null;
    throw error;
  }
}

// ─────────────────────────── per-usage derivatives ───────────────────────────

export type UsageState = 'absent' | 'processing' | 'ready' | 'failed';

export interface UsageFile {
  width: number;
  format: 'webp' | 'jpg';
  state: string;
  url: string | null;
  renderedWidth: number | null;
  renderedHeight: number | null;
}

/**
 * CUST-HV V6b-4a — the encoded-channel bounds (already widened by the encoding margin) the server
 * would prove a usage with at publish time; `null` while there is no valid evidence (a framed usage
 * still processing, an asset predating evidence, a translucent picture). Read-only.
 */
export interface UsageContrast {
  min: [number, number, number];
  max: [number, number, number];
}

export interface UsageStatus {
  mediaId: string;
  usageKey: string;
  state: UsageState;
  retryable: boolean;
  errorCode: string | null;
  files: UsageFile[];
  contrast: UsageContrast | null;
}

/** The framing fields of a `MediaRef` — exactly `StorefrontMediaTransform`'s input. */
export interface UsageTransform {
  crop?: MediaRef['crop'];
  rotate?: MediaRef['rotate'];
  focal?: MediaRef['focal'];
  fit?: MediaRef['fit'];
}

export function mediaRefTransform(ref: MediaRef): UsageTransform {
  const out: UsageTransform = {};
  if (ref.crop) out.crop = ref.crop;
  if (ref.rotate) out.rotate = ref.rotate;
  if (ref.focal) out.focal = ref.focal;
  if (ref.fit) out.fit = ref.fit;
  return out;
}

/**
 * A usage with no framing at all has no derivatives — it renders the base
 * ladder (V2b: "the default frame has no derivatives"). Focal/fit alone are
 * identity inputs but still address a (cheap) derivative per V0, so they count.
 */
export function usageNeedsDerivatives(ref: MediaRef): boolean {
  return Object.keys(mediaRefTransform(ref)).length > 0;
}

function channelTriple(raw: unknown): [number, number, number] | null {
  if (!Array.isArray(raw) || raw.length !== 3) return null;
  const out: number[] = [];
  for (const v of raw) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 255) return null;
    out.push(v);
  }
  return [out[0], out[1], out[2]];
}

function mapContrast(raw: unknown): UsageContrast | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const min = channelTriple((raw as Record<string, unknown>).min);
  const max = channelTriple((raw as Record<string, unknown>).max);
  if (!min || !max || min.some((v, i) => v > max[i])) return null;
  return { min, max };
}

function mapUsage(raw: Record<string, unknown>): UsageStatus {
  const state = raw.state;
  const files = Array.isArray(raw.files) ? (raw.files as Array<Record<string, unknown>>) : [];
  return {
    mediaId: String(raw.media_id ?? ''),
    usageKey: String(raw.usage_key ?? ''),
    state: state === 'processing' || state === 'ready' || state === 'failed' ? state : 'absent',
    retryable: raw.retryable === true,
    errorCode: str(raw.error_code),
    files: files.map((f) => ({
      width: num(f.width),
      format: f.format === 'jpg' ? 'jpg' : 'webp',
      state: str(f.state) ?? '',
      url: str(f.url),
      renderedWidth: typeof f.rendered_width === 'number' ? f.rendered_width : null,
      renderedHeight: typeof f.rendered_height === 'number' ? f.rendered_height : null,
    })),
    contrast: mapContrast(raw.contrast),
  };
}

/** Generates (or reclaims) one usage — bounded, one decode (V2b). Idempotent. */
export async function ensureUsage(
  mediaId: string,
  transform: UsageTransform,
  options: { retry?: boolean } = {},
): Promise<UsageStatus> {
  const res = await api<{ data: Record<string, unknown> }>(
    `${commerceStorefrontMediaPath(mediaId)}/derivatives`,
    { method: 'POST', body: { transform, ...(options.retry ? { retry: true } : {}) } },
  );
  return mapUsage(res.data);
}

/** Pure read — never generates. */
export async function usageStatus(
  mediaId: string,
  transform: UsageTransform,
): Promise<UsageStatus> {
  const res = await api<{ data: Array<Record<string, unknown>> }>(
    `${commerceStorefrontMediaPath(mediaId)}/derivatives/status`,
    { method: 'POST', body: { transforms: [transform] } },
  );
  return mapUsage(res.data[0] ?? {});
}

export function isMediaGated(error: unknown): boolean {
  // Uploads disabled / R2 not configured surfaces as a 409/503 with a code.
  return hasApiStatus(error, 503) || hasApiStatus(error, 409);
}

// ─────────────────────────────── alt fallback ───────────────────────────────

export type AltCoverage =
  | { kind: 'decorative' }
  | { kind: 'override'; text: string }
  | { kind: 'library'; text: string }
  | { kind: 'missing' };

/**
 * Per-locale alt resolution, mirrored from the Publish gate (V0 §7.8/AMEND-14):
 * decorative exempts; else the usage override; else the library default **for
 * that locale only** — Arabic never stands in for English.
 */
export function resolveAltCoverage(
  ref: Pick<MediaRef, 'alt' | 'decorative'>,
  asset: Pick<StorefrontMediaAsset, 'altAr' | 'altEn'> | null,
  locale: 'ar' | 'en',
): AltCoverage {
  if (ref.decorative === true) return { kind: 'decorative' };
  const override = ref.alt?.[locale]?.trim();
  if (override) return { kind: 'override', text: override };
  const fallback = (locale === 'ar' ? asset?.altAr : asset?.altEn)?.trim();
  if (fallback) return { kind: 'library', text: fallback };
  return { kind: 'missing' };
}
