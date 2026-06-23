'use client';

import { useEffect, useState } from 'react';
import { api } from './api';

export interface Company {
  name: string;
  vat_number?: string | null;
  cr_number?: string | null;
  currency?: string | null;
}

/** يجلب بيانات الشركة (البائع) من /me لاستخدامها في رؤوس المستندات. */
export function useCompany(): Company | null {
  const [company, setCompany] = useState<Company | null>(null);

  useEffect(() => {
    api<{ company: Company }>('/me')
      .then((r) => setCompany(r.company))
      .catch(() => {});
  }, []);

  return company;
}
