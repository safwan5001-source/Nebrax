import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api';
import { METHOD_KEYS, canToggle, changesOf, draftOf, isEnabledNotReady, isMethodKey, methodErrorKey, methodTone, nextStep, toggleBlockReason } from './contract';

const err = (code: string) => new ApiError(422, 'x', { error: { code, message: 'x' } });

describe('online payment methods contract', () => {
  it('keeps the four methods in the API order', () => {
    expect(METHOD_KEYS).toEqual(['mada', 'visa', 'mastercard', 'apple_pay']);
    expect(isMethodKey('visa')).toBe(true);
    expect(isMethodKey('stc_pay')).toBe(false);
  });

  it('maps the computed status to a badge tone', () => {
    expect(methodTone('enabled')).toBe('positive');
    expect(methodTone('enabled_not_ready')).toBe('warning');
    expect(methodTone('needs_setup')).toBe('warning');
    expect(methodTone('disabled')).toBe('muted');
    expect(methodTone('unsupported')).toBe('muted');
  });

  it('derives the required next step only for methods that cannot collect yet', () => {
    expect(nextStep({ ready: false, reason: 'no_gateway' })).toBe('add_gateway');
    expect(nextStep({ ready: false, reason: 'no_usable_gateway' })).toBe('activate_gateway');
    expect(nextStep({ ready: false, reason: 'provider_setup_required' })).toBe('provider_setup');
    expect(nextStep({ ready: true, reason: null })).toBeNull();
  });

  it('Beta: readiness never blocks the switch — only the manage permission does', () => {
    expect(canToggle(true)).toBe(true);
    expect(canToggle(false)).toBe(false);
    expect(toggleBlockReason(true)).toBeNull();
    expect(toggleBlockReason(false)).toBe('no_permission');
  });

  it('flags a method that is shown to customers but cannot collect', () => {
    expect(isEnabledNotReady({ enabled: true, ready: false })).toBe(true);
    expect(isEnabledNotReady({ enabled: true, ready: true })).toBe(false);
    expect(isEnabledNotReady({ enabled: false, ready: false })).toBe(false);
  });

  it('translates stable server codes and falls back to generic', () => {
    expect(methodErrorKey(err('method.unknown'))).toBe('unknown_method');
    expect(methodErrorKey(err('method.reason_too_long'))).toBe('reason_too_long');
    // رموز الرفض القديمة لم تعد تصدر؛ إن ظهرت فهي عامة
    expect(methodErrorKey(err('method.needs_setup'))).toBe('generic');
    expect(methodErrorKey(err('something.else'))).toBe('generic');
    expect(methodErrorKey(new Error('network'))).toBe('generic');
  });

  it('Manage drafts mirror what is stored and only changed fields are sent', () => {
    const stored = { default_gateway_id: null, usage: { invoices: true, store: true, pos: false } };
    expect(draftOf(stored)).toEqual({ default_gateway_id: null, use_in_invoices: true, use_in_store: true });
    expect(changesOf(stored, draftOf(stored))).toEqual({});
    expect(changesOf(stored, { default_gateway_id: 'g2', use_in_invoices: true, use_in_store: false })).toEqual({ default_gateway_id: 'g2', use_in_store: false });
    expect(changesOf({ ...stored, default_gateway_id: 'g2' }, { default_gateway_id: null, use_in_invoices: true, use_in_store: true })).toEqual({ default_gateway_id: null });
  });

  it('maps the default-gateway rejection', () => {
    expect(methodErrorKey(err('method.default_gateway_invalid'))).toBe('default_gateway_invalid');
  });
});
