import { describe, expect, it } from 'vitest';
import { findGridNeighborIndex, isHorizontalGridEdge } from './grid-navigation';

const rects = [
  { left: 0, top: 0, width: 100, height: 80 },
  { left: 110, top: 0, width: 100, height: 80 },
  { left: 0, top: 90, width: 100, height: 80 },
  { left: 110, top: 90, width: 100, height: 80 },
];

describe('تنقل الشبكة الهندسي', () => {
  it('ينتقل يميناً في LTR', () => {
    expect(findGridNeighborIndex(rects, 0, 'right', false)).toBe(1);
    expect(findGridNeighborIndex(rects, 1, 'right', false)).toBeNull();
  });

  it('يعكس اليمين/اليسار في RTL', () => {
    expect(findGridNeighborIndex(rects, 1, 'right', true)).toBe(0);
    expect(findGridNeighborIndex(rects, 0, 'left', true)).toBe(1);
  });

  it('ينتقل لأعلى ولأسفل بين الصفوف', () => {
    expect(findGridNeighborIndex(rects, 0, 'down', false)).toBe(2);
    expect(findGridNeighborIndex(rects, 2, 'up', false)).toBe(0);
  });

  it('يكشف الحافة الأفقية', () => {
    expect(isHorizontalGridEdge(rects, 1, 'right', false)).toBe(true);
    expect(isHorizontalGridEdge(rects, 0, 'right', false)).toBe(false);
  });
});
