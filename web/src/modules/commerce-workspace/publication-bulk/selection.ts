/**
 * COM-CATALOG-3 — selection model for the publication workspace.
 *
 * التحديد = مجموعة **معرّفات صريحة** (id → اسم للعرض فقط). لا يوجد «تحديد كل
 * النتائج المطابقة»: ما يُنفَّذ عليه الإجراء هو بالضبط ما رآه المستخدم وحدّده.
 * تغيّر البحث/الفلاتر يُفرغ التحديد في الصفحة نفسها (انظر page.tsx)، فلا يتسع
 * التحديد صامتاً ولا يبقى مخفياً خلف استعلام مختلف.
 */
export type Selection = ReadonlyMap<string, string>;

export const EMPTY_SELECTION: Selection = new Map();
/** يطابق `BULK_MAX_IDS` في الخادم (يحرسه selection.test.ts) — الخادم يرفض ما فوقه بـ422. */
export const SELECTION_LIMIT = 100;

export type PageSelectionState = 'none' | 'some' | 'all';

export function pageSelectionState(selection: Selection, pageIds: readonly string[]): PageSelectionState {
  if (pageIds.length === 0) return 'none';
  const hits = pageIds.filter((id) => selection.has(id)).length;
  if (hits === 0) return 'none';
  return hits === pageIds.length ? 'all' : 'some';
}

export function toggleOne(
  selection: Selection,
  item: { id: string; name: string },
): { selection: Selection; limitReached: boolean } {
  const next = new Map(selection);
  if (next.has(item.id)) {
    next.delete(item.id);
    return { selection: next, limitReached: false };
  }
  if (next.size >= SELECTION_LIMIT) return { selection, limitReached: true };
  next.set(item.id, item.name);
  return { selection: next, limitReached: false };
}

/**
 * «تحديد الصفحة»: إن كانت كلها محددة تُلغى، وإلا تُضاف الناقصة حتى السقف
 * (لا تُضاف جزئياً بصمت: `limitReached` يُعلَم به المستخدم).
 */
export function togglePage(
  selection: Selection,
  pageItems: ReadonlyArray<{ id: string; name: string }>,
): { selection: Selection; limitReached: boolean } {
  const ids = pageItems.map((item) => item.id);
  const next = new Map(selection);
  if (pageSelectionState(selection, ids) === 'all') {
    for (const id of ids) next.delete(id);
    return { selection: next, limitReached: false };
  }
  let limitReached = false;
  for (const item of pageItems) {
    if (next.has(item.id)) continue;
    if (next.size >= SELECTION_LIMIT) {
      limitReached = true;
      break;
    }
    next.set(item.id, item.name);
  }
  return { selection: next, limitReached };
}

/** بعد النتيجة: يبقى محدداً **الفاشل وحده** (للمحاولة مجدداً)؛ المنفَّذ/غير المتغيّر/المرفوض يخرج. */
export function keepFailedOnly(
  selection: Selection,
  results: ReadonlyArray<{ id: string; status: string }>,
): Selection {
  const failed = new Set(results.filter((entry) => entry.status === 'failed').map((entry) => entry.id));
  return new Map([...selection].filter(([id]) => failed.has(id)));
}

/** `{n}` / `{store}` / `{noun}` — قوالب الرسائل بلا مكتبة ICU (الحزمة ar/en ثابتة النوع). */
export function fillTemplate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}
