import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PERMISSION_RISK, RISK_KINDS, riskCounts, riskOf, sensitiveKeys } from './risk';

describe('risk map (display only)', () => {
  it('classifies the highest-impact grants and leaves unknown keys neutral', () => {
    expect(riskOf('users.manage')).toBe('access');
    expect(riskOf('roles.manage')).toBe('access');
    expect(riskOf('zatca.submit')).toBe('compliance');
    expect(riskOf('payments.manage')).toBe('financial');
    expect(riskOf('pos.audit.export')).toBe('data');
    expect(riskOf('invoices.view')).toBeNull();
    expect(riskOf('future.unknown.key')).toBeNull();
    expect(riskOf('constructor')).toBeNull(); // لا يتسرّب من سلسلة النموذج
  });

  it('counts and filters sensitive keys', () => {
    const keys = ['invoices.view', 'users.manage', 'payments.manage', 'pos.audit.export'];
    expect(sensitiveKeys(keys)).toEqual(['users.manage', 'payments.manage', 'pos.audit.export']);
    expect(riskCounts(keys)).toEqual({ access: 1, financial: 1, compliance: 0, data: 1 });
  });

  it('only uses declared risk kinds', () => {
    for (const kind of Object.values(PERMISSION_RISK)) expect(RISK_KINDS).toContain(kind);
  });
});

/** حارس الانجراف: لا مفتاح في الخريطة يغيب عن `Rbac::PERMISSIONS` (إعادة تسمية/حذف في الخادم تُفشل الاختبار). */
describe('risk map drift guard (Rbac::PERMISSIONS)', () => {
  const source = readFileSync(fileURLToPath(new URL('../../../../app/Support/Rbac.php', import.meta.url)), 'utf8');
  const block = /const PERMISSIONS = \[(.*?)\];/s.exec(source);
  const server = new Set(block ? [...block[1].matchAll(/'([a-z_.]+)'/g)].map((m) => m[1]) : []);

  it('reads the server catalogue', () => {
    expect(server.size).toBeGreaterThan(100);
  });

  it('has no key the server no longer defines', () => {
    expect(Object.keys(PERMISSION_RISK).filter((key) => !server.has(key))).toEqual([]);
  });

  it('keeps the access-control grants classified (users.manage, roles.manage)', () => {
    expect(server.has('users.manage') && server.has('roles.manage')).toBe(true);
    expect(PERMISSION_RISK['users.manage']).toBe('access');
    expect(PERMISSION_RISK['roles.manage']).toBe('access');
  });
});
