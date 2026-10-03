import { describe, expect, it } from 'vitest';
import { deliveryHubActions } from './delivery-hub';
import { deliveryPlatformPresentation, deliveryPlatformPresentations } from './delivery-platform-registry';

describe('delivery platform registry', () => {
  it('names every known platform and commits no logo file', () => {
    const keys = deliveryPlatformPresentations().map((platform) => platform.key);
    expect(keys).toEqual(['hungerstation', 'jahez', 'mrsool', 'keeta', 'ninja', 'the_chefz']);
    for (const platform of deliveryPlatformPresentations()) {
      expect(platform.logoSrc).toBeNull();
      expect(platform.fallback).toBe('monogram');
      expect(platform.nameAr.length).toBeGreaterThan(0);
      expect(platform.nameEn.length).toBeGreaterThan(0);
    }
    expect(deliveryPlatformPresentation('unknown')).toBeNull();
    expect(deliveryPlatformPresentation('keeta')?.nameEn).toBe('Keeta');
  });
});

describe('delivery hub actions', () => {
  it('follows the accepted linear machine and hides actions from view-only users', () => {
    expect(deliveryHubActions({ state: 'received', canOperate: false, canSeeUnrouted: true, branchCount: 2 })).toEqual([]);
    expect(deliveryHubActions({ state: 'unrouted', canOperate: true, canSeeUnrouted: false, branchCount: 1 })).toEqual([]);
    expect(deliveryHubActions({ state: 'unrouted', canOperate: true, canSeeUnrouted: true, branchCount: 1 })).toEqual(['route', 'cancel', 'reject']);
    expect(deliveryHubActions({ state: 'received', canOperate: true, canSeeUnrouted: true, branchCount: 2 })).toEqual(['accept', 'reroute', 'cancel', 'reject']);
    expect(deliveryHubActions({ state: 'received', canOperate: true, canSeeUnrouted: true, branchCount: 1 })).toEqual(['accept', 'cancel', 'reject']);
    expect(deliveryHubActions({ state: 'accepted', canOperate: true, canSeeUnrouted: true, branchCount: 2 })).toEqual(['preparing', 'cancel', 'reject']);
    expect(deliveryHubActions({ state: 'ready', canOperate: true, canSeeUnrouted: true, branchCount: 1 })).toEqual(['handoff', 'cancel', 'reject']);
    expect(deliveryHubActions({ state: 'handed_off', canOperate: true, canSeeUnrouted: true, branchCount: 1 })).toEqual(['cancel', 'reject']);
    expect(deliveryHubActions({ state: 'cancelled_before_post', canOperate: true, canSeeUnrouted: true, branchCount: 2 })).toEqual([]);
  });
});
