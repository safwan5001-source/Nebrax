'use client';

import { useCallback } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { displayLocale } from '@/lib/formatting';
import type { ScopeSummary } from '@/modules/users/model';

export type ScopeKind = 'branches' | 'warehouses';

/**
 * لغة ملخّص النطاق الواحدة (AC-UX-05): «كل الفروع» · «٣ فروع» · «الدمام +٢». الجدول وملخّص المحرّر ونموذج
 * الموظف كلّها تمرّ من هنا فلا تتباعد صياغتها. الفراغ المخزَّن = «الكل» دائماً — لا حالة «لا شيء».
 */
export function useScopeText() {
  const t = useTranslations('users');
  const locale = displayLocale(useLocale());
  return useCallback(
    (summary: ScopeSummary | { kind: 'selected'; count: number }, kind: ScopeKind): string => {
      const num = (n: number) => n.toLocaleString(locale);
      if (summary.kind === 'all') return t(kind === 'branches' ? 'scope_all_branches' : 'scope_all_warehouses');
      if (summary.kind === 'names') {
        return summary.more === 0 ? summary.first : t('scope_first_plus', { name: summary.first, count: num(summary.more) });
      }
      const count = summary.count;
      return t(kind === 'branches' ? 'scope_n_branches' : 'scope_n_warehouses', { n: count, count: num(count) });
    },
    [locale, t],
  );
}
