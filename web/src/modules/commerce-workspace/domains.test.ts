import { afterEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: (...args: unknown[]) => apiMock(...args) }));

import {
  commerceStoreDomainsPath,
  fetchCommerceStorefrontDomains,
  mapCommerceStoreDomainCatalog,
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
    });
    expect(catalog.domains[1].type).toBe('custom');
    expect(catalog.domains[1].verificationStatus).toBe('pending');
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
});
