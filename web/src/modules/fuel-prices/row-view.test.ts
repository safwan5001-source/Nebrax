import { describe, expect, it } from 'vitest';
import { effective, suggestionBlocked, suggestionOk, unset } from './__fixtures__';
import { describeRow, describeSuggestion, needsSupersede } from './row-view';

describe('describeRow — the server decides; the client only presents', () => {
  it('maps an effective row with source, tax mode, validity and sellability', () => {
    expect(describeRow(effective('s1', 'p1', 218))).toMatchObject({ kind: 'known', minor: 218, scope: 'station', taxMode: 'tax_inclusive', sellable: true, from: '2026-10-01T09:00:00+00:00' });
    expect(describeRow(effective(null, 'p1', 205))).toMatchObject({ kind: 'known', scope: 'tenant' });
  });
  it('keeps missing price distinct from a price and from zero', () => {
    expect(describeRow(unset('s1', 'p1'))).toEqual({ kind: 'not_configured', taxMode: 'tax_inclusive' });
    expect(describeRow(unset('s1', 'p1', { status: 'product_inactive' }))).toEqual({ kind: 'product_inactive' });
    expect(describeRow(undefined)).toEqual({ kind: 'invalid' });
  });
  it('keeps an unset tax mode and the blockers visible', () => {
    expect(describeRow(effective('s1', 'p1', 218, { tax_mode: null, sellable: false, blockers: ['tax_mode_unset'] }))).toMatchObject({ kind: 'known', taxMode: null, sellable: false, blockers: ['tax_mode_unset'] });
  });
  it.each([
    ['non-liter unit', { unit: 'pcs' }], ['unknown status', { status: 'superseded' }], ['no price', { price_per_liter_minor: null }],
    ['unknown source', { source: 'product_card' }], ['unknown tax mode', { tax_mode: 'maybe' }],
  ])('refuses %s instead of showing a number', (_label, over) => {
    expect(describeRow(effective('s1', 'p1', 218, over))).toEqual({ kind: 'invalid' });
  });
});

describe('describeSuggestion', () => {
  it('available needs a positive price, a known tax mode and no blockers', () => {
    expect(describeSuggestion(suggestionOk('s1', 'p1', 218))).toEqual({ kind: 'available', minor: 218, taxMode: 'tax_inclusive', cardUnit: 'L', matchesCurrent: false });
    expect(describeSuggestion(suggestionOk('s1', 'p1', 218, { tax_mode: null }))).toEqual({ kind: 'invalid' });
    expect(describeSuggestion(suggestionOk('s1', 'p1', 218, { blockers: ['x'] }))).toEqual({ kind: 'invalid' });
    expect(describeSuggestion(suggestionOk('s1', 'p1', 218, { unit: 'mL' }))).toEqual({ kind: 'invalid' });
  });
  it('blocked keeps the reasons; missing row is invalid', () => {
    expect(describeSuggestion(suggestionBlocked('s1', 'p1', ['requires_liter_price']))).toEqual({ kind: 'blocked', blockers: ['requires_liter_price'] });
    expect(describeSuggestion(undefined)).toEqual({ kind: 'invalid' });
  });
});

describe('needsSupersede', () => {
  const NOW = Date.parse('2026-11-05T10:00:00Z');
  it('no current price ⇒ no replacement; open-ended ⇒ replacement; bounded price ending before the start ⇒ none', () => {
    expect(needsSupersede(null, NOW)).toBe(false);
    expect(needsSupersede({ effective_until: null }, NOW)).toBe(true);
    expect(needsSupersede({ effective_until: '2026-11-05T09:00:00Z' }, NOW)).toBe(false);
    expect(needsSupersede({ effective_until: '2026-11-06T09:00:00Z' }, NOW)).toBe(true);
  });
});
