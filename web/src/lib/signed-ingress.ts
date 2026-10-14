/**
 * لوحة نقاط الاستقبال الموقّعة للقراءة فقط (INT-UX-4) — منطق نقيّ لا يلمس الشبكة ولا الواجهة.
 *
 * مصدر البيانات الوحيد: `GET /api/delivery-connectors` (صلاحية `delivery_connector.view` + قدرة `sales.pos`).
 * القارئ هنا **قائمة سماح** صريحة: يقرأ أربعة أنواع من الحقول فقط، وما عداها لا يدخل أي حالة ولا DOM.
 * الحقول التي يُرجعها الخادم ولا تُقرأ عمداً:
 *  - `secret_prefix`: جزء من سرّ التوقيع. قرار المالك (DP-C) ألّا يُعرض أبداً.
 *  - `configured_by` / `operated_by`: معرّفات مستخدمين، ولا مصدر معتمد لأسمائها في هذه الشريحة.
 *  - `id`: يُستعمل مفتاحاً للقائمة فقط ولا يُعرض (جزء من عنوان نقطة الاستقبال).
 *  - `delivery_platform_profile_id`: غير لازم للعرض.
 * وقيمة السرّ الكاملة لا يعيدها هذا المسار أصلاً (تُعاد عند الإنشاء والتدوير فقط).
 *
 * القراءة الفاشلة أو غير المفهومة تعود `null` («تعذّرت القراءة»)، لا قائمة فارغة: الفراغ ادّعاء، والفشل ليس ادّعاءً.
 */

export const SIGNED_INGRESS_VIEW_PERMISSION = 'delivery_connector.view';
export const BRANCHES_VIEW_PERMISSION = 'branches.view';

export type IngressStatus = 'configured' | 'disabled';

export interface IngressPoint {
  /** مفتاح القائمة فقط؛ لا يُعرض. */
  id: string;
  /** معرّف المتجر عند المزوّد كما أدخله المشغّل: تسمية لنقطة الاستقبال، وليس دليل اتصال أصلي. */
  storeId: string;
  branchId: string | null;
  status: IngressStatus;
  secretVersion: number;
  createdAt: string | null;
  disabledAt: string | null;
}

const KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
// أحرف التحكم (بما فيها الأسطر الجديدة) ممنوعة: نص يُعرض كما هو في خلية جدول.
const NO_CONTROL = /^[^\u0000-\u001f\u007f]+$/;
const STORE_ID_MAX = 191;
const BRANCH_NAME_MAX = 200;

function objectRows(payload: unknown): Record<string, unknown>[] | null {
  const data = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return null;
  if (!data.every((row) => row !== null && typeof row === 'object' && !Array.isArray(row))) return null;
  return data as Record<string, unknown>[];
}

function plainText(value: unknown, max: number): string | null {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0 || value.length > max) return null;
  return NO_CONTROL.test(value) ? value : null;
}

/** تاريخ وصفي فقط: صيغة غير صالحة تُخفى (`null`) ولا تُفشل القراءة. */
function optionalDate(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 40) return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
}

/**
 * نقاط الاستقبال الخاصة بمنصة واحدة من استجابة القائمة. صفوف المنصات الأخرى تُتجاهل بعد التحقق من أنها
 * كائنات بمفتاح منصة نصّي؛ وصف المنصة المعروضة يجب أن يكون سليماً كاملاً وإلا فالقراءة كلها `null`
 * (لا يُعرض نصف سليم من حمولة منحرفة العقد). تكرار المعرّف مرفوض.
 */
export function readIngressPoints(payload: unknown, platformKey: string): IngressPoint[] | null {
  const rows = objectRows(payload);
  if (rows === null) return null;

  const points: IngressPoint[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (typeof row.platform_key !== 'string') return null;
    if (row.platform_key !== platformKey) continue;

    const id = typeof row.id === 'string' && KEY_PATTERN.test(row.id) ? row.id : null;
    const storeId = plainText(row.external_store_id, STORE_ID_MAX);
    const status = row.status === 'configured' || row.status === 'disabled' ? row.status : null;
    const version = typeof row.secret_version === 'number' && Number.isSafeInteger(row.secret_version) && row.secret_version >= 1
      ? row.secret_version
      : null;
    let branchId: string | null;
    if (row.branch_id === null) branchId = null;
    else if (typeof row.branch_id === 'string' && KEY_PATTERN.test(row.branch_id)) branchId = row.branch_id;
    else return null;

    if (id === null || storeId === null || status === null || version === null) return null;
    if (seen.has(id)) return null;
    seen.add(id);

    points.push({
      id,
      storeId,
      branchId,
      status,
      secretVersion: version,
      createdAt: optionalDate(row.created_at),
      disabledAt: optionalDate(row.disabled_at),
    });
  }
  return points;
}

/** أسماء الفروع من `GET /api/branches` (`branches.view`): معرّف → اسم. صف منحرف يُتجاهل، وحمولة غير مصفوفة ⇒ `null`. */
export function readBranchNames(payload: unknown): Map<string, string> | null {
  const rows = objectRows(payload);
  if (rows === null) return null;
  const names = new Map<string, string>();
  for (const row of rows) {
    const id = typeof row.id === 'string' && KEY_PATTERN.test(row.id) ? row.id : null;
    const name = plainText(row.name, BRANCH_NAME_MAX);
    if (id !== null && name !== null) names.set(id, name);
  }
  return names;
}

export type BranchLabel =
  | { kind: 'named'; name: string }
  | { kind: 'routed' }
  | { kind: 'unrouted' }
  | { kind: 'unavailable' };

/**
 * وصف الفرع الموجّهة إليه النقطة. بلا `branches.view` وصف محايد («موجّهة إلى فرع») بلا اسم ولا معرّف ولا
 * مصدر بديل؛ ومع الصلاحية يُعرض الاسم فقط إن وُجد في القائمة المصرّح بها، وإلا «غير متاح» (لا يُخمَّن).
 */
export function branchLabel(point: IngressPoint, canViewBranches: boolean, names: Map<string, string> | null): BranchLabel {
  if (point.branchId === null) return { kind: 'unrouted' };
  if (!canViewBranches) return { kind: 'routed' };
  const name = names?.get(point.branchId);
  return name ? { kind: 'named', name } : { kind: 'unavailable' };
}
