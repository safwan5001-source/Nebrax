import { describe, expect, it } from 'vitest';
import { hiddenApplicationKeys, isNavEntryVisible } from './nav-visibility';

const documentCenter = { appKey: 'document_center.core', permission: 'documents.center.view' };
const owner = { permissions: ['*'], role: 'owner' };
const reviewer = { permissions: ['documents.center.view'], role: 'staff' };
const salesClerk = { permissions: ['invoices.view'], role: 'staff' };

describe('hiddenApplicationKeys', () => {
  it('keeps only the capabilities the server marked invisible', () => {
    const hidden = hiddenApplicationKeys({
      'document_center.core': false,
      'inventory.core': true,
      'fuel_stations.core': false,
    });

    expect([...hidden].sort()).toEqual(['document_center.core', 'fuel_stations.core']);
  });

  it('hides nothing when the server reports every capability visible', () => {
    expect(hiddenApplicationKeys({ 'document_center.core': true }).size).toBe(0);
  });
});

describe('Document Center sidebar entry', () => {
  const allVisible = new Set<string>();

  it('shows for an owner and for a reviewer holding the explicit permission', () => {
    expect(isNavEntryVisible(documentCenter, allVisible, owner)).toBe(true);
    expect(isNavEntryVisible(documentCenter, allVisible, reviewer)).toBe(true);
  });

  it('hides from a user without the permission even while the capability is active', () => {
    expect(isNavEntryVisible(documentCenter, allVisible, salesClerk)).toBe(false);
    expect(isNavEntryVisible(documentCenter, allVisible, { permissions: [], role: 'staff' })).toBe(false);
  });

  // `visible: false` من الخادم يغطي الحالتين معاً: أوقف المستأجر القدرة، أو لا
  // استحقاق تجاري نافذ لها ولا منحة منصة. الواجهة لا تميّز بينهما ولا تحسبهما.
  it('hides for everyone, owner included, when the server reports the capability invisible', () => {
    const hidden = new Set(['document_center.core']);

    expect(isNavEntryVisible(documentCenter, hidden, owner)).toBe(false);
    expect(isNavEntryVisible(documentCenter, hidden, reviewer)).toBe(false);
  });
});

describe('Generic nav entries', () => {
  it('shows an entry that declares neither a capability key nor a permission', () => {
    expect(isNavEntryVisible({}, new Set(['document_center.core']), salesClerk)).toBe(true);
    expect(isNavEntryVisible({}, new Set(), null)).toBe(true);
  });

  it('hides a whole group whose capability key is invisible', () => {
    expect(isNavEntryVisible({ appKey: 'fuel_stations.core' }, new Set(['fuel_stations.core']), owner)).toBe(false);
    expect(isNavEntryVisible({ appKey: 'fuel_stations.core' }, new Set(), owner)).toBe(true);
  });

  it('falls back to the administrative roles when no permission list is stored', () => {
    expect(isNavEntryVisible(documentCenter, new Set(), { role: 'owner' })).toBe(true);
    expect(isNavEntryVisible(documentCenter, new Set(), { role: 'staff' })).toBe(false);
  });
});
