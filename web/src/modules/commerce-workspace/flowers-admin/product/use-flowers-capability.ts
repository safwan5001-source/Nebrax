'use client';

import { useEffect, useState } from 'react';
import { currentUser } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { loadCommerceStoreCatalog } from '@/modules/commerce-workspace/stores';

export type FlowersCapability = 'loading' | 'enabled' | 'disabled';

/**
 * هل تعرض مساحة المنتج أقسام الهدايا؟ القدرة تتبع نموذج النشاط لا علَماً محلياً: تُعرض فقط حين يملك المستأجر
 * متجراً بملف «ورد وهدايا». فشل القراءة أو غيابها = `disabled` (لا إزعاج لمتاجر التجزئة العامة ولا يُخمَّن شيء).
 * قراءة ملف النشاط تحتاج `commerce.manage` (مسار المتاجر)؛ من لا يملكها يبقى `disabled` **بلا طلب** بدل 403 صامت
 * في كل فتح لصفحة منتج. (دور يملك `products.manage` دون `commerce.manage` لا يرى التبويب — محافظة مقصودة، ADR-27.)
 */
export function useFlowersCapability(enabled = true): FlowersCapability {
  const [state, setState] = useState<FlowersCapability>('loading');
  useEffect(() => {
    const user = currentUser();
    if (!enabled || !hasPermission(user?.permissions, user?.role, 'commerce.manage')) {
      setState('disabled');
      return;
    }
    let current = true;
    void (async () => {
      try {
        const catalog = await loadCommerceStoreCatalog();
        if (!current) return;
        setState(catalog.status === 'ready' && catalog.stores.some((store) => store.businessVertical === 'flowers_gifts') ? 'enabled' : 'disabled');
      } catch {
        if (current) setState('disabled');
      }
    })();

    return () => {
      current = false;
    };
  }, [enabled]);

  return state;
}
