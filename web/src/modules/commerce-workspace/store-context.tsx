'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
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
};

const CommerceStoreContext = createContext<CommerceStoreContextValue | null>(null);

export function CommerceStoreProvider({ children }: { children: ReactNode }) {
  const [catalog, setCatalog] = useState<CommerceStoreCatalog>({ status: 'loading' });
  const [requestedId, setRequestedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadCommerceStoreCatalog().then((next) => {
      if (!cancelled) setCatalog(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedStoreId = selectStoreId(catalog, requestedId);
  const viewStoreUrl = resolveViewStoreUrl(catalog, selectedStoreId);

  return (
    <CommerceStoreContext.Provider
      value={{
        catalog,
        selectedStoreId,
        setSelectedStoreId: setRequestedId,
        viewStoreUrl,
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
