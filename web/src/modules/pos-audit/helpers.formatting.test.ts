import { describe, expect, it } from 'vitest';
import { formatDateTime as central } from '@/lib/formatting';
import { formatDateTime as auditHelper } from '@/modules/pos-audit/helpers';

describe('pos-audit date formatting regression', () => {
  it('reuses the central Gregorian Latin formatter', () => {
    const value = '2026-08-29T13:00:00';
    expect(auditHelper(value, 'ar')).toBe(central(value, 'ar'));
    expect(auditHelper(value, 'ar')).toContain('مساءً');
    expect(auditHelper(value, 'ar')).not.toMatch(/[٠-٩]/);
    expect(auditHelper(value, 'en')).toMatch(/\bPM\b/);
  });
});
