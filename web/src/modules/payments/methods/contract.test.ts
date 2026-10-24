import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api';
import { METHOD_KEYS, canToggle, isMethodKey, methodErrorKey, methodTone, nextStep, toggleBlockReason } from './contract';

const err = (code: string) => new ApiError(422, 'x', { error: { code, message: 'x' } });

describe('online payment methods contract', () => {
  it('keeps the four methods in the API order', () => {
    expect(METHOD_KEYS).toEqual(['mada', 'visa', 'mastercard', 'apple_pay']);
    expect(isMethodKey('visa')).toBe(true);
    expect(isMethodKey('stc_pay')).toBe(false);
  });

  it('maps the computed status to a badge tone', () => {
    expect(methodTone('enabled')).toBe('positive');
    expect(methodTone('needs_setup')).toBe('warning');
    expect(methodTone('disabled')).toBe('muted');
    expect(methodTone('unsupported')).toBe('muted');
  });

  it('derives the required next step only for the not-ready statuses', () => {
    expect(nextStep({ status: 'unsupported', reason: null })).toBe('add_gateway');
    expect(nextStep({ status: 'needs_setup', reason: 'no_usable_gateway' })).toBe('activate_gateway');
    expect(nextStep({ status: 'needs_setup', reason: 'provider_setup_required' })).toBe('provider_setup');
    expect(nextStep({ status: 'enabled', reason: null })).toBeNull();
    expect(nextStep({ status: 'disabled', reason: null })).toBeNull();
  });

  it('allows toggling only a ready method for a manager', () => {
    expect(canToggle({ status: 'disabled' }, true)).toBe(true);
    expect(canToggle({ status: 'enabled' }, true)).toBe(true);
    expect(canToggle({ status: 'disabled' }, false)).toBe(false);
    expect(canToggle({ status: 'needs_setup' }, true)).toBe(false);
    expect(canToggle({ status: 'unsupported' }, true)).toBe(false);
    // محفوظة «مفعّلة» وغير جاهزة ⇒ تُطفأ فقط
    expect(canToggle({ status: 'needs_setup', enabled: true }, true)).toBe(true);
    expect(canToggle({ status: 'unsupported', enabled: true }, false)).toBe(false);
  });

  it('explains why a toggle is blocked', () => {
    expect(toggleBlockReason({ status: 'unsupported' }, true)).toBe('unsupported');
    expect(toggleBlockReason({ status: 'needs_setup' }, true)).toBe('needs_setup');
    expect(toggleBlockReason({ status: 'disabled' }, false)).toBe('no_permission');
    expect(toggleBlockReason({ status: 'disabled' }, true)).toBeNull();
  });

  it('translates stable server codes and falls back to generic', () => {
    expect(methodErrorKey(err('method.unsupported'))).toBe('unsupported');
    expect(methodErrorKey(err('method.needs_setup'))).toBe('needs_setup');
    expect(methodErrorKey(err('method.unknown'))).toBe('unknown_method');
    expect(methodErrorKey(err('method.reason_too_long'))).toBe('reason_too_long');
    expect(methodErrorKey(err('something.else'))).toBe('generic');
    expect(methodErrorKey(new Error('network'))).toBe('generic');
  });
});
