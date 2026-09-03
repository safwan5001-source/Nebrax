import { afterEach, describe, expect, it, vi } from 'vitest';

// نعترض عميل الشبكة كي نتحقّق من **شكل الطلب** دون خادم حقيقي.
const apiMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: (...args: unknown[]) => apiMock(...args) }));

import {
  API_SCOPES, WEBHOOK_EVENTS, parseScope,
  listDeliveries, revokeApiKey, createApiClient, rotateWebhookSecret,
} from '@/lib/developer';
import { OPENAPI_MODEL } from '@/modules/developer/docs/openapi-model.generated';

afterEach(() => apiMock.mockReset());

describe('developer catalogs (single source = the contract)', () => {
  it('scopes mirror the contract exactly (eight, no wildcard)', () => {
    expect(API_SCOPES).toEqual(OPENAPI_MODEL.scopes);
    expect(API_SCOPES).toHaveLength(8);
    expect(API_SCOPES).not.toContain('*');
  });

  it('webhook events mirror the contract catalog (three)', () => {
    expect(WEBHOOK_EVENTS).toEqual(OPENAPI_MODEL.events);
    expect(WEBHOOK_EVENTS).toEqual(['partner.created', 'product.created', 'invoice.created']);
  });

  it('parseScope splits resource:action', () => {
    expect(parseScope('partners:read')).toEqual({ resource: 'partners', action: 'read' });
    expect(parseScope('webhooks:write')).toEqual({ resource: 'webhooks', action: 'write' });
  });
});

describe('developer request shaping', () => {
  it('lists deliveries under /developer with only the provided filters', async () => {
    apiMock.mockResolvedValue({ data: [], meta: {} });
    await listDeliveries({ status: 'failed', page: 2, per_page: 50, event_type: '' as never });
    const [path] = apiMock.mock.calls[0];
    expect(path).toContain('/developer/webhook-deliveries?');
    expect(path).toContain('status=failed');
    expect(path).toContain('page=2');
    expect(path).toContain('per_page=50');
    expect(path).not.toContain('event_type='); // القيم الفارغة تُحذف
  });

  it('revokes a key by client + token id with DELETE', async () => {
    apiMock.mockResolvedValue({ message: 'ok' });
    await revokeApiKey('client-uuid', 42);
    expect(apiMock).toHaveBeenCalledWith('/developer/api-clients/client-uuid/keys/42', { method: 'DELETE' });
  });

  it('creates a client via POST to the internal surface (not the Public API)', async () => {
    apiMock.mockResolvedValue({ secret: 's', key: {}, client: {} });
    await createApiClient({ name: 'CI', scopes: ['partners:read'] });
    const [path, options] = apiMock.mock.calls[0];
    expect(path).toBe('/developer/api-clients');
    expect((options as { method: string }).method).toBe('POST');
    expect(path).not.toContain('/api/v1');
  });

  it('rotates a webhook secret via its dedicated route', async () => {
    apiMock.mockResolvedValue({ secret: 'whsec_x', webhook: {} });
    await rotateWebhookSecret('endpoint-uuid');
    expect(apiMock).toHaveBeenCalledWith('/developer/webhooks/endpoint-uuid/rotate-secret', { method: 'POST' });
  });
});
