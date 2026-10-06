/**
 * FLOWERS-H2-8 / ADR-18 — إضافات المنتج (`GET|PUT commerce/workspace/products/{id}/addons`). الإضافة منتجٌ حقيقي
 * يُسعَّر ويُحجَز من سلطة AWJ؛ لا يُرسَل هنا أي سعر ولا يُحفظ. السعر المعروض سياقٌ للقراءة فقط من `GET /products/{id}`.
 * الخادم يستبدل المجموعة كاملةً ويرفض: الذات، التكرار، المنتج غير النشط، متعدد الخيارات بلا متغيّر، ما يتطلب تخصيصاً إلزامياً.
 */

import { api } from '@/lib/api';
import { adminCall, bool, list, num, obj, productPath, str, type AdminResult } from '../admin-http';

export const MAX_ADDONS = 8;
export const MAX_ADDON_QUANTITY = 10;

export type AddonRow = {
  addonProductId: string;
  addonVariantId: string | null;
  name: string;
  nameEn: string | null;
  sku: string | null;
  /** حالة المنتج الهدف الآن (قراءة)؛ الحفظ يُرفض إن كان غير نشط. */
  productIsActive: boolean;
  maxQuantity: number;
  isActive: boolean;
};

function mapRow(raw: unknown): AddonRow | null {
  const row = obj(raw);
  const id = str(row?.addon_product_id);
  if (!row || !id) return null;

  return {
    addonProductId: id,
    addonVariantId: str(row.addon_variant_id),
    name: str(row.name) ?? '—',
    nameEn: str(row.name_en),
    sku: str(row.sku),
    productIsActive: bool(row.product_is_active, true),
    maxQuantity: Math.min(MAX_ADDON_QUANTITY, Math.max(1, Math.trunc(num(row.max_quantity, 1)))),
    isActive: bool(row.is_active, true),
  };
}

export function mapAddons(payload: unknown): AddonRow[] | null {
  const rows = obj(obj(payload)?.data)?.addons;
  if (!Array.isArray(rows)) return null;

  // صفٌّ لا نفهمه يُفشل التحميل: حذفه بصمت ثم حفظ المجموعة كاملةً يمحو العلاقة من الخادم.
  const mapped = list(rows).map(mapRow);

  return mapped.every((r): r is AddonRow => r !== null) ? mapped : null;
}

/** العلاقات + بصمتها (`revision`) كما أعادهما الخادم؛ تُعاد عند الحفظ فيرفض الخادم الاستبدال القديم داخل القفل. */
export type AddonsDocument = { rows: AddonRow[]; revision: string | null };

export function mapAddonsDocument(payload: unknown): AddonsDocument | null {
  const rows = mapAddons(payload);
  if (!rows) return null;
  const revision = obj(obj(payload)?.data)?.revision;

  return { rows, revision: typeof revision === 'string' && revision !== '' ? revision : null };
}

export const loadAddons = (productId: string): Promise<AdminResult<AddonsDocument>> =>
  adminCall(async () => mapAddonsDocument(await api<unknown>(productPath(productId, 'addons'))));

export const addonsPayload = (rows: readonly AddonRow[]) => ({
  addons: rows.map((r) => ({
    addon_product_id: r.addonProductId,
    addon_variant_id: r.addonVariantId,
    max_quantity: r.maxQuantity,
    is_active: r.isActive,
  })),
});

export const saveAddons = (productId: string, rows: readonly AddonRow[], expectedRevision: string | null = null): Promise<AdminResult<AddonsDocument>> =>
  adminCall(async () =>
    mapAddonsDocument(
      await api<unknown>(productPath(productId, 'addons'), {
        method: 'PUT',
        body: { ...(expectedRevision ? { expected_revision: expectedRevision } : {}), ...addonsPayload(rows) },
      }),
    ),
  );

export const addonsSignature = (rows: readonly AddonRow[]): string => JSON.stringify(addonsPayload(rows));

export type AddonRowProblem = 'inactive_product';

/** مشكلة تمنع الحفظ في صفٍّ (يعكس رفض الخادم للمنتج غير النشط). */
export const rowProblem = (row: AddonRow): AddonRowProblem | null => (row.productIsActive ? null : 'inactive_product');

export type AddCandidateError = 'self' | 'duplicate' | 'limit';

export function canAdd(rows: readonly AddonRow[], parentId: string, candidateId: string): AddCandidateError | null {
  if (candidateId === parentId) return 'self';
  if (rows.length >= MAX_ADDONS) return 'limit';
  if (rows.some((r) => r.addonProductId === candidateId)) return 'duplicate';

  return null;
}

// ── سياق الإضافة للقراءة: السعر وحالة التغيّر (متعدد الخيارات؟) ──────────────────────────────────────────

export type AddonCandidate = {
  id: string;
  name: string;
  nameEn: string | null;
  sku: string | null;
  isActive: boolean;
  /** نص السعر كما يعيده الخادم (ريال) — للعرض فقط؛ `null` إن لم يُقرأ. */
  price: string | null;
  variantManaged: boolean;
};

export function mapCandidate(payload: unknown): AddonCandidate | null {
  const row = obj(obj(payload)?.data);
  const id = str(row?.id);
  const name = str(row?.name);
  if (!row || !id || !name) return null;

  return {
    id,
    name,
    nameEn: str(row.name_en),
    sku: str(row.sku),
    isActive: bool(row.is_active, true),
    price: typeof row.sale_price === 'string' || typeof row.sale_price === 'number' ? String(row.sale_price) : null,
    variantManaged: row.variant_state === 'variant_managed',
  };
}

export type AddonVariantOption = { id: string; label: string; sku: string; isActive: boolean };

export function mapVariants(payload: unknown): AddonVariantOption[] | null {
  const rows = obj(payload)?.data;
  if (!Array.isArray(rows)) return null;

  return list(rows)
    .map((raw): AddonVariantOption | null => {
      const row = obj(raw);
      const id = str(row?.id);
      const label = str(row?.display_name) ?? str(row?.sku);

      return row && id && label ? { id, label, sku: str(row.sku) ?? '', isActive: bool(row.is_active, true) } : null;
    })
    .filter((v): v is AddonVariantOption => v !== null);
}

export const loadCandidate = (productId: string): Promise<AdminResult<AddonCandidate>> =>
  adminCall(async () => mapCandidate(await api<unknown>(`/products/${encodeURIComponent(productId)}`)));

export const loadVariants = (productId: string): Promise<AdminResult<AddonVariantOption[]>> =>
  adminCall(async () => mapVariants(await api<unknown>(`/products/${encodeURIComponent(productId)}/variants`)));
