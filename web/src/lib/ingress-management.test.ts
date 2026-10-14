import { describe, expect, it } from 'vitest';
import {
  INGRESS_MANAGE_PERMISSION,
  INGRESS_REASSIGN_PERMISSION,
  KNOWN_INGRESS_ERROR_CODES,
  USERS_VIEW_PERMISSION,
  classifyIngressFailure,
  ingressActionAvailability,
  type IngressOperation,
} from './ingress-management';
import ar from '@/messages/ar.json';
import en from '@/messages/en.json';

const configured = { status: 'configured' as const };
const disabled = { status: 'disabled' as const };
const none = { create: false, rotate: false, disable: false, reassign: false };

describe('ingressActionAvailability (existing permissions only, absent not disabled)', () => {
  it('owner/admin wildcard sees every action on a configured point', () => {
    expect(ingressActionAvailability(['*'], 'owner', configured)).toEqual({ create: true, rotate: true, disable: true, reassign: true });
  });

  it('uses the server permission list, not the role name', () => {
    expect(ingressActionAvailability(['invoices.view'], 'admin', configured)).toEqual(none);
    expect(ingressActionAvailability([], 'owner', configured)).toEqual(none);
  });

  it('falls back to the role only when the list is absent (legacy storage)', () => {
    expect(ingressActionAvailability(undefined, 'owner', configured).create).toBe(true);
    expect(ingressActionAvailability(undefined, 'accountant', configured)).toEqual(none);
  });

  it('accountant, staff and self_service defaults get nothing', () => {
    for (const role of ['accountant', 'staff', 'self_service']) {
      expect(ingressActionAvailability(['invoices.view', 'reports.view', 'branches.view'], role, configured)).toEqual(none);
    }
  });

  it('manage covers create/rotate/disable but never reassign', () => {
    expect(ingressActionAvailability([INGRESS_MANAGE_PERMISSION], 'custom', configured)).toEqual({ create: true, rotate: true, disable: true, reassign: false });
  });

  it('reassign needs BOTH delivery_connector.reassign and users.view (D3)', () => {
    expect(ingressActionAvailability([INGRESS_REASSIGN_PERMISSION], 'custom', configured).reassign).toBe(false);
    expect(ingressActionAvailability([USERS_VIEW_PERMISSION], 'custom', configured).reassign).toBe(false);
    expect(ingressActionAvailability([INGRESS_REASSIGN_PERMISSION, USERS_VIEW_PERMISSION], 'custom', configured)).toEqual({ ...none, reassign: true });
  });

  it('rotate and disable are absent for a disabled point (D5); create does not depend on a point', () => {
    expect(ingressActionAvailability(['*'], 'owner', disabled)).toEqual({ create: true, rotate: false, disable: false, reassign: true });
    expect(ingressActionAvailability(['*'], 'owner', null)).toEqual({ create: true, rotate: false, disable: false, reassign: false });
  });
});

