import { afterEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.fn();
class FakeApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
vi.mock('@/lib/api', () => ({
  api: (...args: unknown[]) => apiMock(...args),
  hasApiStatus: (error: unknown, status: number) => (error as { status?: number })?.status === status,
}));

import {
  activateCommerceDomainEdge,
  addCommerceCustomDomain,
  canActivateDomainEdge,
  canDisconnectDomain,
  canMakeDomainPrimary,
  canRefreshDomainEdge,
  commerceStoreDomainsPath,
  disconnectCommerceCustomDomain,
  fetchCommerceStorefrontDomains,
  makeCommerceDomainPrimary,
  mapCommerceStoreDomainCatalog,
  refreshCommerceDomainEdge,
  verifyCommerceCustomDomain,
} from './domains';

afterEach(() => apiMock.mockReset());

describe('commerce store domains client', () => {
  it('builds a nested per-storefront path — never a client-supplied tenant id', () => {
    expect(commerceStoreDomainsPath('store-1')).toBe('/commerce/workspace/storefronts/store-1/domains');
    expect(commerceStoreDomainsPath('store-1')).not.toContain('tenant');
  });

  it('fetches exactly the nested path for the given storefront id', async () => {
    apiMock.mockResolvedValueOnce({ data: { domains: [] } });

    await fetchCommerceStorefrontDomains('store-1');

    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock).toHaveBeenCalledWith('/commerce/workspace/storefronts/store-1/domains');
  });

  it('maps a ready payload with AWJ-managed and custom domains', () => {
    const catalog = mapCommerceStoreDomainCatalog({
      data: {
        domains: [
          {
            id: 'd1',
            hostname: 'my-store.awj-commerce.test',
            type: 'awj_subdomain',
            is_primary: true,
            is_active: true,
            verification_status: 'verified',
          },
          {
            id: 'd2',
            hostname: 'shop.example.com',
            type: 'custom',
            is_primary: false,
            is_active: true,
            verification_status: 'pending',
          },
        ],
      },
    });

    expect(catalog.status).toBe('ready');
    if (catalog.status !== 'ready') throw new Error('unreachable');
    expect(catalog.domains).toHaveLength(2);
    expect(catalog.domains[0]).toEqual({
      id: 'd1',
      hostname: 'my-store.awj-commerce.test',
      type: 'awj_subdomain',
      isPrimary: true,
      isActive: true,
      verificationStatus: 'verified',
      // Additive (1B-3A) — absent in the raw payload maps to null.
      verification: null,
      edge: null,
    });
    expect(catalog.domains[1].type).toBe('custom');
    expect(catalog.domains[1].verificationStatus).toBe('pending');
    expect(catalog.domains[1].edge).toEqual({
      status: 'none',
      dnsInstructions: { records: [] },
      checkedAt: null,
      readyAt: null,
      lastError: null,
    });
  });

  it('maps a zero-domain payload to the empty status, not an error', () => {
    expect(mapCommerceStoreDomainCatalog({ data: { domains: [] } })).toEqual({ status: 'empty' });
  });

  it('treats a malformed payload as an error, never fabricated data', () => {
    expect(mapCommerceStoreDomainCatalog({ data: {} }).status).toBe('error');
    expect(mapCommerceStoreDomainCatalog(null).status).toBe('error');
    expect(mapCommerceStoreDomainCatalog({ data: { domains: 'nope' } }).status).toBe('error');
  });

  it('surfaces a network/API failure as an error status, not fake domain data', async () => {
    apiMock.mockRejectedValueOnce(new Error('forbidden'));

    const catalog = await fetchCommerceStorefrontDomains('store-1');

    expect(catalog.status).toBe('error');
  });

  it('maps the additive verification object for a pending custom domain', () => {
    const catalog = mapCommerceStoreDomainCatalog({
      data: {
        domains: [
          {
            id: 'd2',
            hostname: 'shop.example.com',
            type: 'custom',
            is_primary: false,
            is_active: true,
            verification_status: 'pending',
            verification: {
              method: 'dns_txt',
              record_name: '_awj-verification.shop.example.com',
              record_value: 'awj-domain-verification=abc123',
              verified_at: null,
            },
          },
        ],
      },
    });

    expect(catalog.status).toBe('ready');
    if (catalog.status !== 'ready') throw new Error('unreachable');
    expect(catalog.domains[0].verification).toEqual({
      method: 'dns_txt',
      recordName: '_awj-verification.shop.example.com',
      recordValue: 'awj-domain-verification=abc123',
      verifiedAt: null,
    });
  });

  it('maps a null verification object for an AWJ-managed domain', () => {
    const catalog = mapCommerceStoreDomainCatalog({
      data: {
        domains: [
          {
            id: 'd1',
            hostname: 'my-store.awj-commerce.test',
            type: 'awj_subdomain',
            is_primary: true,
            is_active: true,
            verification_status: 'verified',
            verification: null,
          },
        ],
      },
    });

    expect(catalog.status).toBe('ready');
    if (catalog.status !== 'ready') throw new Error('unreachable');
    expect(catalog.domains[0].verification).toBeNull();
    expect(catalog.domains[0].edge).toBeNull();
  });

  it('maps the additive edge object for a custom domain and never invents ready', () => {
    const catalog = mapCommerceStoreDomainCatalog({
      data: {
        domains: [
          {
            id: 'd2',
            hostname: 'shop.example.com',
            type: 'custom',
            is_primary: false,
            is_active: true,
            verification_status: 'verified',
            edge: {
              status: 'dns_required',
              dns_instructions: {
                records: [
                  { type: 'CNAME', name: 'shop.example.com', value: 'g05ns7.up.railway.app' },
                  { type: 'TXT', name: '_railway-verify.shop.example.com', value: 'railway-verify=abc' },
                  { type: 'CNAME', name: '', value: 'skip-me' },
                ],
              },
              checked_at: '2026-01-02T00:00:00Z',
              ready_at: null,
              last_error: null,
            },
          },
        ],
      },
    });

    expect(catalog.status).toBe('ready');
    if (catalog.status !== 'ready') throw new Error('unreachable');
    expect(catalog.domains[0].edge).toEqual({
      status: 'dns_required',
      dnsInstructions: {
        records: [
          { type: 'CNAME', name: 'shop.example.com', value: 'g05ns7.up.railway.app' },
          { type: 'TXT', name: '_railway-verify.shop.example.com', value: 'railway-verify=abc' },
        ],
      },
      checkedAt: '2026-01-02T00:00:00Z',
      readyAt: null,
      lastError: null,
    });
  });

  it('treats an unknown edge status as failed, never as ready', () => {
    const catalog = mapCommerceStoreDomainCatalog({
      data: {
        domains: [
          {
            id: 'd2',
            hostname: 'shop.example.com',
            type: 'custom',
            is_primary: false,
            is_active: true,
            verification_status: 'verified',
            edge: { status: 'issued', dns_instructions: { records: [] } },
          },
        ],
      },
    });
    expect(catalog.status).toBe('ready');
    if (catalog.status !== 'ready') throw new Error('unreachable');
    expect(catalog.domains[0].edge?.status).toBe('failed');
  });
});

