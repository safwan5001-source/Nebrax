import { describe, expect, it } from 'vitest';
import { buildPdfBlob, type PdfPaper, type PdfRaster } from '../pdf';

/** يلتقط ما يرسمه buildPdfBlob دون تشغيل jsPDF: صيغة الصفحة وموضع/أبعاد كل صورة. */
class FakeJsPdf {
  static instances: FakeJsPdf[] = [];
  readonly options: { format: [number, number]; orientation: string };
  readonly images: Array<{ x: number; y: number; w: number; h: number }> = [];
  pages = 1;
  constructor(options: { format: [number, number]; orientation: string }) {
    this.options = options;
    FakeJsPdf.instances.push(this);
  }
  addPage() { this.pages += 1; }
  addImage(_data: unknown, _fmt: string, x: number, y: number, w: number, h: number) { this.images.push({ x, y, w, h }); }
  output() { return new Blob(['x']); }
}

const raster = (width: number, height: number): PdfRaster => ({ width, height, slicePng: () => 'png' });
function run(paper: PdfPaper, width: number, height: number, breaks: number[] = []) {
  FakeJsPdf.instances = [];
  buildPdfBlob(FakeJsPdf as never, raster(width, height), paper, breaks);
  return FakeJsPdf.instances[0];
}

describe('buildPdfBlob — هوامش الصفحة (AWJ-DOC-V2-PR3B)', () => {
  it('بلا هوامش: الصورة عند (0,0) بعرض الورق كاملاً — السلوك السابق حرفياً', () => {
    const pdf = run({ widthMm: 210, heightMm: 297 }, 1588, 800);
    expect(pdf.options.format).toEqual([210, 297]);
    expect(pdf.images).toHaveLength(1);
    expect(pdf.images[0]).toMatchObject({ x: 0, y: 0, w: 210 });
    expect(pdf.images[0].h).toBeCloseTo((800 * 210) / 1588, 6);
  });

  it('مع هوامش: الصورة عند (يسار، أعلى) بعرض الورق − الهامشين', () => {
    const pdf = run({ widthMm: 148, heightMm: 210, marginsMm: { top: 10, right: 12, bottom: 10, left: 8 } }, 500, 400);
    expect(pdf.options.format).toEqual([148, 210]);
    expect(pdf.images[0]).toMatchObject({ x: 8, y: 10, w: 148 - 12 - 8 });
    expect(pdf.images[0].h).toBeCloseTo((400 * 128) / 500, 6);
  });

  it('مع هوامش: تُقطَّع الصفحات بارتفاع المحتوى (الورق − الهامشين) لا الورق', () => {
    // محتوى بعرض 128mm على صورة 512px ⇒ 4px/mm؛ ارتفاع المحتوى للصفحة 190mm = 760px.
    const paper = { widthMm: 148, heightMm: 210, marginsMm: { top: 10, right: 10, bottom: 10, left: 10 } };
    expect(run(paper, 512, 700).pages).toBe(1);
    expect(run(paper, 512, 1300).pages).toBe(2);
    // بلا هوامش الصفحة 210mm على 148mm عرضاً (3.46px/mm) ⇒ ارتفاع الصفحة 727px: نفس 1300px صفحتان أيضاً،
    // لكن 740px تتّسع في صفحة بلا هوامش وتحتاج صفحتين بهوامش (760px للمحتوى فقط عند 4px/mm).
    expect(run({ widthMm: 148, heightMm: 210 }, 512, 740).pages).toBe(2);
    expect(run(paper, 512, 740).pages).toBe(1);
  });

  it('الأفقي: orientation=landscape والقياس بالمقلوب', () => {
    const pdf = run({ widthMm: 210, heightMm: 148, marginsMm: { top: 10, right: 10, bottom: 10, left: 10 } }, 760, 300);
    expect(pdf.options.orientation).toBe('landscape');
    expect(pdf.options.format).toEqual([210, 148]);
  });

  it('الرول (ارتفاع مفتوح) يتجاهل الهوامش: صفحة بمقاس المحتوى عند (0,0)', () => {
    const pdf = run({ widthMm: 80, heightMm: 0, marginsMm: { top: 9, right: 9, bottom: 9, left: 9 } }, 320, 640);
    expect(pdf.images[0]).toMatchObject({ x: 0, y: 0, w: 80 });
    expect(pdf.options.format[0]).toBe(80);
  });
});
