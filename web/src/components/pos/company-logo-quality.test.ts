import { describe, expect, it } from 'vitest';
import { hasMeaningfulLogoPixels } from './company-logo-quality';

function pixels(values: Array<[number, number, number, number]>): Uint8ClampedArray {
  return new Uint8ClampedArray(values.flat());
}

describe('hasMeaningfulLogoPixels', () => {
  it('rejects a fully transparent image', () => {
    expect(hasMeaningfulLogoPixels(pixels(Array.from({ length: 16 }, () => [255, 255, 255, 0])))).toBe(false);
  });

  it('rejects an opaque white rectangle', () => {
    expect(hasMeaningfulLogoPixels(pixels(Array.from({ length: 16 }, () => [255, 255, 255, 255])))).toBe(false);
  });

  it('accepts a dark mark on a white background', () => {
    const image = Array.from({ length: 100 }, () => [255, 255, 255, 255] as [number, number, number, number]);
    image[42] = [20, 30, 40, 255];
    expect(hasMeaningfulLogoPixels(pixels(image))).toBe(true);
  });

  it('accepts a white logo on transparency', () => {
    const image = Array.from({ length: 100 }, () => [255, 255, 255, 0] as [number, number, number, number]);
    for (let index = 20; index < 80; index += 1) image[index] = [255, 255, 255, 255];
    expect(hasMeaningfulLogoPixels(pixels(image))).toBe(true);
  });
});
