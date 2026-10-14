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
 * مفتاح مقارنة الأسماء لكشف التطابق: NFKC ثم إزالة العلامات المركّبة (التشكيل العربي والحركات اللاتينية) والتطويل، وطيّ المسافات،
 * وحالة أحرف موحّدة. **متحفّظ عمداً**: ما يبدو للعين اسماً واحداً (`Sam` / `sam ` / `Sám`) يُعدّ تطابقاً، لأن الخطأ المقبول هنا هو
 * الاستبعاد الزائد لا الخلط بين شخصين.
 */
export function nameKey(name: string): string {
  return name.normalize('NFKD').replace(/\p{M}/gu, '').replace(/\u0640/g, '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

export interface OperatorChoices {
  /** المرشّحون الذين اسمهم فريد بين المؤهلين (ومشغّل النقطة الحالي): وحدهم يُعرضون ويُقبل إرسالهم. */
  selectable: OperatorEntry[];
  /** الأسماء المعروضة (مرة واحدة لكل اسم) التي تعذّر تمييز أصحابها؛ مرتّبة. فارغة = لا التباس. لا بريد ولا معرّف ولا أي بيان تمييزي. */
  ambiguousNames: string[];
}

/**
 * يقسّم المؤهلين إلى «قابل للاختيار» و«ملتبس». **لا يُستعمل الترقيم أو أي بيان آخر لتمييز شخصين متطابقي الاسم**: الواجهة لا تملك
 * وسيلة آمنة لعرض تمييز دون بريد أو معرّف، فيُستبعد **كل** من يتشارك اسمه مع مؤهل آخر، ويُرجع إلى المسؤول. ويُعامل اسم المشغّل
 * الحالي كأحد الأسماء المقارَنة أيضاً (وإلا ظهر ملخّص «من سامي إلى سامي»)، دون أن يصير هو نفسه مرشّحاً.
 * القاعدة تضيّق الاختيار فقط ولا تغيّر أهلية الخادم؛ الخادم يبقى المرجع.
 */
export function operatorChoices(entries: OperatorEntry[], point: { branchId: string | null }, currentOperatorId: string | null | undefined): OperatorChoices {
  const candidates = eligibleOperators(entries, point, currentOperatorId);
  const counts = new Map<string, number>();
  for (const candidate of candidates) counts.set(nameKey(candidate.name), (counts.get(nameKey(candidate.name)) ?? 0) + 1);
  const current = currentOperatorId ? entries.find((entry) => entry.id === currentOperatorId) : undefined;
  if (current) counts.set(nameKey(current.name), (counts.get(nameKey(current.name)) ?? 0) + 1);

  const selectable: OperatorEntry[] = [];
  const ambiguous = new Map<string, string>();
  for (const candidate of candidates) {
    const key = nameKey(candidate.name);
    if ((counts.get(key) ?? 0) > 1) {
      if (!ambiguous.has(key)) ambiguous.set(key, candidate.name);
    } else {
      selectable.push(candidate);
    }
  }
  return { selectable, ambiguousNames: [...ambiguous.values()].sort((a, b) => a.localeCompare(b)) };
}
