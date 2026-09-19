/**
 * STORE-ADMIN-ADOPT-1B-2 — Domain Visibility (Read).
 * STORE-ADMIN-ADOPT-1B-3A — Add Custom Domain + DNS TXT Ownership Verification.
 * STORE-ADMIN-ADOPT-1B-3B — Safe Make Primary + Disconnect Custom Domain.
 *
 * Tenant authority is server-side (SetTenant → TenantContext). This module
 * only fetches/mutates the current session's own storefront's domains,
 * addressed by the storefront id already trusted from `CommerceStoreProvider`
 * — it never sends a tenant identifier and never calls the public
 * Host-resolved storefront API. `addCommerceCustomDomain`/`verifyCommerceCustomDomain`
 * /`makeCommerceDomainPrimary`/`disconnectCommerceCustomDomain`
 * /`activateCommerceDomainEdge`/`refreshCommerceDomainEdge`
 * never send `tenant_id`/`storefront_id`/`type`/`verification_status`/
 * `verification_token`/`verified_at`/`is_primary`/`is_active`/edge readiness /
 * provider id / DNS records / certificate status —
 * the backend derives all of them server-side and ignores any such field
 * regardless. Frontend gating is not a security boundary.
 */

import { api, hasApiStatus } from '@/lib/api';
import { COMMERCE_STORE_ADMIN_LIST_PATH } from './stores';

export type CommerceStoreDomainType = 'awj_subdomain' | 'custom';
export type CommerceStoreDomainVerificationStatus = 'pending' | 'verified' | 'failed';
export type CommerceStoreDomainEdgeStatus =
  | 'none'
  | 'pending'
  | 'dns_required'
  | 'tls_pending'
  | 'ready'
  | 'failed';

export type CommerceStoreDomainDnsRecord = {
  type: string;
  name: string;
  value: string;
};

export type CommerceStoreDomainEdge = {
  status: CommerceStoreDomainEdgeStatus;
  dnsInstructions: { records: CommerceStoreDomainDnsRecord[] };
  checkedAt: string | null;
  readyAt: string | null;
  lastError: string | null;
};

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
  /** Additive (EDGE-1) — null for AWJ-managed. Custom never invents `ready`. */
  edge: CommerceStoreDomainEdge | null;
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
    edge: row.type === 'custom' ? mapEdge(row.edge) : null,
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

const EDGE_STATUSES: readonly CommerceStoreDomainEdgeStatus[] = [
  'none',
  'pending',
  'dns_required',
  'tls_pending',
  'ready',
  'failed',
];

function isEdgeStatus(value: unknown): value is CommerceStoreDomainEdgeStatus {
  return typeof value === 'string' && (EDGE_STATUSES as readonly string[]).includes(value);
}

function mapEdge(raw: unknown): CommerceStoreDomainEdge {
  const fallback: CommerceStoreDomainEdge = {
    status: 'none',
    dnsInstructions: { records: [] },
    checkedAt: null,
    readyAt: null,
    lastError: null,
  };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fallback;
  const row = raw as Record<string, unknown>;
  const status = isEdgeStatus(row.status) ? row.status : 'failed';
  return {
    status,
    dnsInstructions: { records: mapEdgeRecords(row.dns_instructions) },
    checkedAt: typeof row.checked_at === 'string' ? row.checked_at : null,
    readyAt: typeof row.ready_at === 'string' ? row.ready_at : null,
    lastError: typeof row.last_error === 'string' && row.last_error !== '' ? row.last_error : null,
  };
}

function mapEdgeRecords(raw: unknown): CommerceStoreDomainDnsRecord[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const records = (raw as { records?: unknown }).records;
  if (!Array.isArray(records)) return [];
  const mapped: CommerceStoreDomainDnsRecord[] = [];
  for (const item of records) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    if (typeof row.type !== 'string' || row.type === '') continue;
    if (typeof row.name !== 'string' || row.name === '') continue;
    if (typeof row.value !== 'string' || row.value === '') continue;
    mapped.push({ type: row.type, name: row.name, value: row.value });
  }
  return mapped;
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

