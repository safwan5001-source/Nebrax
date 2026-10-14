import { describe, expect, it } from 'vitest';
import {
  canGrantKey,
  cloneSeed,
  diffSelection,
  groupState,
  initialSelection,
  isDirty,
  roleIssue,
  rolePayload,
  selectedInCatalogOrder,
  setKeys,
  toggleKey,
} from './editor';

const CATALOG = ['products.view', 'products.manage', 'pos.audit.view', 'pos.audit.review', 'pos.audit.export', 'zatca.view', 'zatca.submit'];

describe('initialSelection', () => {
  it('is empty for a new role, explicit for a custom role, and the whole catalogue for the wildcard', () => {
    expect(initialSelection(null, CATALOG).size).toBe(0);
    expect([...initialSelection({ permissions: ['products.view', 'retired.key'] }, CATALOG)]).toEqual(['products.view']);
    expect(initialSelection({ permissions: ['*'] }, CATALOG).size).toBe(CATALOG.length);
  });
});

describe('toggle and group selection', () => {
  it('toggling one key never touches siblings that share a prefix', () => {
    const next = toggleKey(new Set(), 'pos.audit.view');
    expect([...next]).toEqual(['pos.audit.view']);
    expect(toggleKey(next, 'pos.audit.view').size).toBe(0);
  });

  it('reports none / some / all for a group', () => {
    const keys = ['pos.audit.view', 'pos.audit.review', 'pos.audit.export'];
    expect(groupState(new Set(), keys)).toBe('none');
    expect(groupState(new Set(['pos.audit.view']), keys)).toBe('some');
    expect(groupState(new Set(keys), keys)).toBe('all');
    expect(groupState(new Set(keys), [])).toBe('none');
  });

  it('selects or clears a whole group but only the keys the actor may grant', () => {
    const keys = ['products.view', 'products.manage'];
    const only = (key: string) => key === 'products.view';
    expect([...setKeys(new Set(), keys, true, only)]).toEqual(['products.view']);
    expect(setKeys(new Set(keys), keys, false).size).toBe(0);
    // إلغاء مجموعة لا يمسّ ما خارجها
    expect([...setKeys(new Set([...keys, 'zatca.view']), keys, false)]).toEqual(['zatca.view']);
  });
});

describe('payload (canonical key integrity)', () => {
  it('sends catalogue keys verbatim in catalogue order, trimming only the name', () => {
    const selected = new Set(['zatca.submit', 'pos.audit.export', 'products.view']);
    expect(rolePayload('  Auditor ', selected, CATALOG)).toEqual({
      name: 'Auditor',
      permissions: ['products.view', 'pos.audit.export', 'zatca.submit'],
    });
  });

  it('can never emit a key that is not in the catalogue', () => {
    const selected = new Set(['products.view', 'pos.audit']); // «pos.audit» مقتطَع قديماً
    expect(selectedInCatalogOrder(selected, CATALOG)).toEqual(['products.view']);
  });

  it('does not pick zatca.submit implicitly when zatca.view is selected (REM-37)', () => {
    expect(selectedInCatalogOrder(new Set(['zatca.view']), CATALOG)).toEqual(['zatca.view']);
  });
});

describe('dirty state and validation', () => {
  const initial = new Set(['products.view']);

  it('is clean when nothing changed (name whitespace aside) and dirty on any change', () => {
    expect(isDirty('Auditor', initial, ' Auditor ', new Set(['products.view']))).toBe(false);
    expect(isDirty('Auditor', initial, 'Auditor 2', initial)).toBe(true);
    expect(isDirty('Auditor', initial, 'Auditor', new Set(['products.view', 'products.manage']))).toBe(true);
  });

  it('requires a name and at least one permission', () => {
    expect(roleIssue('  ', new Set(['a.b']))).toBe('name_required');
    expect(roleIssue('Role', new Set())).toBe('permissions_required');
    expect(roleIssue('Role', new Set(['a.b']))).toBeNull();
  });
});

describe('diffSelection', () => {
  it('lists added and removed keys in catalogue order', () => {
    const diff = diffSelection(new Set(['products.view', 'zatca.view']), new Set(['products.view', 'pos.audit.export', 'products.manage']), CATALOG);
    expect(diff.added).toEqual(['products.manage', 'pos.audit.export']);
    expect(diff.removed).toEqual(['zatca.view']);
  });
});

describe('canGrantKey (display mirror of the grant ceiling)', () => {
  it('wildcard grants all; others only what they hold', () => {
    expect(canGrantKey(['*'], 'users.manage')).toBe(true);
    expect(canGrantKey(['invoices.view'], 'invoices.view')).toBe(true);
    expect(canGrantKey(['invoices.view'], 'invoices.manage')).toBe(false);
    expect(canGrantKey([], 'invoices.view')).toBe(false);
  });
});

describe('cloneSeed (safe client-side clone)', () => {
  const source = { permissions: ['products.view', 'pos.audit.export'] };

  it('copies only catalogue keys, in catalogue order, and never mutates or aliases the source', () => {
    const before = JSON.stringify(source);
    const seed = cloneSeed(source, CATALOG, ['*'], 'Auditor (copy)');
    expect(seed).toEqual({ name: 'Auditor (copy)', permissions: ['products.view', 'pos.audit.export'], skipped: 0 });
    expect(seed.permissions).not.toBe(source.permissions);
    seed.permissions.push('zatca.submit');
    expect(JSON.stringify(source)).toBe(before);
  });

  it('expands the wildcard to explicit keys (custom roles cannot hold *)', () => {
    const seed = cloneSeed({ permissions: ['*'] }, CATALOG, ['*'], 'Admin (copy)');
    expect(seed.permissions).toEqual(CATALOG);
    expect(seed.permissions).not.toContain('*');
  });

  it('leaves out what the actor cannot grant and counts it', () => {
    const seed = cloneSeed(source, CATALOG, ['products.view'], 'X');
    expect(seed.permissions).toEqual(['products.view']);
    expect(seed.skipped).toBe(1);
  });

  it('ignores keys the catalogue no longer has', () => {
    const seed = cloneSeed({ permissions: ['products.view', 'retired.key'] }, CATALOG, ['*'], 'X');
    expect(seed.permissions).toEqual(['products.view']);
    expect(seed.skipped).toBe(0);
  });
});
