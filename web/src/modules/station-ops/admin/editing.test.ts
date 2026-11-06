import { describe, expect, it } from 'vitest';
import {
  EMPTY_INTENT, addBlockReason, applyTemplatePermissions, buildUpdateBody, contextOf, effectivePermissions, effectiveStations, groupOf, groupPermissions, isDirty,
  matchTemplate, rebaseIntent, selectAllDelegable, togglePermission, toggleStation,
} from './editing';
import { CATALOG, MANAGER, SELLER, SUPERVISOR, UID, staff, templates } from './__fixtures__';

const tpl = templates();
const ctx = contextOf(tpl);
const seller = staff(UID(1), 'Emp One', { station_ids: [UID(100)], revision: 'r1' });

describe('editing intent is a delta over the server snapshot', () => {
  it('starts clean and never mutates the snapshot', () => {
    expect(isDirty(EMPTY_INTENT)).toBe(false);
    const frozen = JSON.stringify(seller);
    togglePermission(seller, EMPTY_INTENT, 'fuel.reading.view', ctx);
    selectAllDelegable(seller, EMPTY_INTENT, ctx);
    toggleStation(seller, EMPTY_INTENT, UID(101));
    expect(JSON.stringify(seller)).toBe(frozen);
  });

  it('toggling an addable permission records an add; toggling it back returns to clean', () => {
    const on = togglePermission(seller, EMPTY_INTENT, 'fuel.reading.view', ctx);
    expect([...on.permAdd]).toEqual(['fuel.reading.view']);
    expect(effectivePermissions(seller, on)).toContain('fuel.reading.view');
    const off = togglePermission(seller, on, 'fuel.reading.view', ctx);
    expect(isDirty(off)).toBe(false);
  });

  it('removing a held permission records a remove and toggling back restores it', () => {
    const off = togglePermission(seller, EMPTY_INTENT, 'fuel.shift.open', ctx);
    expect([...off.permRemove]).toEqual(['fuel.shift.open']);
    expect(effectivePermissions(seller, off)).not.toContain('fuel.shift.open');
    expect(isDirty(togglePermission(seller, off, 'fuel.shift.open', ctx))).toBe(false);
  });

  it('refuses to add reserved or non-delegable permissions (the server would refuse them too)', () => {
    for (const key of ['fuel.governance.manage', 'fuel.staff.manage', 'fuel_stations.manage']) {
      expect(togglePermission(seller, EMPTY_INTENT, key, ctx)).toBe(EMPTY_INTENT);
    }
    expect(addBlockReason('fuel.governance.manage', ctx)).toBe('reserved');
    expect(addBlockReason('fuel_stations.manage', ctx)).toBe('not_delegable');
    expect(addBlockReason('fuel.reading.view', ctx)).toBeNull();
  });

  it('a top-level actor may add a reserved key only because the server lists it as delegable', () => {
    const top = contextOf(templates({ delegable: CATALOG }));
    expect(addBlockReason('fuel.governance.manage', top)).toBeNull();
    expect(selectAllDelegable(seller, EMPTY_INTENT, top).permAdd.has('fuel.governance.manage')).toBe(false); // «الكل» لا يشمل المحجوز أبداً
  });

  it('select-all adds every delegable non-reserved key and nothing else', () => {
    const all = selectAllDelegable(seller, EMPTY_INTENT, ctx);
    const eff = effectivePermissions(seller, all);
    for (const key of eff) expect(CATALOG).toContain(key);
    expect(eff).not.toContain('fuel.governance.manage');
    expect(eff).not.toContain('fuel.staff.manage');
    expect(eff).not.toContain('fuel_stations.manage');
    expect(eff).toContain('fuel.sale.price.manage');
  });

  it('applying a template makes the effective permissions exactly the template (add what is missing, remove what is extra)', () => {
    const next = applyTemplatePermissions(seller, EMPTY_INTENT, SUPERVISOR);
    expect(effectivePermissions(seller, next)).toEqual([...SUPERVISOR].sort());
    expect(matchTemplate(tpl, effectivePermissions(seller, next))).toBe('supervisor');
    const down = applyTemplatePermissions(staff(UID(2), 'M', { fuel_permissions: MANAGER }), EMPTY_INTENT, SELLER);
    expect(effectivePermissions(staff(UID(2), 'M', { fuel_permissions: MANAGER }), down)).toEqual([...SELLER].sort());
  });

  it('detects custom and none', () => {
    expect(matchTemplate(tpl, [...SELLER, 'fuel.reading.view'])).toBe('custom');
    expect(matchTemplate(tpl, [])).toBe('none');
    expect(matchTemplate(tpl, SELLER)).toBe('seller');
  });

  it('stations toggle as a delta and an unknown (hidden) station stays untouched', () => {
    const hidden = staff(UID(3), 'H', { station_ids: [UID(900), UID(100)] });
    const added = toggleStation(hidden, EMPTY_INTENT, UID(101));
    expect(effectiveStations(hidden, added)).toEqual([UID(100), UID(101), UID(900)].sort());
    const removed = toggleStation(hidden, EMPTY_INTENT, UID(100));
    expect(effectiveStations(hidden, removed)).toEqual([UID(900)]);
    expect(isDirty(toggleStation(hidden, added, UID(101)))).toBe(false);
  });
});