describe('add custom domain', () => {
  afterEach(() => apiMock.mockReset());

  it('sends only the hostname field — never a tenant/storefront/type/verification/primary/active authority field', async () => {
    apiMock.mockResolvedValueOnce({
      data: {
        domain: {
          id: 'd3',
          hostname: 'shop.example.com',
          type: 'custom',
          is_primary: false,
          is_active: true,
          verification_status: 'pending',
          verification: {
            method: 'dns_txt',
            record_name: '_awj-verification.shop.example.com',
            record_value: 'awj-domain-verification=abc123',
            verified_at: null,
          },
        },
      },
    });

    await addCommerceCustomDomain('store-1', 'shop.example.com');

    expect(apiMock).toHaveBeenCalledWith('/commerce/workspace/storefronts/store-1/domains', {
      method: 'POST',
      body: { hostname: 'shop.example.com' },
    });
  });

  it('returns the authoritative created domain including DNS instructions on success', async () => {
    apiMock.mockResolvedValueOnce({
      data: {
        domain: {
          id: 'd3',
          hostname: 'shop.example.com',
          type: 'custom',
          is_primary: false,
          is_active: true,
          verification_status: 'pending',
          verification: {
            method: 'dns_txt',
            record_name: '_awj-verification.shop.example.com',
            record_value: 'awj-domain-verification=abc123',
            verified_at: null,
          },
        },
      },
    });

    const result = await addCommerceCustomDomain('store-1', 'shop.example.com');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.domain.verification?.recordValue).toBe('awj-domain-verification=abc123');
  });

  it('classifies a 409 as a conflict, not a generic failure', async () => {
    apiMock.mockRejectedValueOnce(new FakeApiError(409, 'duplicate'));

    const result = await addCommerceCustomDomain('store-1', 'shop.example.com');

    expect(result).toEqual({ ok: false, reason: 'conflict', message: 'duplicate' });
  });

  it('classifies a 403 as forbidden', async () => {
    apiMock.mockRejectedValueOnce(new FakeApiError(403, 'forbidden'));

    const result = await addCommerceCustomDomain('store-1', 'shop.example.com');

    expect(result).toEqual({ ok: false, reason: 'forbidden', message: 'forbidden' });
  });

  it('classifies a 404 as not found', async () => {
    apiMock.mockRejectedValueOnce(new FakeApiError(404, 'not found'));

    const result = await addCommerceCustomDomain('store-1', 'shop.example.com');

    expect(result).toEqual({ ok: false, reason: 'not_found', message: 'not found' });
  });
});

