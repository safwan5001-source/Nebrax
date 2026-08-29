/**
 * أدوات عرض البيانات التقنية — Presentation فقط.
 * لا تُعدّل القيم؛ تحافظ على المحتوى الخام للعرض والنسخ.
 */

/** تسلسل حتمي يتجاهل ترتيب مفاتيح الكائنات — للمقارنة لا للعرض. */
export function stableStringify(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value !== 'object') return JSON.stringify(String(value));
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

/** نص JSON مقروء للعرض والنسخ — يحافظ على القيمة كما هي. */
export function formatTechnicalJson(value: unknown, space = 2): string {
  if (value === undefined) return 'undefined';
  try {
    return JSON.stringify(value, null, space) ?? 'null';
  } catch {
    return String(value);
  }
}

export function valuesEqual(left: unknown, right: unknown): boolean {
  return stableStringify(left) === stableStringify(right);
}

/** هل المسار معرّف تقني يجب ألا يظهر في طبقة العرض البشرية؟ */
export function isTechnicalFieldPath(path: string): boolean {
  const leaf = path.split('.').pop() ?? path;
  return leaf === 'id' || leaf.endsWith('_id') || leaf === 'correlation_id' || leaf === 'product_id';
}
