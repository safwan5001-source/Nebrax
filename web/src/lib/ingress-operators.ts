/**
 * دليل المشغّلين لإعادة إسناد نقطة الاستقبال (INT-UX-5d) — منطق نقيّ بلا شبكة ولا واجهة.
 *
 * المصدر: `GET /users` (`users.view`). القارئ **قائمة سماح**: `id` و`name` و`is_active` و`branch_ids` فقط. **البريد الإلكتروني والدور
 * والموظف المرتبط وأي حقل آخر لا يدخل الحالة ولا يُعرض ولا يُرسل** (قرار D2: الاسم فقط). صفّ منحرف يُهمل، وحمولة غير مصفوفة ⇒ `null`.
 *
 * الأهلية هنا **للراحة وتضييق الخيارات** لا للحكم: الخادم هو المرجع (`operator_ineligible` 422). القاعدة المرآة لعقد الخادم:
 * مستخدم **نشط**؛ ونقطة غير موجّهة لفرع لا يقبلها إلا مستخدم **غير مقيَّد** (`branch_ids` فارغة)؛ ونقطة موجّهة لفرع يقبلها غير
 * المقيَّد أو من تشمل فروعه ذلك الفرع. غياب `branch_ids` ⇒ لا يمكن التحقق ⇒ غير مؤهل (يفشل مغلقاً). (نشاط الفرع نفسه يفحصه الخادم.)
 */

export interface OperatorEntry {
  id: string;
  name: string;
  active: boolean;
  /** فارغة = غير مقيَّد (كل الفروع)؛ `null` = غير معروف. */
  branchIds: string[] | null;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const NO_CONTROL = /^[^\u0000-\u001f\u007f]+$/;
const NAME_MAX = 200;

export function readOperatorDirectory(payload: unknown): OperatorEntry[] | null {
  const data = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return null;
  const entries: OperatorEntry[] = [];
  const seen = new Set<string>();
  for (const row of data) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) continue;
    const { id, name, is_active: active, branch_ids: branchIds } = row as Record<string, unknown>;
    if (typeof id !== 'string' || !ID_PATTERN.test(id) || seen.has(id)) continue;
    if (typeof name !== 'string' || name.trim().length === 0 || name.length > NAME_MAX || !NO_CONTROL.test(name)) continue;
    if (typeof active !== 'boolean') continue;
    const branches = Array.isArray(branchIds) && branchIds.every((b) => typeof b === 'string' && ID_PATTERN.test(b)) ? (branchIds as string[]) : null;
    seen.add(id);
    entries.push({ id, name: name.trim(), active, branchIds: branches });
  }
  return entries;
}

/** اسم المشغّل لعرضه، أو `null` إن لم يُعرف (غير موجود في الدليل). */
export function operatorName(entries: OperatorEntry[] | null, id: string | null | undefined): string | null {
  if (entries === null || !id) return null;
  return entries.find((entry) => entry.id === id)?.name ?? null;
}

/** المرشّحون المؤهلون لنقطة بفرعها، دون المشغّل الحالي، مرتّبين بالاسم. */
export function eligibleOperators(entries: OperatorEntry[], point: { branchId: string | null }, currentOperatorId: string | null | undefined): OperatorEntry[] {
  return entries
    .filter((entry) => {
      if (!entry.active || entry.id === currentOperatorId) return false;
      if (entry.branchIds === null) return false;
      const unrestricted = entry.branchIds.length === 0;
      if (point.branchId === null) return unrestricted;
      return unrestricted || entry.branchIds.includes(point.branchId);
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * تسميات القائمة: الاسم وحده. إن تكرر الاسم نفسه بين مرشّحين يُلحق رقم ترتيب `(1)` `(2)` كي لا يُلتبس الاختيار — لا بريد ولا
 * معرّف. (الأسماء المكررة نادرة؛ الاختيار الخاطئ بين متطابقي الاسم خطر معلن في تقرير 5d.)
 */
export function operatorLabels(candidates: OperatorEntry[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const candidate of candidates) counts.set(candidate.name, (counts.get(candidate.name) ?? 0) + 1);
  const index = new Map<string, number>();
  const labels = new Map<string, string>();
  for (const candidate of candidates) {
    if ((counts.get(candidate.name) ?? 0) > 1) {
      const next = (index.get(candidate.name) ?? 0) + 1;
      index.set(candidate.name, next);
      labels.set(candidate.id, `${candidate.name} (${next})`);
    } else {
      labels.set(candidate.id, candidate.name);
    }
  }
  return labels;
}
