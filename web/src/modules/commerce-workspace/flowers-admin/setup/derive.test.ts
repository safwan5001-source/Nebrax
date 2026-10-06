import { describe, expect, it } from 'vitest';
import type { ScheduleDocument } from '../delivery-schedule';
import type { FulfillmentDocument } from '../fulfillment';
import type { GiftPolicy } from '../gift-settings';
import type { VerticalSetup } from '@/modules/commerce-workspace/vertical-setup';
import { deriveSetupSteps, groupSteps, nextStep, setupProgress, type SetupInputs } from './derive';

const KEYS = ['occasions', 'recipients', 'gift_message', 'personalization', 'add_ons', 'delivery_scheduling', 'same_day_delivery', 'structured_content', 'vertical_sections'];
const setup = (configured: string[] = [], extra: VerticalSetup['items'] = []): VerticalSetup => ({
  vertical: 'flowers_gifts',
  items: [...KEYS.map((key) => ({ key, available: true, state: configured.includes(key) ? ('configured' as const) : ('not_configured' as const), count: configured.includes(key) ? 2 : 0, manageIn: 'x' })), ...extra],
});
const gift = (enabled: boolean): GiftPolicy => ({ enabled, messageMaxLength: 250, allowHideSender: true, recipientPhoneRequired: true });
const schedule = (enabled: boolean, windows: number): ScheduleDocument => ({
  settings: { enabled, required: true, timezone: 'Asia/Riyadh', leadTimeMinutes: 0, cutoffTime: null, maxDaysAhead: 30 },
  slots: Array.from({ length: windows }, (_, i) => ({ id: `w${i}`, method: 'delivery' as const, label: 'x', labelEn: null, startTime: '09:00', endTime: '10:00', weekdays: [0], capacity: null, shippingZoneId: null, isActive: true })),
  blockedDates: [],
});
const fulfil = (active: boolean | null): FulfillmentDocument => ({
  current: active === null ? null : { id: 'w', code: '1', name: 'm', city: null, isActive: active },
  warehouses: [],
});
const inputs = (over: Partial<SetupInputs> = {}): SetupInputs => ({ setup: setup(), gift: null, schedule: null, fulfillment: null, ...over });
const step = (steps: ReturnType<typeof deriveSetupSteps>, key: string) => steps.find((s) => s.key === key)!;

describe('setup derivation', () => {
  it('orders steps and groups them: catalog → gifting → delivery → products → presentation', () => {
    const steps = deriveSetupSteps(inputs());
    expect(steps.map((s) => s.key)).toEqual(['occasions', 'recipients', 'gift_message', 'delivery_scheduling', 'same_day_delivery', 'personalization', 'add_ons', 'structured_content', 'vertical_sections']);
    expect(groupSteps(steps).map((g) => [g.group, g.steps.length])).toEqual([['catalog', 2], ['gifting', 1], ['delivery', 2], ['products', 3], ['presentation', 1]]);
  });

  it('takes state and counts from the server and ignores unknown capabilities', () => {
    const steps = deriveSetupSteps(inputs({ setup: setup(['occasions'], [{ key: 'future_cap', available: true, state: 'configured', count: 1, manageIn: 'y' }]) }));
    expect(step(steps, 'occasions')).toMatchObject({ state: 'configured', count: 2, missing: [] });
    expect(steps.find((s) => s.key === 'future_cap')).toBeUndefined();
    expect(setupProgress(steps)).toEqual({ done: 1, total: 9 });
  });

  it('explains gifting and delivery gaps from the real documents, and links to the right tab', () => {
    const off = deriveSetupSteps(inputs({ gift: gift(false), schedule: schedule(false, 0), fulfillment: fulfil(null) }));
    expect(step(off, 'gift_message')).toMatchObject({ missing: ['gift_off'], href: '/commerce/gifting' });
    expect(step(off, 'delivery_scheduling')).toMatchObject({ missing: ['schedule_off'], href: '/commerce/delivery?tab=rules' });
    expect(step(off, 'same_day_delivery').missing).toEqual(['needs_scheduling', 'no_warehouse']);
    expect(step(off, 'same_day_delivery').href).toBe('/commerce/delivery?tab=fulfilment');

    const noWindows = deriveSetupSteps(inputs({ schedule: schedule(true, 0), fulfillment: fulfil(true) }));
    expect(step(noWindows, 'delivery_scheduling')).toMatchObject({ missing: ['no_windows'], href: '/commerce/delivery?tab=windows' });
    expect(step(noWindows, 'same_day_delivery')).toMatchObject({ missing: ['no_windows'], href: '/commerce/delivery?tab=windows' });

    const inactive = deriveSetupSteps(inputs({ schedule: schedule(true, 2), fulfillment: fulfil(false) }));
    expect(step(inactive, 'same_day_delivery')).toMatchObject({ missing: ['warehouse_inactive'], href: '/commerce/delivery?tab=fulfilment' });
  });

  it('never invents a reason when a document could not be read', () => {
    const steps = deriveSetupSteps(inputs());
    expect(step(steps, 'gift_message').missing).toEqual([]);
    expect(step(steps, 'delivery_scheduling').missing).toEqual([]);
    expect(step(steps, 'same_day_delivery').missing).toEqual([]);
    expect(step(steps, 'delivery_scheduling').href).toBe('/commerce/delivery?tab=rules');
  });

  it('points product capabilities at the product list and marks that a product must be chosen', () => {
    const steps = deriveSetupSteps(inputs());
    for (const key of ['personalization', 'add_ons', 'structured_content']) {
      expect(step(steps, key)).toMatchObject({ href: '/products', needsProduct: true, missing: ['no_products'] });
    }
    expect(step(steps, 'vertical_sections')).toMatchObject({ href: '/commerce/appearance', missing: ['no_section'] });
    expect(step(steps, 'occasions')).toMatchObject({ href: '/commerce/merchandising', missing: ['no_values'] });
  });

  it('finds the next unfinished step and reports completion', () => {
    expect(nextStep(deriveSetupSteps(inputs()))?.key).toBe('occasions');
    expect(nextStep(deriveSetupSteps(inputs({ setup: setup(['occasions', 'recipients']) })))?.key).toBe('gift_message');
    expect(nextStep(deriveSetupSteps(inputs({ setup: setup(KEYS) })))).toBeNull();
  });

  it('every destination is an existing route (never a dead link)', () => {
    const all = deriveSetupSteps(inputs({ gift: gift(false), schedule: schedule(false, 0), fulfillment: fulfil(null) }));
    const known = ['/commerce/merchandising', '/commerce/gifting', '/commerce/delivery', '/products', '/commerce/appearance'];
    for (const s of all) expect(known.some((k) => s.href === k || s.href.startsWith(`${k}?tab=`)), s.href).toBe(true);
  });
});