describe('verify custom domain', () => {
  afterEach(() => apiMock.mockReset());

  it('sends no body and never lets the client influence the verification result', async () => {
    apiMock.mockResolvedValueOnce({
      data: {
        domain: {
          id: 'd3',
          hostname: 'shop.example.com',
          type: 'custom',
          is_primary: false,
          is_active: true,
          verification_status: 'verified',
          verification: {
            method: 'dns_txt',
            record_name: '_awj-verification.shop.example.com',
            record_value: 'awj-domain-verification=abc123',
            verified_at: '2026-01-01T00:00:00Z',
          },
        },
      },
    });

    await verifyCommerceCustomDomain('store-1', 'd3');

    expect(apiMock).toHaveBeenCalledWith('/commerce/workspace/storefronts/store-1/domains/d3/verify', {
      method: 'POST',
      body: {},
    });
  });

  it('returns the authoritative server verification result on success', async () => {
    apiMock.mockResolvedValueOnce({
      data: {
        domain: {
          id: 'd3',
          hostname: 'shop.example.com',
          type: 'custom',
          is_primary: false,
          is_active: true,
          verification_status: 'verified',
          verification: {
            method: 'dns_txt',
            record_name: '_awj-verification.shop.example.com',
            record_value: 'awj-domain-verification=abc123',
            verified_at: '2026-01-01T00:00:00Z',
          },
        },
      },
    });

    const result = await verifyCommerceCustomDomain('store-1', 'd3');

    expect(result).toEqual({
      ok: true,
      domain: expect.objectContaining({ verificationStatus: 'verified' }),
    });
  });

  it('classifies a 503 as a DNS operational error, distinct from a definitive non-match', async () => {
    apiMock.mockRejectedValueOnce(new FakeApiError(503, 'dns down'));

    const result = await verifyCommerceCustomDomain('store-1', 'd3');

    expect(result).toEqual({ ok: false, reason: 'dns_operational_error', message: 'dns down' });
  });

  it('classifies a 422 as not eligible (e.g. an AWJ-managed domain)', async () => {
    apiMock.mockRejectedValueOnce(new FakeApiError(422, 'not eligible'));

    const result = await verifyCommerceCustomDomain('store-1', 'd3');

    expect(result).toEqual({ ok: false, reason: 'not_eligible', message: 'not eligible' });
  });
});

