'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

export interface Company {
  name: string;
  account_number?: number | null;
  support_number?: number | null;
  vat_number?: string | null;
  cr_number?: string | null;
  currency?: string | null;
  country?: string | null;
  /** data URL أو فارغ — تعرضه قشرة التطبيق ورؤوس المستندات. */
  logo?: string | null;
  phone?: string | null;
  mobile?: string | null;
  building_no?: string | null;
  street?: string | null;
  additional_no?: string | null;
  district?: string | null;
  city?: string | null;
  postal_code?: string | null;
  short_address?: string | null;
}

const COMPANY_UPDATED_EVENT = 'nebrax:company-updated';

/** تخبر قشرة التطبيق بأن بيانات الشركة، ومنها شعارها، حُفّظت في الإعدادات. */
export function notifyCompanyUpdated(): void {
  window.dispatchEvent(new Event(COMPANY_UPDATED_EVENT));
}

/** يجلب بيانات الشركة (البائع) من /me لاستخدامها في رؤوس المستندات والقشرة. */
export function useCompany(): Company | null {
  const [company, setCompany] = useState<Company | null>(null);
  const loadCompany = useCallback(() => {
    api<{ company: Company }>('/me')
      .then((r) => setCompany(r.company))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadCompany();
    window.addEventListener(COMPANY_UPDATED_EVENT, loadCompany);
    return () => window.removeEventListener(COMPANY_UPDATED_EVENT, loadCompany);
  }, [loadCompany]);

  return company;
}
