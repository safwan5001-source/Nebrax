import { describe, expect, it } from 'vitest';
import type { PresentationHomeSection } from '../presentation/config';
import { applyFlowersGiftSections, type FlowersPackInput } from '../presentation/flowers-pack';
import { MAX_HOME_SECTIONS } from '../presentation/config';

const copy = { occasionTitle: 'Occasion', recipientTitle: 'Recipient', deliveryPromiseTitle: 'Delivery' };
const input = (over: Partial<FlowersPackInput> = {}): FlowersPackInput => ({
  facetKeys: { occasion: 'occasion', recipient: 'recipient' },
  deliveryScheduleConfigured: true,
  copy,
  ...over,
});
const section = (type: PresentationHomeSection['type'], id = type as string): PresentationHomeSection => ({ id, type, visible: true });
const base = [section('hero'), section('categories'), section('newArrivals')];
const types = (sections: readonly PresentationHomeSection[]) => sections.map((s) => s.type);

describe('applyFlowersGiftSections (FLOWERS-H15)', () => {
  it('adds discovery per facet and the delivery promise, directly after the hero', () => {
    const next = applyFlowersGiftSections(base, input());
    expect(types(next)).toEqual(['hero', 'discovery', 'discovery', 'deliveryPromise', 'categories', 'newArrivals']);
    const discovery = next.filter((s) => s.type === 'discovery').map((s) => s.content);
    expect(discovery).toEqual([
      { title: 'Occasion', axis: 'facet', dimension: 'occasion', display: 'tiles' },
      { title: 'Recipient', axis: 'facet', dimension: 'recipient', display: 'tiles' },
    ]);
    expect(next.every((s) => s.visible)).toBe(true);
    expect(new Set(next.map((s) => s.id)).size).toBe(next.length);
  });

  it('uses the merchant\'s own facet key, and adds nothing for a facet they do not have', () => {
    const next = applyFlowersGiftSections(base, input({ facetKeys: { occasion: 'occasions-mine', recipient: null }, deliveryScheduleConfigured: false }));
    expect(types(next)).toEqual(['hero', 'discovery', 'categories', 'newArrivals']);
    expect(next[1].content).toMatchObject({ dimension: 'occasions-mine' });
  });

  it('adds the delivery promise only when scheduling is actually configured', () => {
    const off = applyFlowersGiftSections(base, input({ facetKeys: { occasion: null, recipient: null }, deliveryScheduleConfigured: false }));
    expect(off).toEqual(base);
    expect(off).not.toBe(base);
  });

  it('is idempotent: nothing is added twice and existing sections keep their order and content', () => {
    const once = applyFlowersGiftSections(base, input());
    const twice = applyFlowersGiftSections(once, input());
    expect(twice).toEqual(once);
  });

  it('keeps a merchant\'s own discovery for that facet and an existing delivery promise untouched', () => {
    const mine: PresentationHomeSection = {
      id: 'mine',
      type: 'discovery',
      visible: false,
      content: { title: 'My title', axis: 'facet', dimension: 'occasion', display: 'chips' },
    };
    const promise: PresentationHomeSection = { id: 'p', type: 'deliveryPromise', visible: false, content: { title: 'Mine', body: 'x' } };
    const next = applyFlowersGiftSections([section('hero'), mine, promise], input());
    expect(next.find((s) => s.id === 'mine')).toBe(mine);
    expect(next.find((s) => s.id === 'p')).toBe(promise);
    expect(types(next)).toEqual(['hero', 'discovery', 'discovery', 'deliveryPromise']);
    expect(next.filter((s) => s.type === 'discovery' && (s.content as { dimension?: string }).dimension === 'occasion')).toHaveLength(1);
  });

  it('puts the sections first when there is no hero', () => {
    expect(types(applyFlowersGiftSections([section('categories')], input({ deliveryScheduleConfigured: false })))).toEqual([
      'discovery',
      'discovery',
      'categories',
    ]);
  });

  it('never exceeds the homepage section limit', () => {
    const full = Array.from({ length: MAX_HOME_SECTIONS - 1 }, (_, i) => section('customContent', `c${i}`));
    const next = applyFlowersGiftSections(full, input());
    expect(next).toHaveLength(MAX_HOME_SECTIONS);
    expect(next.filter((s) => s.type === 'discovery')).toHaveLength(1);
  });

  it('does not mutate its input', () => {
    const frozen = Object.freeze(base.map((s) => Object.freeze({ ...s })));
    expect(() => applyFlowersGiftSections(frozen, input())).not.toThrow();
  });
});
