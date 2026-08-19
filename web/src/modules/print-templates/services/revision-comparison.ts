export interface RevisionComparisonChange {
  path: string;
  before: unknown;
  after: unknown;
}

type LeafMap = Map<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function flatten(value: unknown, path: string, leaves: LeafMap): void {
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    if (!keys.length) {
      leaves.set(path, value);
      return;
    }
    keys.forEach((key) => flatten(value[key], path ? `${path}.${key}` : key, leaves));
    return;
  }

  // المصفوفة تمثل ترتيباً مقصوداً للكتل أو الأعمدة؛ تعرض لقطة واحدة واضحة بدلاً
  // من فرق مضلل على مؤشرات عناصر قد تتغير لمجرد إعادة ترتيب المستخدم لها.
  leaves.set(path, value);
}

/**
 * يقارن جزأين خاضعين للتدقيق من مراجعتين من دون أي تعديل على التعريفين.
 * ترتيب المفاتيح ثابت لكي يبقى سجل الفروقات قابلاً للاختبار والمراجعة.
 */
export function compareTemplateRevisions(
  before: { documentTypes: readonly string[]; definition: object },
  after: { documentTypes: readonly string[]; definition: object },
): RevisionComparisonChange[] {
  const beforeLeaves: LeafMap = new Map();
  const afterLeaves: LeafMap = new Map();
  flatten([...before.documentTypes].sort(), 'document_types', beforeLeaves);
  flatten(before.definition, 'definition', beforeLeaves);
  flatten([...after.documentTypes].sort(), 'document_types', afterLeaves);
  flatten(after.definition, 'definition', afterLeaves);

  return [...new Set([...beforeLeaves.keys(), ...afterLeaves.keys()])]
    .sort()
    .flatMap((path) => {
      const previous = beforeLeaves.get(path);
      const current = afterLeaves.get(path);
      return stableValue(previous) === stableValue(current)
        ? []
        : [{ path, before: previous, after: current }];
    });
}

export function formatRevisionValue(value: unknown, emptyValue: string): string {
  if (value === undefined || value === null || value === '') return emptyValue;
  if (typeof value === 'string') return value;
  return stableValue(value);
}
