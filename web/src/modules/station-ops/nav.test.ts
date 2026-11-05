import { describe, expect, it } from 'vitest';
import { OPS_BASE, deriveOpsMode, isNavActive, visibleOpsNav } from './nav';

const canFrom = (granted: string[]) => (permission: string) => granted.includes('*') || granted.includes(permission);
const canAllFrom = (granted: string[]) => (required: readonly string[]) => required.every(canFrom(granted));

describe('ops navigation is derived from AWJ permissions only', () => {
  it('derives the workspace mode from the effective permissions, never from a role name', () => {
    expect(deriveOpsMode(canFrom(['fuel.shift.approve', 'fuel.shift.open']))).toBe('supervisor');
    expect(deriveOpsMode(canFrom(['fuel.shift.open']))).toBe('operator');
    expect(deriveOpsMode(canFrom(['fuel_stations.view']))).toBe('viewer');
    expect(deriveOpsMode(canFrom(['*']))).toBe('supervisor');
  });

  it('hides screens whose permissions are missing; profile is always reachable', () => {
    const ids = (granted: string[]) => visibleOpsNav(canAllFrom(granted)).map((item) => item.id);
    expect(ids([])).toEqual(['profile']);
    expect(ids(['fuel_stations.view'])).toEqual(['home', 'products', 'profile']);
    expect(ids(['fuel_stations.view', 'fuel.shift.view'])).toEqual(['home', 'products', 'shifts', 'profile']);
  });

  it('marks the active item without matching sibling prefixes', () => {
    expect(isNavActive(OPS_BASE, OPS_BASE)).toBe(true);
    expect(isNavActive(`${OPS_BASE}/products`, OPS_BASE)).toBe(false);
    expect(isNavActive(`${OPS_BASE}/products`, `${OPS_BASE}/products`)).toBe(true);
    expect(isNavActive(`${OPS_BASE}/productsx`, `${OPS_BASE}/products`)).toBe(false);
    expect(isNavActive(null, OPS_BASE)).toBe(false);
  });

});
