import { describe, expect, it } from 'vitest';
import { deliveryHubActions, deliveryHubListPath, readHubContext, readHubOrders } from './delivery-hub';
import { deliveryPlatformLabel, deliveryPlatformPresentation, deliveryPlatformPresentations } from './delivery-platform-registry';

describe('delivery platform registry', () => {
  it('names every known platform and points at its official logo file', () => {
    const keys = deliveryPlatformPresentations().map((platform) => platform.key);
    expect(keys).toEqual(['hungerstation', 'jahez', 'mrsool', 'keeta', 'ninja', 'the_chefz']);
    for (const platform of deliveryPlatformPresentations()) {
      expect(platform.logoSrc).toBe(`/delivery-platforms/${platform.key === 'the_chefz' ? 'the-chefz' : platform.key}.png`);
      expect(platform.fallback).toBe('monogram');
      expect(platform.nameAr.length).toBeGreaterThan(0);
      expect(platform.nameEn.length).toBeGreaterThan(0);
    }
    expect(deliveryPlatformPresentation('unknown')).toBeNull();
    expect(deliveryPlatformPresentation('keeta')?.nameEn).toBe('Keeta');
  });

  it('prefers the registry name and keeps an unknown platform readable', () => {
    expect(deliveryPlatformLabel('jahez', 'en', { name: 'Other', nameEn: 'Other' })).toBe('Jahez');
    expect(deliveryPlatformLabel('jahez', 'ar', { name: 'Other', nameEn: 'Other' })).toBe('جاهز');
    expect(deliveryPlatformLabel('custom', 'ar', { name: 'خاصة', nameEn: 'Custom' })).toBe('خاصة');
    expect(deliveryPlatformLabel('custom', 'en', { name: 'خاصة', nameEn: null })).toBe('خاصة');
    expect(deliveryPlatformLabel(null, 'ar', {})).toBe('');
  });
});

describe('delivery hub actions', () => {
  it('follows the accepted linear machine and hides actions from view-only users', () => {
    expect(deliveryHubActions({ state: 'received', canOperate: false, canSeeUnrouted: true, destinationCount: 1 })).toEqual([]);
    expect(deliveryHubActions({ state: 'unrouted', canOperate: true, canSeeUnrouted: false, destinationCount: 1 })).toEqual([]);
    expect(deliveryHubActions({ state: 'unrouted', canOperate: true, canSeeUnrouted: true, destinationCount: 1 })).toEqual(['route', 'cancel', 'reject']);
    expect(deliveryHubActions({ state: 'unrouted', canOperate: true, canSeeUnrouted: true, destinationCount: 0 })).toEqual(['cancel', 'reject']);
    expect(deliveryHubActions({ state: 'received', canOperate: true, canSeeUnrouted: true, destinationCount: 1 })).toEqual(['accept', 'reroute', 'cancel', 'reject']);
    expect(deliveryHubActions({ state: 'received', canOperate: true, canSeeUnrouted: true, destinationCount: 0 })).toEqual(['accept', 'cancel', 'reject']);
    expect(deliveryHubActions({ state: 'accepted', canOperate: true, canSeeUnrouted: true, destinationCount: 1 })).toEqual(['preparing', 'cancel', 'reject']);
    expect(deliveryHubActions({ state: 'ready', canOperate: true, canSeeUnrouted: true, destinationCount: 0 })).toEqual(['handoff', 'cancel', 'reject']);
    expect(deliveryHubActions({ state: 'handed_off', canOperate: true, canSeeUnrouted: true, destinationCount: 0 })).toEqual(['cancel', 'reject']);
    expect(deliveryHubActions({ state: 'cancelled_before_post', canOperate: true, canSeeUnrouted: true, destinationCount: 1 })).toEqual([]);
  });
});

describe('delivery hub list query', () => {
  it('combines the supported filters and does not invent a search parameter', () => {
    const received = new URL(deliveryHubListPath({
      state: 'received',
      platformId: '11111111-1111-1111-1111-111111111111',
      branchId: '22222222-2222-2222-2222-222222222222',
      page: 3,
    }), 'http://local');
    expect(received.searchParams.get('state')).toBe('received');
    expect(received.searchParams.get('page')).toBe('3');
    expect(received.searchParams.get('per_page')).toBe('50');
    expect(received.searchParams.get('delivery_platform_profile_id')).toBe('11111111-1111-1111-1111-111111111111');
    expect(received.searchParams.get('branch_id')).toBe('22222222-2222-2222-2222-222222222222');
    expect(received.searchParams.get('unrouted')).toBeNull();
    expect(received.searchParams.get('search')).toBeNull();
    expect(received.searchParams.get('q')).toBeNull();

    const unrouted = new URL(deliveryHubListPath({ state: 'unrouted', platformId: '', branchId: '', page: 1 }), 'http://local');
    expect(unrouted.searchParams.get('unrouted')).toBe('1');
    expect(unrouted.searchParams.get('state')).toBeNull();

    const all = new URL(deliveryHubListPath({ state: 'all', platformId: '', branchId: '', page: 1 }), 'http://local');
    expect(all.searchParams.get('state')).toBeNull();
    expect(all.searchParams.get('unrouted')).toBeNull();
  });
});

describe('delivery hub response boundary', () => {
  it('does not treat a demo array as branch context or an order list', () => {
    expect(readHubContext([])).toEqual({ can_see_unrouted: false, platforms: [], branches: [] });
    expect(readHubContext({
      can_see_unrouted: true,
      platforms: [{ id: 'p', platform_key: 'jahez', name: 'جاهز', name_en: 'Jahez' }],
      branches: [{ id: 'b', name: 'الأول', is_active: true }],
    }).can_see_unrouted).toBe(true);
    expect(readHubOrders([])).toEqual([]);
    expect(readHubOrders(undefined)).toEqual([]);
  });
});
