import { describe, expect, it } from 'vitest';
import { createCapabilities } from './capabilities';

describe('createCapabilities', () => {
  it('denies everything without a viewer (not hydrated / no session)', () => {
    const caps = createCapabilities(null);
    expect(caps.viewer).toBeNull();
    expect(caps.can('invoices.view')).toBe(false);
    expect(caps.canAny(['a.view', 'b.view'])).toBe(false);
  });

  it('follows the computed list: wildcard grants all, exact keys grant only themselves', () => {
    expect(createCapabilities({ permissions: ['*'], role: 'staff' }).can('anything.manage')).toBe(true);
    const caps = createCapabilities({ permissions: ['invoices.view', 'treasury.cash.view'], role: 'owner' });
    expect(caps.can('invoices.view')).toBe(true);
    expect(caps.can('treasury.cash.view')).toBe(true); // مفتاح كنسي متعدد المقاطع يُقارَن كما هو
    expect(caps.can('invoices.manage')).toBe(false);
    // الدور لا يمنح شيئاً حين تحضر القائمة — حتى owner.
    expect(caps.can('users.manage')).toBe(false);
  });

  it('an empty list is an explicit "no permission", not a missing list', () => {
    expect(createCapabilities({ permissions: [], role: 'owner' }).can('invoices.view')).toBe(false);
  });

  it('falls back to the owner/admin wildcard only when the list is absent (legacy storage)', () => {
    expect(createCapabilities({ role: 'owner' }).can('x.manage')).toBe(true);
    expect(createCapabilities({ role: 'admin' }).can('x.manage')).toBe(true);
    expect(createCapabilities({ role: 'staff' }).can('x.view')).toBe(false);
    expect(createCapabilities({ role: null }).can('x.view')).toBe(false);
  });

  it('canAny / canAll', () => {
    const caps = createCapabilities({ permissions: ['a.view', 'b.view'] });
    expect(caps.canAny(['a.view', 'c.view'])).toBe(true);
    expect(caps.canAny(['c.view'])).toBe(false);
    expect(caps.canAny([])).toBe(false);
    expect(caps.canAll(['a.view', 'b.view'])).toBe(true);
    expect(caps.canAll(['a.view', 'c.view'])).toBe(false);
    expect(caps.canAll([])).toBe(true);
  });
});
