import { describe, expect, it } from 'vitest';
import {
  formatTechnicalJson,
  isTechnicalFieldPath,
  stableStringify,
  valuesEqual,
} from '../technical-data';

describe('technical-data', () => {
  it('stringifies nested objects and arrays with stable key order', () => {
    const a = { z: 1, nested: { b: 2, a: [3, { y: 4, x: 5 }] } };
    const b = { nested: { a: [3, { x: 5, y: 4 }], b: 2 }, z: 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
    expect(valuesEqual(a, b)).toBe(true);
  });

  it('formats long UUIDs and unbroken strings without dropping content', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const long = 'x'.repeat(400);
    const raw = formatTechnicalJson({ id: uuid, note: long, empty: {}, missing: null });
    expect(raw).toContain(uuid);
    expect(raw).toContain(long);
    expect(raw).toContain('"empty": {}');
    expect(raw).toContain('null');
  });

  it('treats empty object and null distinctly', () => {
    expect(formatTechnicalJson({})).toBe('{}');
    expect(formatTechnicalJson(null)).toBe('null');
    expect(valuesEqual({}, null)).toBe(false);
  });

  it('flags technical identifier paths', () => {
    expect(isTechnicalFieldPath('product_id')).toBe(true);
    expect(isTechnicalFieldPath('item.product_id')).toBe(true);
    expect(isTechnicalFieldPath('correlation_id')).toBe(true);
    expect(isTechnicalFieldPath('quantity')).toBe(false);
    expect(isTechnicalFieldPath('item.quantity')).toBe(false);
  });
});
