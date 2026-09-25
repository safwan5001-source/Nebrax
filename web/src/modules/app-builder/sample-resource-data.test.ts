import { describe, expect, it } from 'vitest';
import { SAMPLE_COMMERCE_CART, SAMPLE_COMMERCE_PRODUCTS, SAMPLE_RESOURCE_DATA } from './sample-resource-data';

describe('sample-resource-data — shape matches DataResourceRegistry contracts', () => {
  it('commerce.products entries carry the real list-item fields', () => {
    expect(SAMPLE_COMMERCE_PRODUCTS.length).toBeGreaterThan(1);
    for (const product of SAMPLE_COMMERCE_PRODUCTS) {
      expect(typeof product.id).toBe('string');
      expect(typeof product.name).toBe('string');
      expect(typeof product.price.amount_minor).toBe('number');
      expect(typeof product.price.currency).toBe('string');
    }
  });

  it('commerce.cart carries the real single-resource fields, and line totals sum to the subtotal', () => {
    expect(SAMPLE_COMMERCE_CART.items.length).toBeGreaterThan(1);
    const sum = SAMPLE_COMMERCE_CART.items.reduce((total, item) => total + item.line_total.amount_minor, 0);
    expect(sum).toBe(SAMPLE_COMMERCE_CART.subtotal.amount_minor);
    for (const item of SAMPLE_COMMERCE_CART.items) {
      expect(item.line_total.amount_minor).toBe(item.unit_price.amount_minor * item.quantity);
    }
  });

  it('is keyed exactly by the resource ids resolveNodeBindings expects', () => {
    expect(Object.keys(SAMPLE_RESOURCE_DATA).sort()).toEqual(['commerce.cart', 'commerce.products']);
  });
});
