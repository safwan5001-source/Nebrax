import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api';
import { classifyLoginFailure, sanitizeEmployeeNo, sanitizePin, toLatinDigits, validateLogin } from './login-logic';

describe('station login logic', () => {
  it('converts Arabic-Indic and Persian digits to Latin 0-9', () => {
    expect(toLatinDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
    expect(toLatinDigits('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789');
    expect(toLatinDigits('EMP-٠٠٠٤٢')).toBe('EMP-00042');
  });

  it('sanitizes the PIN to at most six Latin digits', () => {
    expect(sanitizePin('٤٨٢ ٩١٥')).toBe('482915');
    expect(sanitizePin('482-915')).toBe('482915');
    expect(sanitizePin('4829151234')).toBe('482915');
    expect(sanitizePin('abc')).toBe('');
  });

  it('trims the employee number and strips control and bidi characters', () => {
    expect(sanitizeEmployeeNo('  EMP-00042 ')).toBe('EMP-00042');
    expect(sanitizeEmployeeNo('‏EMP-١٠‎')).toBe('EMP-10');
    expect(sanitizeEmployeeNo('x'.repeat(200))).toHaveLength(64);
  });

  it('validates both fields before anything is sent', () => {
    expect(validateLogin('', '').errors).toEqual({ employeeNo: 'employee_required', pin: 'pin_required' });
    expect(validateLogin('EMP-1', '123').errors).toEqual({ pin: 'pin_length' });
    expect(validateLogin(' EMP-1 ', '٤٨٢٩١٥')).toMatchObject({ ok: true, employeeNo: 'EMP-1', pin: '482915' });
  });

  it('maps server answers without distinguishing why credentials were refused', () => {
    expect(classifyLoginFailure(new ApiError(422, 'x', { reason: 'invalid_credentials' }))).toBe('invalid');
    expect(classifyLoginFailure(new ApiError(422, 'x', { reason: 'tenant_required' }))).toBe('tenant_required');
    expect(classifyLoginFailure(new ApiError(429, 'x', {}))).toBe('throttled');
    expect(classifyLoginFailure(new ApiError(403, 'x', { reason: 'subscription_inactive' }))).toBe('subscription');
    expect(classifyLoginFailure(new ApiError(404, 'x', {}))).toBe('unknown_tenant');
    expect(classifyLoginFailure(new ApiError(500, 'x', {}))).toBe('server');
    expect(classifyLoginFailure(new TypeError('Failed to fetch'))).toBe('offline');
  });
});
