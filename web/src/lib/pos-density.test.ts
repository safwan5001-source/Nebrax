import { describe, expect, it } from 'vitest';
import { parsePosDensity, posTileShowsImage } from './pos-density';

describe('POS UI V3 density', () => {
  it('defaults to standard and accepts only the three modes', () => {
    expect(parsePosDensity(null)).toBe('standard');
    expect(parsePosDensity('')).toBe('standard');
    expect(parsePosDensity('grid')).toBe('standard');
    expect(parsePosDensity('compact')).toBe('compact');
    expect(parsePosDensity('visual')).toBe('visual');
  });

  it('does not show images in compact even when the server allows them', () => {
    expect(posTileShowsImage('compact', true)).toBe(false);
    expect(posTileShowsImage('standard', true)).toBe(true);
    expect(posTileShowsImage('standard', false)).toBe(false);
    expect(posTileShowsImage('visual', true)).toBe(true);
    expect(posTileShowsImage('visual', false)).toBe(false);
  });
});
