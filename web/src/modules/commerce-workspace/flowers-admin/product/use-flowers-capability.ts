'use client';

import { useEffect, useState } from 'react';
import { loadCommerceStoreCatalog } from '@/modules/commerce-workspace/stores';

export type FlowersCapability = 'loading' | 'enabled' | 'disabled';

/**
 * هل تعرض مساحة المنتج أقسام الهدايا؟ القدرة تتبع نموذج النشاط لا علَماً محلياً: تُعرض فقط حين يملك المستأجر
 * متجراً بملف «ورد وهدايا». فشل القراءة أو غيابها = `disabled` (لا إزعاج لمتاجر التجزئة العامة ولا يُخمَّن شيء).
 */
export function useFlowersCapability(enabled = true): FlowersCapability {
  const [state, setState] = useState<FlowersCapability>('loading');
  useEffect(() => {
    if (!enabled) {
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
