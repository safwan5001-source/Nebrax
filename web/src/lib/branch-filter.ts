import type { Branch } from './branch';
import type { ActiveFilter, FilterDefinition } from './data-explorer/types';

export const BRANCH_FILTER_KEY = 'branch';

/**
 * فلتر الفرع داخل قوائم البيانات مستقل عن سياق الفرع التشغيلي العام.
 * غياب الفلتر يعني «الفرع النشط»، بينما `all` يعني كل الفروع المسموح بها
 * للمستخدم، ومعرّف UUID يضيّق العرض إلى فرع بعينه من القائمة المرخّصة.
 */
export function branchFilterDefinition(
  branches: Branch[],
  activeBranchName?: string | null,
): FilterDefinition {
  return {
    key: BRANCH_FILTER_KEY,
    label: 'الفرع',
    kind: 'entity',
    emptyOptionLabel: activeBranchName ? `الفرع النشط: ${activeBranchName}` : 'الفرع النشط',
    searchPlaceholder: 'ابحث عن فرع بالاسم أو الكود',
    emptyText: 'لا يوجد فرع مطابق',
    options: [
      { value: 'all', label: 'كل الفروع' },
      ...branches.map((branch) => ({
        value: branch.id,
        label: branch.name,
      })),
    ],
  };
}

/** يضيف فلتر الفرع إلى استعلام القائمة من دون المساس بـ X-Branch-Id. */
export function appendBranchFilter(params: URLSearchParams, filters: ActiveFilter[]): void {
  const filter = filters.find((item) => item.key === BRANCH_FILTER_KEY);
  if (!filter || Array.isArray(filter.value)) return;

  const value = String(filter.value).trim();
  if (value) params.set('branch', value);
}
