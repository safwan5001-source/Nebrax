import { describe, expect, it } from 'vitest';
import { findLogoContentBounds, hasMeaningfulLogoPixels } from './company-logo-quality';

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

describe('findLogoContentBounds', () => {
  it('crops large white margins around an opaque logo mark', () => {
    const width = 20;
    const height = 12;
    const image = Array.from({ length: width * height }, () => [255, 255, 255, 255] as [number, number, number, number]);

    for (let y = 5; y <= 6; y += 1) {
      for (let x = 8; x <= 11; x += 1) image[y * width + x] = [20, 30, 40, 255];
    }

    const bounds = findLogoContentBounds(pixels(image), width, height);
    expect(bounds).not.toBeNull();
    expect(bounds!.width).toBeLessThan(width);
    expect(bounds!.height).toBeLessThan(height);
    expect(bounds!.x).toBeGreaterThan(0);
    expect(bounds!.y).toBeGreaterThan(0);
  });

  it('uses visible alpha as the mark for a white logo on transparency', () => {
    const width = 12;
    const height = 12;
    const image = Array.from({ length: width * height }, () => [255, 255, 255, 0] as [number, number, number, number]);

    for (let y = 4; y <= 7; y += 1) {
      for (let x = 4; x <= 7; x += 1) image[y * width + x] = [255, 255, 255, 255];
    }

    const bounds = findLogoContentBounds(pixels(image), width, height);
    expect(bounds).not.toBeNull();
    expect(bounds!.width).toBeLessThan(width);
    expect(bounds!.height).toBeLessThan(height);
  });

  it('returns null for a blank opaque image', () => {
    const width = 8;
    const height = 8;
    const image = Array.from({ length: width * height }, () => [255, 255, 255, 255] as [number, number, number, number]);
    expect(findLogoContentBounds(pixels(image), width, height)).toBeNull();
  });
});