describe('classifyIngressFailure (safe dictionary, no server text, no blind retry)', () => {
  const http = (status: number, body: unknown = {}) => Object.assign(new Error('SERVER TEXT MUST NEVER BE SHOWN'), { status, body });

  it('maps every known error_code to its own message and a definite (known) outcome', () => {
    const expected: Record<string, string> = {
      mapping_ambiguous: 'mappingAmbiguous', profile_unavailable: 'profileUnavailable', branch_unavailable: 'branchUnavailable',
      branch_inactive: 'branchInactive', branch_required: 'branchRequired', invalid_store: 'invalidStore',
      operator_ineligible: 'operatorIneligible', connector_unavailable: 'connectorUnavailable', tenant_required: 'tenantRequired',
    };
    expect(Object.keys(expected).sort()).toEqual([...KNOWN_INGRESS_ERROR_CODES].sort());
    for (const code of KNOWN_INGRESS_ERROR_CODES) {
      const failure = classifyIngressFailure(http(422, { error_code: code, message: 'raw' }), 'create');
      expect(failure).toEqual({ messageKey: expected[code], code, outcomeUnknown: false, retryable: false });
    }
  });

  it('a lost response on create or rotate is "outcome unknown" and is NEVER retryable', () => {
    for (const operation of ['create', 'rotate'] as IngressOperation[]) {
      for (const error of [new TypeError('Failed to fetch'), http(500), http(502), http(503, { message: 'x' }), Object.assign(new Error('timeout'), {})]) {
        expect(classifyIngressFailure(error, operation)).toEqual({ messageKey: 'outcomeUnknown', code: null, outcomeUnknown: true, retryable: false });
      }
    }
  });

  it('disable and reassign are idempotent: a lost response may be retried', () => {
    for (const operation of ['disable', 'reassign'] as IngressOperation[]) {
      expect(classifyIngressFailure(new TypeError('Failed to fetch'), operation)).toEqual({ messageKey: 'serverError', code: null, outcomeUnknown: true, retryable: true });
      expect(classifyIngressFailure(http(500), operation).retryable).toBe(true);
    }
  });

  it('plain 4xx without a known code map by status and are definite', () => {
    expect(classifyIngressFailure(http(403), 'rotate').messageKey).toBe('forbidden');
    expect(classifyIngressFailure(http(404), 'disable').messageKey).toBe('notFound');
    expect(classifyIngressFailure(http(409), 'create').messageKey).toBe('conflict');
    expect(classifyIngressFailure(http(422), 'reassign').messageKey).toBe('validation');
    expect(classifyIngressFailure(http(418), 'create').messageKey).toBe('unknown');
    for (const status of [403, 404, 409, 422]) expect(classifyIngressFailure(http(status), 'create')).toMatchObject({ outcomeUnknown: false, retryable: false });
  });

  it('an unknown error_code string never becomes a message of its own', () => {
    expect(classifyIngressFailure(http(422, { error_code: '<script>alert(1)</script>' }), 'create')).toEqual({ messageKey: 'validation', code: null, outcomeUnknown: false, retryable: false });
    expect(classifyIngressFailure(http(404, { error_code: 42 }), 'create').messageKey).toBe('notFound');
  });

  it('never carries server or exception text in its result', () => {
    const failure = classifyIngressFailure(http(500, { message: 'SERVER TEXT MUST NEVER BE SHOWN', secret: 'dsec_LEAK' }), 'create');
    expect(JSON.stringify(failure)).not.toMatch(/SERVER TEXT|dsec_LEAK/);
  });
});

describe('the error dictionary is complete in both locales and says no forbidden thing', () => {
  const keys = [
    'mappingAmbiguous', 'profileUnavailable', 'branchUnavailable', 'branchInactive', 'branchRequired', 'invalidStore', 'operatorIneligible',
    'connectorUnavailable', 'tenantRequired', 'forbidden', 'notFound', 'validation', 'conflict', 'outcomeUnknown', 'serverError', 'disableOutcomeUnknown', 'createBlocked', 'demoUnavailable', 'unknown',
  ];

  it.each([['ar', ar], ['en', en]] as const)('%s has every key, non-empty', (_locale, messages) => {
    const errors = (messages as unknown as { integrationCenter: { ingressManagement: { errors: Record<string, string> } } }).integrationCenter.ingressManagement.errors;
    expect(Object.keys(errors).sort()).toEqual([...keys].sort());
    for (const key of keys) expect(errors[key].trim().length, key).toBeGreaterThan(0);
  });

  it('never implies a native connection or synchronization', () => {
    const phrases = ['متصل بالمنصة', 'حساب التاجر مرتبط', 'المزامنة مفعّلة', 'جاهز للتكامل الأصلي', 'connected to the platform', 'merchant account is linked', 'sync is enabled', 'ready for native integration'];
    for (const messages of [ar, en]) {
      const text = JSON.stringify((messages as unknown as { integrationCenter: { ingressManagement: unknown } }).integrationCenter.ingressManagement);
      for (const phrase of phrases) expect(text, phrase).not.toContain(phrase);
    }
  });

  it('the unknown-outcome message tells the user to refresh and rotate, and not to repeat the request', () => {
    const en_ = (en as unknown as { integrationCenter: { ingressManagement: { errors: Record<string, string> } } }).integrationCenter.ingressManagement.errors.outcomeUnknown;
    expect(en_).toMatch(/Refresh/);
    expect(en_).toMatch(/rotate/i);
    expect(en_).toMatch(/not repeat/i);
  });
});
