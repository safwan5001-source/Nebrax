/**
 * STORE-ADMIN-ADOPT-1B-2 — Domain Visibility (Read).
 *
 * Tenant authority is server-side (SetTenant → TenantContext). This module
 * only fetches the current session's own storefront's domains, addressed by
 * the storefront id already trusted from `CommerceStoreProvider` — it never
 * sends a tenant identifier and never calls the public Host-resolved
 * storefront API. Read-only: no add/verify/remove/primary-toggle action
 * exists here (that is STORE-ADMIN-ADOPT-1B-3).
 */

import { api } from '@/lib/api';
import { COMMERCE_STORE_ADMIN_LIST_PATH } from './stores';

export type CommerceStoreDomainType = 'awj_subdomain' | 'custom';
export type CommerceStoreDomainVerificationStatus = 'pending' | 'verified' | 'failed';

export type CommerceStoreDomain = {
  id: string;
  hostname: string;
  type: CommerceStoreDomainType;
  isPrimary: boolean;
  isActive: boolean;
  verificationStatus: CommerceStoreDomainVerificationStatus;
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
  };
}