describe('make primary', () => {
  afterEach(() => apiMock.mockReset());

  it('sends an empty body and never lets the client set is_primary or edge readiness', async () => {
    apiMock.mockResolvedValueOnce({
      data: {
        domain: {
          id: 'd1',
          hostname: 'my-store.awj-commerce.test',
          type: 'awj_subdomain',
          is_primary: true,
          is_active: true,
          verification_status: 'verified',
          verification: null,
        },
      },
    });

    await makeCommerceDomainPrimary('store-1', 'd1');

    expect(apiMock).toHaveBeenCalledWith('/commerce/workspace/storefronts/store-1/domains/d1/make-primary', {
      method: 'POST',
      body: {},
    });
  });

  it('classifies a 422 about HTTPS activation as not_ready, distinct from generic ineligibility', async () => {
    apiMock.mockRejectedValueOnce(
      new FakeApiError(422, 'Domain ownership is verified, but HTTPS/domain activation is not complete yet.'),
    );

    const result = await makeCommerceDomainPrimary('store-1', 'd2');

    expect(result).toEqual({
      ok: false,
      reason: 'not_ready',
      message: 'Domain ownership is verified, but HTTPS/domain activation is not complete yet.',
    });
  });

  it('classifies a 503 as unavailable, distinct from not_ready', async () => {
    apiMock.mockRejectedValueOnce(new FakeApiError(503, 'The edge provider is unavailable right now — try again later.'));

    const result = await makeCommerceDomainPrimary('store-1', 'd2');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('unavailable');
  });
});

describe('disconnect custom domain', () => {
  afterEach(() => apiMock.mockReset());

  it('sends DELETE with no body and no authority fields', async () => {
    apiMock.mockResolvedValueOnce({ data: { disconnected: true } });

    await disconnectCommerceCustomDomain('store-1', 'd2');

    expect(apiMock).toHaveBeenCalledWith('/commerce/workspace/storefronts/store-1/domains/d2', {
      method: 'DELETE',
    });
  });

  it('classifies a 422 about the current primary as primary, not a generic failure', async () => {
    apiMock.mockRejectedValueOnce(new FakeApiError(422, 'The current primary domain cannot be disconnected'));

    const result = await disconnectCommerceCustomDomain('store-1', 'd2');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('primary');
  });

  it('classifies a 503 as unavailable and does not treat it as success', async () => {
    apiMock.mockRejectedValueOnce(new FakeApiError(503, 'Could not disconnect the domain with the edge provider right now — try again later.'));

    const result = await disconnectCommerceCustomDomain('store-1', 'd2');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('unavailable');
  });
});

describe('frontend action eligibility — not a security boundary', () => {
  const awjPrimary = {
    id: 'd1',
    hostname: 'my-store.awj-commerce.test',
    type: 'awj_subdomain' as const,
    isPrimary: true,
    isActive: true,
    verificationStatus: 'verified' as const,
    verification: null,
    edge: null,
  };
  const awjSecondary = { ...awjPrimary, id: 'd1b', isPrimary: false, hostname: 'other.awj-commerce.test' };
  const customVerified = {
    id: 'd2',
    hostname: 'shop.example.com',
    type: 'custom' as const,
    isPrimary: false,
    isActive: true,
    verificationStatus: 'verified' as const,
    verification: null,
    edge: {
      status: 'none' as const,
      dnsInstructions: { records: [] },
      checkedAt: null,
      readyAt: null,
      lastError: null,
    },
  };
  const customReady = {
    ...customVerified,
    id: 'd2-ready',
    edge: {
      status: 'ready' as const,
      dnsInstructions: { records: [] },
      checkedAt: '2026-01-02T00:00:00Z',
      readyAt: '2026-01-02T00:00:00Z',
      lastError: null,
    },
  };

  it('allows Make Primary for an eligible AWJ-managed domain and for a custom domain the server presents as ready', () => {
    expect(canMakeDomainPrimary(awjSecondary)).toBe(true);
    expect(canMakeDomainPrimary(awjPrimary)).toBe(false);
    expect(canMakeDomainPrimary(customVerified)).toBe(false);
    expect(canMakeDomainPrimary(customReady)).toBe(true);
  });

  it('allows Disconnect only for a custom domain', () => {
    expect(canDisconnectDomain(customVerified)).toBe(true);
    expect(canDisconnectDomain(awjPrimary)).toBe(false);
  });

  it('allows Activate only for a verified custom domain with edge none', () => {
    expect(canActivateDomainEdge(customVerified)).toBe(true);
    expect(canActivateDomainEdge(customReady)).toBe(false);
    expect(canActivateDomainEdge(awjSecondary)).toBe(false);
  });

  it('does not allow Refresh before activation, and never treats ready as a refresh target', () => {
    expect(canRefreshDomainEdge(customVerified)).toBe(false);
    expect(canRefreshDomainEdge(customReady)).toBe(false);
  });
});

