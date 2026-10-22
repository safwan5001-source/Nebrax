import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api';
import {
  activationBlock,
  apiErrorCode,
  apiErrorMessage,
  availableActions,
  gatewayDisplayName,
  secretsPayload,
  statusTone,
  type GatewayConnection,
} from './contract';

function connection(overrides: Partial<GatewayConnection> = {}): GatewayConnection {
  return {
    id: '1', provider: 'custom', name: 'اتصال', name_en: null, environment: 'sandbox', status: 'draft', is_usable: false,
    merchant_reference: null, publishable_key: null, has_secret_key: false, has_webhook_secret: false, has_extra_credentials: false,
    credential_version: 1, previous_secret_valid_until: null, verified_at: null, activated_at: null, deactivated_at: null, created_at: null,
    ...overrides,
  };
}

describe('gateway contract', () => {
  it('maps every status to a tone', () => {
    expect(statusTone('active')).toBe('positive');
    expect(statusTone('suspended')).toBe('warning');
    expect(statusTone('revoked')).toBe('negative');
    expect(statusTone('draft')).toBe('muted');
  });

  it('gives a read-only viewer no actions at all', () => {
    for (const status of ['draft', 'active', 'suspended', 'revoked'] as const) {
      expect(availableActions(connection({ status }), false)).toEqual([]);
    }
  });

  it('offers only lifecycle actions that fit the status', () => {
    expect(availableActions(connection({ status: 'draft' }), true)).toContain('activate');
    expect(availableActions(connection({ status: 'draft' }), true)).not.toContain('suspend');
    expect(availableActions(connection({ status: 'active' }), true)).toContain('suspend');
    expect(availableActions(connection({ status: 'active' }), true)).not.toContain('delete');
    expect(availableActions(connection({ status: 'suspended' }), true)).toContain('activate');
    expect(availableActions(connection({ status: 'revoked' }), true)).toEqual(['events']);
  });

  it('blocks activation of an unverified real provider but not a custom one', () => {
    expect(activationBlock(connection({ provider: 'stripe' }))).toBe('verification_required');
    expect(activationBlock(connection({ provider: 'stripe', verified_at: '2026-01-01T00:00:00Z' }))).toBeNull();
    expect(activationBlock(connection({ provider: 'custom' }))).toBeNull();
  });

  it('drops blank secrets so an existing secret is never cleared by accident', () => {
    expect(secretsPayload({ secret_key: '  ', webhook_secret: '' })).toEqual({});
    expect(secretsPayload({ secret_key: ' sk_x ', webhook_secret: 'wh' })).toEqual({ secret_key: 'sk_x', webhook_secret: 'wh' });
  });

  it('reads the stable error code and message from the unified error body', () => {
    const err = new ApiError(422, 'fallback', { error: { code: 'gateway.has_references', message: 'مرتبط' } });
    expect(apiErrorCode(err)).toBe('gateway.has_references');
    expect(apiErrorMessage(err)).toBe('مرتبط');
    expect(apiErrorCode(new Error('x'))).toBeNull();
    expect(apiErrorCode(new ApiError(500, 'x', {}))).toBeNull();
  });

  it('prefers the English name only in the English locale', () => {
    const c = connection({ name: 'اسم', name_en: 'Name' });
    expect(gatewayDisplayName(c, 'en')).toBe('Name');
    expect(gatewayDisplayName(c, 'ar')).toBe('اسم');
    expect(gatewayDisplayName(connection({ name: 'اسم' }), 'en')).toBe('اسم');
  });
});
