/**
 * مساعدات إنشاء نقطة الاستقبال الموقّعة (INT-UX-5c) — منطق نقيّ بلا شبكة ولا واجهة.
 *
 * التحقق هنا **تسهيل للمستخدم لا بديل عن الخادم**: الخادم يقرّر (`invalid_store`، `branch_required`، 409…) وأي رفض منه يُعرض
 * برسالة من القاموس. لكن معرّف المتجر يُقيَّد هنا بما تقرؤه لوحة INT-UX-4 أيضاً (بلا أحرف تحكم)، لأن الخادم لا يمنعها
 * فتصير النقطة المُنشأة غير مقروءة وتُفشل اللوحة كلها.
 */

export const STORE_ID_MAX_BYTES = 191;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export type StoreIdProblem = 'required' | 'tooLong' | 'invalidChars';

export type StoreIdCheck = { ok: true; value: string } | { ok: false; problem: StoreIdProblem };

/**
 * يقصّ المسافات الطرفية (كما يفعل الخادم)، ويشترط وجود قيمة، وحدّ 191 **بايت** (الخادم يقيس `strlen` لا عدد الأحرف:
 * حرف عربي = بايتان) وبلا أحرف تحكم. القيمة المُعادة هي التي تُرسَل.
 */
export function checkStoreId(raw: string): StoreIdCheck {
  const value = raw.trim();
  if (value.length === 0) return { ok: false, problem: 'required' };
  if (CONTROL_CHARS.test(value)) return { ok: false, problem: 'invalidChars' };
  if (new TextEncoder().encode(value).length > STORE_ID_MAX_BYTES) return { ok: false, problem: 'tooLong' };
  return { ok: true, value };
}

export interface BranchOption {
  id: string;
  name: string;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * خيارات الفرع من `GET /branches`: **الفروع النشطة فقط**، للعرض والراحة. قائمة الخادم مصفّاة بنطاق المستخدم، لكن القرار
 * النهائي (فرع غير مسموح 404، غير نشط 422، مطلوب لمقيَّد 422) للخادم عند الإنشاء. حمولة منحرفة ⇒ `null`.
 */
export function readBranchOptions(payload: unknown): BranchOption[] | null {
  const data = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return null;
  const options: BranchOption[] = [];
  for (const row of data) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) return null;
    const { id, name, is_active: active } = row as Record<string, unknown>;
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) return null;
    if (typeof name !== 'string' || name.trim().length === 0 || name.length > 200 || CONTROL_CHARS.test(name)) continue;
    if (active === false) continue;
    options.push({ id, name });
  }
  return options;
}