describe('the payload is exactly what the review dialog shows', () => {
  it('sends only the delta, the base revision, a trimmed reason and the full station list only when it changed', () => {
    let intent = togglePermission(seller, EMPTY_INTENT, 'fuel.reading.view', ctx);
    intent = togglePermission(seller, intent, 'fuel.shift.open', ctx);
    const body = buildUpdateBody(seller, intent, '  covering a holiday  ');
    expect(body).toEqual({ expected_revision: 'r1', add_permissions: ['fuel.reading.view'], remove_permissions: ['fuel.shift.open'], reason: 'covering a holiday' });
    expect(body).not.toHaveProperty('station_ids');
    expect(body).not.toHaveProperty('template');
    expect(body).not.toHaveProperty('grant_all_fuel');

    const withStations = buildUpdateBody(seller, toggleStation(seller, EMPTY_INTENT, UID(101)), '');
    expect(withStations.station_ids).toEqual([UID(100), UID(101)]);
    expect(withStations).not.toHaveProperty('reason');
    expect(withStations).not.toHaveProperty('add_permissions');
  });

  it('caps the reason at 500 characters', () => {
    expect(buildUpdateBody(seller, toggleStation(seller, EMPTY_INTENT, UID(101)), 'x'.repeat(900)).reason).toHaveLength(500);
  });
});

describe('conflict handling keeps the user edits', () => {
  it('rebases an intent over a newer snapshot: already-satisfied edits drop, the rest survive', () => {
    let intent = togglePermission(seller, EMPTY_INTENT, 'fuel.reading.view', ctx);
    intent = togglePermission(seller, intent, 'fuel.reading.record', ctx);
    intent = togglePermission(seller, intent, 'fuel.shift.open', ctx);
    intent = toggleStation(seller, intent, UID(101));
    // مسؤول آخر أضاف reading.view بالفعل وسحب shift.open وأضاف المحطة 101.
    const newer = staff(UID(1), 'Emp One', { fuel_permissions: [...SELLER.filter((k) => k !== 'fuel.shift.open'), 'fuel.reading.view'].sort(), station_ids: [UID(100), UID(101)], revision: 'r2' });
    const rebased = rebaseIntent(newer, intent);
    expect([...rebased.permAdd]).toEqual(['fuel.reading.record']);
    expect([...rebased.permRemove]).toEqual([]);
    expect([...rebased.stationAdd]).toEqual([]);
    expect(buildUpdateBody(newer, rebased, '').expected_revision).toBe('r2');
  });
});

describe('permissions are grouped by job', () => {
  it('maps the real fuel catalogue keys into functional groups', () => {
    expect(groupOf('fuel.shift.open')).toBe('shifts');
    expect(groupOf('fuel.sale.price.manage')).toBe('sales');
    expect(groupOf('fuel.delivery.approve')).toBe('receiving');
    expect(groupOf('fuel_stations.view')).toBe('stations');
    expect(groupOf('fuel.alerts.view')).toBe('monitoring');
    expect(groupOf('fuel.contract.view')).toBe('customers');
    expect(groupOf('fuel.governance.manage')).toBe('governance');
    expect(groupOf('fuel.unknown_thing.view')).toBe('other');
    const grouped = groupPermissions(CATALOG);
    expect(grouped.flatMap((g) => g.keys).sort()).toEqual([...CATALOG].sort());
    expect(grouped.map((g) => g.id)[0]).toBe('shifts');
  });
});