/**
 * Make Primary: AWJ-managed verified active not-primary, or custom with
 * server-presented `edge.status === 'ready'`. Frontend is not a security
 * boundary — the backend re-checks the live provider.
 */
export function canMakeDomainPrimary(domain: CommerceStoreDomain): boolean {
  if (domain.verificationStatus !== 'verified' || !domain.isActive || domain.isPrimary) {
    return false;
  }
  if (domain.type === 'awj_subdomain') return true;
  return domain.type === 'custom' && domain.edge?.status === 'ready';
}

export function canDisconnectDomain(domain: CommerceStoreDomain): boolean {
  return domain.type === 'custom';
}

export function canActivateDomainEdge(domain: CommerceStoreDomain): boolean {
  if (domain.type !== 'custom') return false;
  if (domain.verificationStatus !== 'verified' || !domain.isActive) return false;
  const status = domain.edge?.status ?? 'none';
  if (status === 'none') return true;
  if (status === 'failed' && (domain.edge?.dnsInstructions.records.length ?? 0) === 0) return true;
  return false;
}

export function canRefreshDomainEdge(domain: CommerceStoreDomain): boolean {
  if (canActivateDomainEdge(domain)) return false;
  if (domain.type !== 'custom') return false;
  if (domain.verificationStatus !== 'verified' || !domain.isActive) return false;
  const status = domain.edge?.status ?? 'none';
  return status === 'pending' || status === 'dns_required' || status === 'tls_pending' || status === 'failed';
}

export function edgeRefreshKind(domain: CommerceStoreDomain): 'dns' | 'https' | 'retry' | null {
  if (!canRefreshDomainEdge(domain)) return null;
  const status = domain.edge?.status;
  if (status === 'dns_required') return 'dns';
  if (status === 'tls_pending') return 'https';
  return 'retry';
}

export type ActivateCommerceDomainEdgeOutcome =
  | { ok: true; domain: CommerceStoreDomain }
  | {
      ok: false;
      reason: 'not_eligible' | 'conflict' | 'unavailable' | 'forbidden' | 'not_found' | 'failed';
      message: string;
    };

/**
 * CUSTOM-DOMAIN-EDGE-2 — تفعيل الحافة. جسم فارغ؛ لا يُرسل tenant/provider/
 * edge_status/DNS/شهادات. النتيجة سلطة الخادم.
 */
export async function activateCommerceDomainEdge(
  storefrontId: string,
  domainId: string,
): Promise<ActivateCommerceDomainEdgeOutcome> {
  try {
    const payload = await api<unknown>(`${commerceStoreDomainsPath(storefrontId)}/${domainId}/activate-edge`, {
      method: 'POST',
      body: {},
    });
    const domain = extractDomain(payload);
    if (!domain) return { ok: false, reason: 'failed', message: 'invalid_payload' };
    return { ok: true, domain };
  } catch (error) {
    return {
      ok: false,
      reason: classifyActivateFailure(error),
      message: error instanceof Error ? error.message : 'activate_failed',
    };
  }
}

function classifyActivateFailure(
  error: unknown,
): 'not_eligible' | 'conflict' | 'unavailable' | 'forbidden' | 'not_found' | 'failed' {
  if (hasApiStatus(error, 409)) return 'conflict';
  if (hasApiStatus(error, 503)) return 'unavailable';
  if (hasApiStatus(error, 403)) return 'forbidden';
  if (hasApiStatus(error, 404)) return 'not_found';
  if (hasApiStatus(error, 422)) return 'not_eligible';
  return 'failed';
}

export type RefreshCommerceDomainEdgeOutcome =
  | { ok: true; domain: CommerceStoreDomain }
  | {
      ok: false;
      reason: 'not_activated' | 'unavailable' | 'forbidden' | 'not_found' | 'failed';
      message: string;
    };

/**
 * CUSTOM-DOMAIN-EDGE-2 — تحديث حالة الحافة من المزوّد. لا إنشاء، لا جسم،
 * لا تفاؤل محلي.
 */
