import { describe, expect, it } from 'vitest';
import { hasPermission } from './permissions';

describe('hasPermission — مرآة Rbac::allows', () => {
  it('accepts the wildcard list that the server sends for owner and admin', () => {
    expect(hasPermission(['*'], 'owner', 'documents.center.view')).toBe(true);
    expect(hasPermission(['*'], 'admin', 'invoices.create')).toBe(true);
    expect(hasPermission(['*'], 'staff', 'invoices.create')).toBe(true);
  });

  it('accepts an explicitly granted permission for any role', () => {
    expect(hasPermission(['invoices.view', 'documents.center.view'], 'staff', 'documents.center.view')).toBe(true);
  });

  it('denies a permission that the resolved list does not contain', () => {
    expect(hasPermission(['invoices.view'], 'staff', 'documents.center.view')).toBe(false);
    expect(hasPermission([], 'staff', 'documents.center.view')).toBe(false);
  });

  // القائمة الفارغة إجابةٌ صريحة من الخادم لا غيابٌ لها، فلا ينقضها اسم الدور:
  // دور `admin` قابل للتحرير لكل مؤسسة، ومنحه مروراً بالاسم يجعل الواجهة أوسع
  // من `EnsurePermission`.
  it('lets the resolved list win over the role name whenever the list is present', () => {
    expect(hasPermission([], 'owner', 'documents.center.view')).toBe(false);
    expect(hasPermission([], 'admin', 'documents.center.view')).toBe(false);
  });

  it('falls back to the default administrative roles only when the list is absent', () => {
    expect(hasPermission(undefined, 'owner', 'documents.center.view')).toBe(true);
    expect(hasPermission(undefined, 'admin', 'documents.center.view')).toBe(true);
    expect(hasPermission(undefined, 'accountant', 'documents.center.view')).toBe(false);
    expect(hasPermission(undefined, undefined, 'documents.center.view')).toBe(false);
  });
});
