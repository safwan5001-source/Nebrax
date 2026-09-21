'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { AUTH_SESSION_CHANGED_EVENT, currentUser } from './auth';
import { isDemo } from './demo';

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

interface CompanyRequest {
  scope: string;
  company: Company | null;
  pending: Promise<Company> | null;
}

let companyRequest: CompanyRequest | null = null;

/**
 * لا يجوز مشاركة نتيجة `/me` بين مستخدمين أو مستأجرين ولو بقيت القشرة
 * محمّلة بين الخروج والدخول. هوية المستخدم والمستأجر المخزّنة من مسار
 * المصادقة، مع `origin`، تكفي للعزل بلا إدخال التوكن الخام في أي مفتاح.
 */
function companyScopeKey(): string | null {
  if (typeof window === 'undefined') return null;
  const user = currentUser();
  if (!user && !isDemo()) return null;
  return `${window.location.origin}|${user?.tenant_id ?? 'demo-tenant'}|${user?.id ?? 'demo-user'}`;
}

/** يمسح النتيجة الحالية؛ الطلب المعلّق لا يعود قابلاً للاستخدام من مستهلك جديد. */
export function invalidateCompany(): void {
  companyRequest = null;
}

// يبقى إبطال الجلسة صحيحاً حتى لو لم يكن أي مستهلك React مركّباً لحظتها.
if (typeof window !== 'undefined') {
  window.addEventListener(AUTH_SESSION_CHANGED_EVENT, invalidateCompany);
}

/**
 * نقطة ملكية واحدة لبيانات الشركة في قشرة التطبيق:
 * - المستهلكون المتزامنون يتشاركون نفس promise.
 * - النتيجة تبقى في الذاكرة لجلسة/نطاق واحد فقط.
 * - الرفض لا يُخزّن، لذلك المحاولة التالية طلب جديد طبيعي.
 */
export function fetchCompany(): Promise<Company> {
  const scope = companyScopeKey();
  // جلسة غير مكتملة (توكن بلا user محفوظ): نحافظ على سلوك الجلب السابق،
  // لكن لا نشارك أي حالة فيها حتى لا يختلط مستأجران مجهولا الهوية.
  if (!scope) return api<{ company: Company }>('/me').then((response) => response.company);

  if (companyRequest?.company && companyRequest.scope === scope) {
    return Promise.resolve(companyRequest.company);
  }
  if (companyRequest?.pending && companyRequest.scope === scope) {
    return companyRequest.pending;
  }

  let request: CompanyRequest;
  const pending = api<{ company: Company }>('/me')
    .then((response) => {
      // لا نحتفظ بنتيجة اكتملت بعد خروج/دخول أو انتقال نطاق.
      if (companyRequest === request && companyScopeKey() === scope) {
        request.company = response.company;
      }
      return response.company;
    })
    .catch((error) => {
      if (companyRequest === request) companyRequest = null;
      throw error;
    })
    .finally(() => {
      if (companyRequest === request) request.pending = null;
    });
  request = { scope, company: null, pending };
  companyRequest = request;

  return pending;
}

/** تخبر قشرة التطبيق بأن بيانات الشركة، ومنها شعارها، حُفّظت في الإعدادات. */
export function notifyCompanyUpdated(): void {
  invalidateCompany();
  window.dispatchEvent(new Event(COMPANY_UPDATED_EVENT));
}

/** يجلب بيانات الشركة (البائع) من /me لاستخدامها في رؤوس المستندات والقشرة. */
export function useCompany(): Company | null {
  const [company, setCompany] = useState<Company | null>(null);
  const refreshCompany = useCallback(() => {
    const scope = companyScopeKey();
    fetchCompany()
      // لا نرسم نتيجة جلسة أقدم إذا تبدّلت الهوية أثناء الطلب.
      .then((result) => {
        if (scope === companyScopeKey()) setCompany(result);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshCompany();
    window.addEventListener(COMPANY_UPDATED_EVENT, refreshCompany);
    const clearForSessionChange = () => {
      invalidateCompany();
      setCompany(null);
    };
    window.addEventListener(AUTH_SESSION_CHANGED_EVENT, clearForSessionChange);
    return () => {
      window.removeEventListener(COMPANY_UPDATED_EVENT, refreshCompany);
      window.removeEventListener(AUTH_SESSION_CHANGED_EVENT, clearForSessionChange);
    };
  }, [refreshCompany]);

  return company;
}
