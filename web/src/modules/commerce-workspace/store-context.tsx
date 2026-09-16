'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  loadCommerceStoreCatalog,
  resolveViewStoreUrl,
  selectStoreId,
  type CommerceStoreCatalog,
} from './stores';

type CommerceStoreContextValue = {
  catalog: CommerceStoreCatalog;
  selectedStoreId: string | null;
  setSelectedStoreId: (id: string) => void;
  viewStoreUrl: string | null;
  /**
   * COM-STORE-PROVISION-1 — يعيد تحميل القائمة الموثوقة من الخادم بعد نجاح
   * التزويد (لا يُحدَّث الكتالوج محلياً من استجابة الإنشاء وحدها). يقبل معرّف
   * ليُختار فور اكتمال إعادة التحميل، بدل انتظار جولة render إضافية.
   */
  refresh: (selectAfter?: string) => Promise<void>;
};

const CommerceStoreContext = createContext<CommerceStoreContextValue | null>(null);

export function CommerceStoreProvider({ children }: { children: ReactNode }) {
  const [catalog, setCatalog] = useState<CommerceStoreCatalog>({ status: 'loading' });
  const [requestedId, setRequestedId] = useState<string | null>(null);

  const load = useCallback(async (guard?: () => boolean) => {
    const next = await loadCommerceStoreCatalog();
    if (!guard || guard()) setCatalog(next);
    return next;
  }, []);

  useEffect(() => {
    let cancelled = false;
    load(() => !cancelled);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = useCallback(
    async (selectAfter?: string) => {
      await load();
      if (selectAfter) setRequestedId(selectAfter);
    },
    [load],
  );

  const selectedStoreId = selectStoreId(catalog, requestedId);
  const viewStoreUrl = resolveViewStoreUrl(catalog, selectedStoreId);

  return (
    <CommerceStoreContext.Provider
      value={{
        catalog,
        selectedStoreId,
        setSelectedStoreId: setRequestedId,
        viewStoreUrl,
        refresh,
      }}
    >
      {children}
    </CommerceStoreContext.Provider>
  );
}

export function useCommerceStoreContext(): CommerceStoreContextValue {
  const value = useContext(CommerceStoreContext);
  if (!value) {
    throw new Error('useCommerceStoreContext must be used inside CommerceStoreProvider');
  }
  return value;
}
