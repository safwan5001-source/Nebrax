'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';

/**
 * تسمية مفتاح صلاحية للعرض من كتالوج الرسائل المشترك (`hr.perm_*`) — **عرض فقط**: المفتاح الكنسي هو ما يُقارَن ويُرسَل، ولا يُعاد بناؤه من التسمية.
 * مقطع بلا ترجمة يُعرض كما هو (لا يُخفى ولا يُخمَّن).
 */
export function usePermissionLabel(): (key: string) => string {
  const t = useTranslations('hr');
  return useCallback(
    (key: string) => {
      const parts = key.split('.');
      const module = parts[0];
      const areas = parts.slice(1, -1);
      const action = parts[parts.length - 1];
      const piece = (group: 'perm_modules' | 'perm_areas' | 'perm_actions', name: string) => (t.has(`${group}.${name}`) ? t(`${group}.${name}`) : name);
      const subject = areas.length > 0 ? areas.map((area) => piece('perm_areas', area)).join(' › ') : piece('perm_modules', module);
      return `${subject} — ${piece('perm_actions', action)}`;
    },
    [t],
  );
}
