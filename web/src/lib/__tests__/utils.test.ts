import { describe, it, expect } from 'vitest';
import { cn } from '../utils';

describe('cn — دمج أصناف Tailwind', () => {
  it('يدمج ويتجاهل القيم الزائفة', () => {
    expect(cn('a', false && 'b', undefined, 'c')).toBe('a c');
  });

  it('يحلّ تعارض أصناف Tailwind (الأخير يفوز)', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('text-start', 'text-end')).toBe('text-end');
  });
});
