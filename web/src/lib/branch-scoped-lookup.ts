import { api } from './api';
import type { Branch } from './branch';
import { BRANCH_FILTER_KEY } from './branch-filter';
import type { ActiveFilter } from './data-explorer/types';

interface ApiCollection<T> {
  data: T[];
}

/** القيمة الفعلية لفلتر الفرع في الصفحة؛ الفراغ يعني الفرع التشغيلي النشط. */
export function branchFilterValue(filters: ActiveFilter[]): string {
  const filter = filters.find((item) => item.key === BRANCH_FILTER_KEY);
  if (!filter || Array.isArray(filter.value)) return '';
  return String(filter.value).trim();
}

/**
 * يجلب بيانات lookup بما يطابق نطاق الفرع المختار في الصفحة من دون تغيير
 * الفرع التشغيلي العام. عند `all` تُقرأ الفروع المصرح بها فقط ثم تُدمج بالـ id.
 *
 * هذا مخصص لبيانات الاختيار/الأسماء الصغيرة (عملاء، موردين، تصنيفات)، وليس
 * لقوائم المستندات الكبيرة أو التقارير.
 */
export async function fetchBranchScopedLookup<T extends { id: string }>(
  path: string,
  filters: ActiveFilter[],
  branches: Branch[],
): Promise<T[]> {
  const scope = branchFilterValue(filters);

  if (!scope) {
    return (await api<ApiCollection<T>>(path)).data;
  }

  if (scope !== 'all') {
    // رابط الفلاتر قابل للتعديل يدوياً؛ لا نرسل ترويسة لفرع لم تأتِ من قائمة
    // `/branches` المصرح بها للمستخدم.
    if (!branches.some((branch) => branch.id === scope)) return [];
    return (await api<ApiCollection<T>>(path, { headers: { 'X-Branch-Id': scope } })).data;
  }

  if (branches.length === 0) return [];

  const responses = await Promise.all(
    branches.map((branch) => api<ApiCollection<T>>(path, { headers: { 'X-Branch-Id': branch.id } })),
  );

  const unique = new Map<string, T>();
  for (const response of responses) {
    for (const item of response.data) unique.set(item.id, item);
  }

  return [...unique.values()];
}
