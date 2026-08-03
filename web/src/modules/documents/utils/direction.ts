import type { Direction } from '../types';

const RTL_CHARS = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

/**
 * حسم اتجاه الكتابة النهائي. `auto` يستنبط من عيّنة نصّ (أول محرف قويّ)،
 * وحين لا عيّنة يفترض RTL (سياق نبراس عربي أولاً).
 */
export function resolveDirection(direction: Direction, sample?: string | null): 'rtl' | 'ltr' {
  if (direction === 'rtl' || direction === 'ltr') return direction;
  if (sample && RTL_CHARS.test(sample)) return 'rtl';
  return sample ? 'ltr' : 'rtl';
}
