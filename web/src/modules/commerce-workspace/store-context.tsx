'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import {
  readInitialStoreRequest,
  rememberActiveStore,
  resolveActiveStore,
  syncStoreParamInUrl,
  type ActiveStoreRequest,
} from './active-store';
import {
  loadCommerceStoreCatalog,
  resolveViewStoreUrl,
  type CommerceStoreCatalog,
} from './stores';
import { confirmDiscardUnsaved } from './unsaved-registry';

type CommerceStoreContextValue = {
  catalog: CommerceStoreCatalog;
  selectedStoreId: string | null;
  setSelectedStoreId: (id: string) => void;
  viewStoreUrl: string | null;
  /**
   * AWJ-STORE-CTX-1 — `invalid`: طُلب متجرٌ صراحةً (رابط أو ذاكرة التبويب) وليس في قائمة المستأجر الحالي.
   * AWJ-STORE-CTX-2 — `needs_selection`: أكثر من متجر ولا سياق في التبويب إطلاقاً.
   * في الحالتين `selectedStoreId` = `null` فلا قراءة ولا حفظ حتى يختار المستخدم متجراً. لا سقوط صامت إلى متجر آخر.
   */
  storeContextStatus: 'pending' | 'ready' | 'invalid' | 'needs_selection';
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
  // يُقرأ مرة عند التركيب: `?store=` ثم ذاكرة هذا التبويب. بعد ذلك الاختيار الصريح وحده يغيّر المتجر.
  const [request, setRequest] = useState<ActiveStoreRequest>(() => readInitialStoreRequest());
  const pathname = usePathname();

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
      if (selectAfter) setRequest({ id: selectAfter, source: 'user' });
    },
    [load],
  );

  const resolution = resolveActiveStore(catalog, request);
  const selectedStoreId = resolution.storeId;

  // المتجر المحسوم يُثبَّت في هذا التبويب وفي الرابط بعد كل تنقّل، فيصمد أمام التحديث والتنقّل الصلب والروابط
  // المنسوخة. لا كتابة في `invalid`/`pending`: لا يُمحى اختيارٌ صالح سابق بسبب رابط خاطئ.
  useEffect(() => {
    if (!selectedStoreId) return;
    rememberActiveStore(selectedStoreId);
    if (window.location.pathname.startsWith('/commerce')) syncStoreParamInUrl(selectedStoreId);
  }, [selectedStoreId, pathname]);

  // مبدِّل المتجر يسأل قبل إسقاط مسوّدة غير محفوظة (تُسجَّل في `unsaved-registry` من `useUnsavedGuard`).
  const selectStore = useCallback(
    (id: string) => {
      if (id !== selectedStoreId && !confirmDiscardUnsaved()) return;
      setRequest({ id, source: 'user' });
    },
    [selectedStoreId],
  );
  const viewStoreUrl = resolveViewStoreUrl(catalog, selectedStoreId);

  return (
    <CommerceStoreContext.Provider
      value={{
        catalog,
        selectedStoreId,
        setSelectedStoreId: selectStore,
        viewStoreUrl,
        storeContextStatus: resolution.status,
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

/**
 * نسخة متسامحة: `null` خارج `CommerceStoreProvider`. لصفحات تعمل بلا مزوّد (مثل نظرة التجارة العامة في الاختبارات)
 * وتُغني نفسها حين يتوفّر سياق المتجر، دون أن ترمي.
 */
export function useOptionalCommerceStoreContext(): CommerceStoreContextValue | null {
  return useContext(CommerceStoreContext);
}