describe('activate edge', () => {
  afterEach(() => apiMock.mockReset());

  it('sends an empty body and never lets the client set edge_status, provider id, or DNS records', async () => {
    apiMock.mockResolvedValueOnce({
      data: {
        domain: {
          id: 'd2',
          hostname: 'shop.example.com',
          type: 'custom',
          is_primary: false,
          is_active: true,
          verification_status: 'verified',
          edge: {
            status: 'dns_required',
            dns_instructions: { records: [{ type: 'CNAME', name: 'shop.example.com', value: 'g05ns7.up.railway.app' }] },
            checked_at: '2026-01-02T00:00:00Z',
            ready_at: null,
            last_error: null,
          },
        },
      },
    });

    await activateCommerceDomainEdge('store-1', 'd2');

    expect(apiMock).toHaveBeenCalledWith('/commerce/workspace/storefronts/store-1/domains/d2/activate-edge', {
      method: 'POST',
      body: {},
    });
    const body = apiMock.mock.calls[0][1].body as Record<string, unknown>;
    expect(body).toEqual({});
    expect(body).not.toHaveProperty('tenant_id');
    expect(body).not.toHaveProperty('edge_status');
    expect(body).not.toHaveProperty('edge_provider_id');
    expect(body).not.toHaveProperty('dns_instructions');
    expect(body).not.toHaveProperty('certificate_status');
  });

  it('returns the authoritative edge payload on success', async () => {
    apiMock.mockResolvedValueOnce({
      data: {
        domain: {
          id: 'd2',
          hostname: 'shop.example.com',
          type: 'custom',
          is_primary: false,
          is_active: true,
          verification_status: 'verified',
          edge: {
            status: 'dns_required',
            dns_instructions: { records: [{ type: 'CNAME', name: 'shop.example.com', value: 'g05ns7.up.railway.app' }] },
            checked_at: '2026-01-02T00:00:00Z',
            ready_at: null,
            last_error: null,
          },
        },
      },
    });

    const result = await activateCommerceDomainEdge('store-1', 'd2');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.domain.edge?.status).toBe('dns_required');
    expect(result.domain.edge?.dnsInstructions.records[0]?.value).toBe('g05ns7.up.railway.app');
  });

  it('classifies a 503 as unavailable, distinct from ineligibility', async () => {
    apiMock.mockRejectedValueOnce(new FakeApiError(503, 'edge provider is not configured'));
    const result = await activateCommerceDomainEdge('store-1', 'd2');
    expect(result).toEqual({
      ok: false,
      reason: 'unavailable',
      message: 'edge provider is not configured',
    });
  });

  it('classifies a 409 as conflict', async () => {
    apiMock.mockRejectedValueOnce(new FakeApiError(409, 'already attached'));
    const result = await activateCommerceDomainEdge('store-1', 'd2');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('conflict');
  });
});

describe('refresh edge', () => {
  afterEach(() => apiMock.mockReset());

  it('sends an empty body on refresh-edge and never submits client-authoritative fields', async () => {
    apiMock.mockResolvedValueOnce({
      data: {
        domain: {
          id: 'd2',
          hostname: 'shop.example.com',
          type: 'custom',
          is_primary: false,
          is_active: true,
          verification_status: 'verified',
          edge: { status: 'tls_pending', dns_instructions: { records: [] }, checked_at: '2026-01-02T00:00:00Z' },
        },
      },
    });

    await refreshCommerceDomainEdge('store-1', 'd2');

    expect(apiMock).toHaveBeenCalledWith('/commerce/workspace/storefronts/store-1/domains/d2/refresh-edge', {
      method: 'POST',
      body: {},
    });
  });

  it('classifies a 422 as not_activated', async () => {
    apiMock.mockRejectedValueOnce(new FakeApiError(422, 'not activated'));
    const result = await refreshCommerceDomainEdge('store-1', 'd2');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('not_activated');
  });
});
