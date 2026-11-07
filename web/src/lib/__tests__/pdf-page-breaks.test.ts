import { describe, expect, it } from 'vitest';
import { findLastInkRow, getPdfImageSlices } from '@/lib/pdf';

describe('فواصل صفحات PDF raster', () => {
  it('يفضل آخر حد آمن للصف قبل نهاية الصفحة الاسمية', () => {
    // ما بقي بعد الحد 1430 (970) يتّسع في صفحة واحدة فيُؤخذ كاملاً — لا قطع عند 2100
    // (القطع القديم كان يترك 300 فقط في صفحة أخيرة يتيمة).
    expect(getPdfImageSlices(2_400, 1_000, [300, 760, 1_430, 2_100])).toEqual([
      { top: 0, height: 760 },
      { top: 760, height: 670 },
      { top: 1_430, height: 970 },
    ]);
  });

  it('يسقط بأمان إلى حد الصفحة الحسابي عند عدم وجود حد كافٍ للكتلة الطويلة', () => {
    expect(getPdfImageSlices(2_100, 1_000, [50, 1_950])).toEqual([
      { top: 0, height: 1_000 },
      { top: 1_000, height: 950 },
      { top: 1_950, height: 150 },
    ]);
  });

  it('يُعيد شريحة واحدة عندما يتّسع المحتوى في صفحة واحدة', () => {
    expect(getPdfImageSlices(800, 1_000, [])).toEqual([
      { top: 0, height: 800 },
    ]);
  });

  it('يُعيد شريحة واحدة عندما يساوي ارتفاع المحتوى ارتفاع الصفحة بالضبط', () => {
    expect(getPdfImageSlices(1_000, 1_000, [])).toEqual([
      { top: 0, height: 1_000 },
    ]);
  });

  it('لا يقطع محتوى يتّسع في صفحة واحدة حتى لو وُجدت حدود آمنة (لا صفحة يتيمة)', () => {
    expect(getPdfImageSlices(2_000, 2_246, [600, 1_200, 1_800])).toEqual([
      { top: 0, height: 2_000 },
    ]);
  });

  it('يتسامح مع زيادة تقريب البكسل ولا يفتح لها صفحة جديدة', () => {
    expect(getPdfImageSlices(1_002, 1_000, [900])).toEqual([{ top: 0, height: 1_002 }]);
    expect(getPdfImageSlices(1_003, 1_000, [900])).toHaveLength(2);
  });

  it('يفضّل قطعاً أبكر يترك ذيلاً معقولاً على ذيل هزيل (إجماليات + تذييل معاً)', () => {
    // آخر حد 1880 يترك 70 فقط (سطر تذييل يتيم)؛ الحد 1500 ينقل الإجماليات مع التذييل.
    expect(getPdfImageSlices(1_950, 1_000, [900, 1_500, 1_880])).toEqual([
      { top: 0, height: 900 },
      { top: 900, height: 600 },
      { top: 1_500, height: 450 },
    ]);
  });

  it('يحتفظ بالقطع عند آخر حد آمن إن لم يوجد حد يترك ذيلاً معقولاً', () => {
    expect(getPdfImageSlices(1_950, 1_000, [900, 1_880])).toEqual([
      { top: 0, height: 900 },
      { top: 900, height: 980 },
      { top: 1_880, height: 70 },
    ]);
  });

  it('الشرائح متجاورة تغطي كامل الارتفاع بلا فجوة ولا تداخل', () => {
    for (const [height, page, breaks] of [
      [5_127, 2_246, [210, 900, 1_700, 2_200, 3_400, 4_100, 4_800]],
      [9_999, 2_246, []],
      [2_247, 2_246, [100]],
    ] as const) {
      const slices = getPdfImageSlices(height, page, breaks);
      let cursor = 0;
      for (const slice of slices) {
        expect(slice.top).toBe(cursor);
        expect(slice.height).toBeGreaterThan(0);
        cursor += slice.height;
      }
      expect(cursor).toBe(height);
    }
  });
});

describe('findLastInkRow — قصّ الفراغ الأبيض الختامي', () => {
  const W = 4;
  const build = (rows: number, paint: Array<[number, number, number, number, number]> = []) => {
    const data = new Uint8ClampedArray(W * rows * 4).fill(255);
    for (const [row, x, r, g, b] of paint) {
      const i = (row * W + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
    return data;
  };

  it('يعيد -1 لصور بيضاء بالكامل', () => {
    expect(findLastInkRow(build(10), W, 10)).toBe(-1);
  });

  it('يجد آخر صف فيه حبر (حتى بكسل واحد)', () => {
    expect(findLastInkRow(build(10, [[3, 2, 0, 0, 0], [6, 0, 10, 10, 10]]), W, 10)).toBe(6);
  });

  it('الرمادي الفاتح جداً (≥250) يُعدّ بياضاً، والملوّن يُعدّ حبراً', () => {
    expect(findLastInkRow(build(10, [[8, 1, 251, 251, 251]]), W, 10)).toBe(-1);
    expect(findLastInkRow(build(10, [[8, 1, 255, 255, 120]]), W, 10)).toBe(8);
  });
});
