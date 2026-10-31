import { describe, expect, it } from 'vitest';
import { expectMessageParity } from '../../messages/testing';
import { catalogMessages } from './messages';

describe('catalog messages', () => {
  it('has matching ar/en keys, no empties, same placeholders', () => expectMessageParity(catalogMessages.messages));

  // The workspace products LIST endpoint returns Product::sale_price (base price); only the detail endpoint resolves the
  // channel price. The list copy must therefore say "base price" in both languages and never claim a channel price.
  it('labels the availability-list amount as the base product price in both languages', () => {
    const { ar, en } = catalogMessages.messages;
    expect(en.colPrice).toBe('Base price');
    expect(ar.colPrice).toBe('السعر الأساسي');
    expect(en.availabilityNote).toMatch(/base price/i);
    expect(ar.availabilityNote).toMatch(/السعر الأساسي/);
    // The note must send the reader to the details for the channel price, not assert one for the list.
    expect(en.availabilityNote).toMatch(/product details/i);
    expect(ar.availabilityNote).toMatch(/تفاصيل المنتج/);
    for (const text of [en.colPrice, ar.colPrice]) expect(text).not.toMatch(/channel|wholesale|القناة|الجملة/i);
  });

  it('keeps the channel-price wording for the detail view only', () => {
    const { ar, en } = catalogMessages.messages;
    expect(en.detailPrice).toBe('Channel price');
    expect(ar.detailPrice).toBe('السعر في القناة');
  });
});
