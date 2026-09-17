/**
 * STORE-ADMIN-ADOPT-1B-2 — Domain Visibility (Read).
 * STORE-ADMIN-ADOPT-1B-3A — Add Custom Domain + DNS TXT Ownership Verification.
 *
 * Tenant authority is server-side (SetTenant → TenantContext). This module
 * only fetches/mutates the current session's own storefront's domains,
 * addressed by the storefront id already trusted from `CommerceStoreProvider`
 * — it never sends a tenant identifier and never calls the public
 * Host-resolved storefront API. `addCommerceCustomDomain`/`verifyCommerceCustomDomain`
 * never send `tenant_id`/`storefront_id`/`type`/`verification_status`/
 * `verification_token`/`verified_at`/`is_primary`/`is_active` — the backend
 * derives all of them server-side and ignores any such field regardless.
 * There is still no Make Primary/Remove/Disconnect/activate-deactivate here
 * — that is 1B-3B's territory.
 */

import { api, hasApiStatus } from '@/lib/api';
import { COMMERCE_STORE_ADMIN_LIST_PATH } from './stores';

export type CommerceStoreDomainType = 'awj_subdomain' | 'custom';
export type CommerceStoreDomainVerificationStatus = 'pending' | 'verified' | 'failed';

export type CommerceStoreDomainVerification = {
  method: 'dns_txt';
  recordName: string;
  recordValue: string;
  verifiedAt: string | null;
};

export type CommerceStoreDomain = {
  id: string;
  hostname: string;
  type: CommerceStoreDomainType;
  isPrimary: boolean;
  isActive: boolean;
  verificationStatus: CommerceStoreDomainVerificationStatus;
  /** Additive (1B-3A) — null for an AWJ-managed domain or a historical row without a stored challenge. */
  verification: CommerceStoreDomainVerification | null;
};

export type CommerceStoreDomainCatalog =
  | { status: 'loading' }
  | { status: 'ready'; domains: CommerceStoreDomain[] }
  | { status: 'empty' }
  | { status: 'error'; message: string };

/** Tenant-scoped, ownership-rechecked nested read — never a client-supplied tenant/domain id. */
export function commerceStoreDomainsPath(storefrontId: string): string {
  return `${COMMERCE_STORE_ADMIN_LIST_PATH}/${storefrontId}/domains`;
}

export async function fetchCommerceStorefrontDomains(
  storefrontId: string,
): Promise<CommerceStoreDomainCatalog> {
  try {
    const payload = await api<unknown>(commerceStoreDomainsPath(storefrontId));
    return mapCommerceStoreDomainCatalog(payload);
  } catch {
    return { status: 'error', message: 'load_failed' };
  }
}

export function mapCommerceStoreDomainCatalog(payload: unknown): CommerceStoreDomainCatalog {
  const rows = extractDomains(payload);
  if (rows === null) return { status: 'error', message: 'invalid_payload' };

  const domains = rows.map(mapDomain).filter((domain): domain is CommerceStoreDomain => domain !== null);
  if (domains.length === 0) return { status: 'empty' };
  return { status: 'ready', domains };
}

function extractDomains(payload: unknown): unknown[] | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const domains = (data as { domains?: unknown }).domains;
  return Array.isArray(domains) ? domains : null;
}

function mapDomain(raw: unknown): CommerceStoreDomain | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== 'string' || row.id === '') return null;
  if (typeof row.hostname !== 'string' || row.hostname === '') return null;
  if (row.type !== 'awj_subdomain' && row.type !== 'custom') return null;
  if (row.verification_status !== 'pending' && row.verification_status !== 'verified' && row.verification_status !== 'failed') {
    return null;
  }

  return {
    id: row.id,
    hostname: row.hostname,
    type: row.type,
    isPrimary: row.is_primary === true,
    isActive: row.is_active === true,
    verificationStatus: row.verification_status,
    verification: mapVerification(row.verification),
  };
}

