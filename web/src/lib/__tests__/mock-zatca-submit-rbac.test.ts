import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mockApi, mockPermissionCatalogue, mockRoles } from '@/lib/mock-data';

/**
 * REM-37 / SEC-07 — الوضع التجريبي يجب أن يعكس نموذج الصلاحيات الكنسي في الخادم:
 * `zatca.submit` صلاحية قابلة للإسناد، مستقلة عن `zatca.view` وعن `invoices.manage`،
 * والمحاسب المدمج وحده (مع owner/admin عبر `*`) يملكها افتراضياً.
 *
 * المرجع هو ملف الخادم نفسه (`app/Support/Rbac.php`) — يُقرأ كنص ولا يُنسخ هنا،
 * فأي انجراف بين الكتالوج التجريبي والخادم في مجموعة ZATCA يُفشل الاختبار.
 */
const rbacSource = readFileSync(resolve(__dirname, '../../../../app/Support/Rbac.php'), 'utf8');

function zatcaKeysIn(block: string): string[] {
  return [...new Set([...block.matchAll(/'(zatca\.[a-z_]+)'/g)].map((m) => m[1]))].sort();
}

function constBlock(name: string): string {
  const start = rbacSource.indexOf(`const ${name} = [`);
  expect(start, `${name} not found in Rbac.php`).toBeGreaterThan(-1);
  return rbacSource.slice(start, rbacSource.indexOf('\n    ];', start));
}

function matrixRole(slug: string): string {
  const matrix = constBlock('MATRIX');
  const start = matrix.indexOf(`'${slug}' => [`);
  expect(start, `${slug} not found in MATRIX`).toBeGreaterThan(-1);
  return matrix.slice(start, matrix.indexOf('],', start));
}

const role = (slug: string) => mockRoles.find((r) => r.slug === slug)!;

describe('demo role matrix — zatca.submit parity with the backend (REM-37)', () => {
  it('exposes exactly the backend ZATCA permission set in the assignable catalogue', () => {
    expect(mockPermissionCatalogue.filter((p) => p.startsWith('zatca.')).sort()).toEqual(
      zatcaKeysIn(constBlock('PERMISSIONS')),
    );
    expect(mockPermissionCatalogue).toContain('zatca.submit');
  });

  it('the demo accountant mirrors the backend accountant for the ZATCA group (view + submit)', () => {
    const backend = zatcaKeysIn(matrixRole('accountant'));
    expect(backend).toEqual(['zatca.submit', 'zatca.view']);
    expect(role('accountant').permissions.filter((p) => p.startsWith('zatca.')).sort()).toEqual(backend);
  });

  it('no other demo role gains submission access: staff and custom roles stay without it, even with invoices.manage', () => {
    expect(zatcaKeysIn(matrixRole('staff'))).not.toContain('zatca.submit');
    for (const slug of ['staff', 'role-cashier']) {
      expect(role(slug).permissions).not.toContain('zatca.submit');
    }
    // invoices.manage وحدها لم تعد مساراً — الكاشير التجريبي يملكها ولا يملك الإرسال.
    expect(role('role-cashier').permissions).toContain('invoices.manage');
  });

  it('owner and admin keep full access through the wildcard only (no explicit ZATCA entries)', () => {
    expect(role('owner').permissions).toEqual(['*']);
    expect(role('admin').permissions).toEqual(['*']);
  });

  it('every permission a demo role holds exists in the assignable catalogue (or is the wildcard)', () => {
    for (const r of mockRoles) {
      for (const p of r.permissions) {
        expect(p === '*' || mockPermissionCatalogue.includes(p), `${r.slug}:${p}`).toBe(true);
      }
    }
  });

  it('GET /roles serves the new permission and the accountant role to the Role Matrix', async () => {
    const res = await mockApi<{
      data: Array<{ slug: string; permissions: string[] }>;
      meta: { permissions: string[] };
    }>('/roles');
    expect(res.meta.permissions).toContain('zatca.submit');
    expect(res.data.find((r) => r.slug === 'accountant')?.permissions).toContain('zatca.submit');
    expect(res.data.find((r) => r.slug === 'staff')?.permissions).not.toContain('zatca.submit');
  });
});