export async function refreshCommerceDomainEdge(
  storefrontId: string,
  domainId: string,
): Promise<RefreshCommerceDomainEdgeOutcome> {
  try {
    const payload = await api<unknown>(`${commerceStoreDomainsPath(storefrontId)}/${domainId}/refresh-edge`, {
      method: 'POST',
      body: {},
    });
    const domain = extractDomain(payload);
    if (!domain) return { ok: false, reason: 'failed', message: 'invalid_payload' };
    return { ok: true, domain };
  } catch (error) {
    return {
      ok: false,
      reason: classifyRefreshFailure(error),
      message: error instanceof Error ? error.message : 'refresh_failed',
    };
  }
}

function classifyRefreshFailure(
  error: unknown,
): 'not_activated' | 'unavailable' | 'forbidden' | 'not_found' | 'failed' {
  if (hasApiStatus(error, 503)) return 'unavailable';
  if (hasApiStatus(error, 403)) return 'forbidden';
  if (hasApiStatus(error, 404)) return 'not_found';
  if (hasApiStatus(error, 422)) return 'not_activated';
  return 'failed';
}

export type MakeCommerceDomainPrimaryOutcome =
  | { ok: true; domain: CommerceStoreDomain }
  | {
      ok: false;
      reason: 'not_ready' | 'not_eligible' | 'unavailable' | 'forbidden' | 'not_found' | 'failed';
      message: string;
    };

export async function makeCommerceDomainPrimary(
  storefrontId: string,
  domainId: string,
): Promise<MakeCommerceDomainPrimaryOutcome> {
  try {
    const payload = await api<unknown>(`${commerceStoreDomainsPath(storefrontId)}/${domainId}/make-primary`, {
      method: 'POST',
      body: {},
    });
    const domain = extractDomain(payload);
    if (!domain) return { ok: false, reason: 'failed', message: 'invalid_payload' };
    return { ok: true, domain };
  } catch (error) {
    return {
      ok: false,
      reason: classifyMakePrimaryFailure(error),
      message: error instanceof Error ? error.message : 'make_primary_failed',
    };
  }
}

function classifyMakePrimaryFailure(
  error: unknown,
): 'not_ready' | 'not_eligible' | 'unavailable' | 'forbidden' | 'not_found' | 'failed' {
  if (hasApiStatus(error, 503)) return 'unavailable';
  if (hasApiStatus(error, 403)) return 'forbidden';
  if (hasApiStatus(error, 404)) return 'not_found';
  if (hasApiStatus(error, 422)) {
    const message = error instanceof Error ? error.message : '';
    return message.includes('HTTPS') || message.includes('تفعيل') ? 'not_ready' : 'not_eligible';
  }
  return 'failed';
}

export type DisconnectCommerceCustomDomainOutcome =
  | { ok: true }
  | {
      ok: false;
      reason: 'managed' | 'primary' | 'unavailable' | 'forbidden' | 'not_found' | 'failed';
      message: string;
    };

export async function disconnectCommerceCustomDomain(
  storefrontId: string,
  domainId: string,
): Promise<DisconnectCommerceCustomDomainOutcome> {
  try {
    await api<unknown>(`${commerceStoreDomainsPath(storefrontId)}/${domainId}`, {
      method: 'DELETE',
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: classifyDisconnectFailure(error),
      message: error instanceof Error ? error.message : 'disconnect_failed',
    };
  }
}

function classifyDisconnectFailure(
  error: unknown,
): 'managed' | 'primary' | 'unavailable' | 'forbidden' | 'not_found' | 'failed' {
  if (hasApiStatus(error, 503)) return 'unavailable';
  if (hasApiStatus(error, 403)) return 'forbidden';
  if (hasApiStatus(error, 404)) return 'not_found';
  if (hasApiStatus(error, 422)) {
    const message = error instanceof Error ? error.message : '';
    return message.includes('الأساسي') || message.toLowerCase().includes('primary') ? 'primary' : 'managed';
  }
  return 'failed';
}