function mapVerification(raw: unknown): CommerceStoreDomainVerification | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (row.method !== 'dns_txt') return null;
  if (typeof row.record_name !== 'string' || row.record_name === '') return null;
  if (typeof row.record_value !== 'string' || row.record_value === '') return null;

  return {
    method: 'dns_txt',
    recordName: row.record_name,
    recordValue: row.record_value,
    verifiedAt: typeof row.verified_at === 'string' ? row.verified_at : null,
  };
}

export type AddCommerceCustomDomainOutcome =
  | { ok: true; domain: CommerceStoreDomain }
  | { ok: false; reason: 'invalid_hostname' | 'managed_namespace' | 'conflict' | 'forbidden' | 'not_found' | 'failed'; message: string };

/**
 * STORE-ADMIN-ADOPT-1B-3A — إضافة نطاق مخصَّص. الحقل الوحيد المُرسَل هو
 * `hostname` — لا `tenant_id`/`storefront_id`/`type`/حالة تحقّق/`is_primary`/
 * `is_active` إطلاقاً؛ الخادم وحده يحدّدها.
 */
export async function addCommerceCustomDomain(
  storefrontId: string,
  hostname: string,
): Promise<AddCommerceCustomDomainOutcome> {
  try {
    const payload = await api<unknown>(commerceStoreDomainsPath(storefrontId), {
      method: 'POST',
      body: { hostname },
    });
    const domain = extractDomain(payload);
    if (!domain) return { ok: false, reason: 'failed', message: 'invalid_payload' };
    return { ok: true, domain };
  } catch (error) {
    return { ok: false, reason: classifyAddFailure(error), message: error instanceof Error ? error.message : 'add_failed' };
  }
}

function classifyAddFailure(
  error: unknown,
): 'invalid_hostname' | 'managed_namespace' | 'conflict' | 'forbidden' | 'not_found' | 'failed' {
  if (hasApiStatus(error, 409)) return 'conflict';
  if (hasApiStatus(error, 403)) return 'forbidden';
  if (hasApiStatus(error, 404)) return 'not_found';
  if (hasApiStatus(error, 422)) {
    const message = error instanceof Error ? error.message : '';
    return message.includes('أَوْج') || message.toLowerCase().includes('managed') ? 'managed_namespace' : 'invalid_hostname';
  }
  return 'failed';
}

export type VerifyCommerceCustomDomainOutcome =
  | { ok: true; domain: CommerceStoreDomain }
  | { ok: false; reason: 'not_eligible' | 'dns_operational_error' | 'forbidden' | 'not_found' | 'failed'; message: string };

/**
 * STORE-ADMIN-ADOPT-1B-3A — تشغيل تحقّق DNS TXT فعلي. لا حمولة تُرسَل —
 * النتيجة سلطة خادمية بحتة، لا تفاؤل محلي.
 */
export async function verifyCommerceCustomDomain(
  storefrontId: string,
  domainId: string,
): Promise<VerifyCommerceCustomDomainOutcome> {
  try {
    const payload = await api<unknown>(`${commerceStoreDomainsPath(storefrontId)}/${domainId}/verify`, {
      method: 'POST',
      body: {},
    });
    const domain = extractDomain(payload);
    if (!domain) return { ok: false, reason: 'failed', message: 'invalid_payload' };
    return { ok: true, domain };
  } catch (error) {
    return { ok: false, reason: classifyVerifyFailure(error), message: error instanceof Error ? error.message : 'verify_failed' };
  }
}

function classifyVerifyFailure(
  error: unknown,
): 'not_eligible' | 'dns_operational_error' | 'forbidden' | 'not_found' | 'failed' {
  if (hasApiStatus(error, 503)) return 'dns_operational_error';
  if (hasApiStatus(error, 403)) return 'forbidden';
  if (hasApiStatus(error, 404)) return 'not_found';
  if (hasApiStatus(error, 422)) return 'not_eligible';
  return 'failed';
}

function extractDomain(payload: unknown): CommerceStoreDomain | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  return mapDomain((data as { domain?: unknown }).domain);
}
