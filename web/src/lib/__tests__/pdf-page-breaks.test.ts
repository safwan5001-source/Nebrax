import { describe, expect, it } from 'vitest';
import { getPdfImageSlices } from '@/lib/pdf';

describe('فواصل صفحات PDF raster', () => {
  it('يفضل آخر حد آمن للصف قبل نهاية A4 الاسمية', () => {
    expect(getPdfImageSlices(2_400, 1_000, [300, 760, 1_430, 2_100])).toEqual([
      { top: 0, height: 760 },
      { top: 760, height: 670 },
      { top: 1_430, height: 670 },
      { top: 2_100, height: 300 },
    ]);
  });

  it('يسقط بأمان إلى حد الصفحة الحسابي عند عدم وجود حد كافٍ للكتلة الطويلة', () => {
    expect(getPdfImageSlices(2_100, 1_000, [50, 1_950])).toEqual([
      { top: 0, height: 1_000 },
      { top: 1_000, height: 950 },
      { top: 1_950, height: 150 },
    ]);
  });
});
