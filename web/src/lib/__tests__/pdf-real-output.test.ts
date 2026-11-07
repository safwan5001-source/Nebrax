import { jsPDF } from 'jspdf';
import { describe, expect, it } from 'vitest';
import { buildPdfBlob, getPdfImageSlices, type PdfPaper } from '@/lib/pdf';
import { inspectPdf, type InspectedImage } from './helpers/pdf-inspect';
import { DOC_WIDTH, makeSyntheticDocument, type SyntheticDocument } from './helpers/synthetic-document';

/**
 * انحدار PDF الحقيقي (AWJ-DOC-V2-PR1): يُولَّد ملف PDF فعلي بـ jsPDF الحقيقي من مستند اصطناعي
 * بدقة التصدير الفعلية، ثم يُفحص ما كُتب في الملف (عدد الصفحات، الحجم، البكسلات المضمّنة).
 * الاختبار مستقل عن المتصفح: يغطي طبقة التجميع والضغط والتقطيع التي يستعملها `documentExporter`.
 */
const A4: PdfPaper = { widthMm: 210, heightMm: 297 };
const PAGE_PX = Math.round((A4.heightMm * DOC_WIDTH) / A4.widthMm); // 2246

const toBuffer = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

async function render(doc: SyntheticDocument, options: { compress?: boolean } = {}) {
  const Ctor = options.compress === false
    ? (class extends jsPDF { constructor(o: ConstructorParameters<typeof jsPDF>[0]) { super({ ...(o as object), compress: false } as never); } } as typeof jsPDF)
    : jsPDF;
  const contentHeight = doc.height - Math.max(0, doc.trailingBlank - 16);
  const blob = buildPdfBlob(Ctor, doc.raster, A4, doc.safeBreaks, contentHeight);
  return inspectPdf(await toBuffer(blob));
}

/** يلصق صور الصفحات رأسياً ويقارنها بالمصدر صفاً صفاً (فقد صفر = لا تلف للنص/الشعار/QR/الباركود). */
function stitchedMatchesSource(images: InspectedImage[], doc: SyntheticDocument): { equal: boolean; rows: number } {
  let cursor = 0;
  for (const image of images) {
    expect(image.width).toBe(doc.width);
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const s = ((cursor + y) * doc.width + x) * 4;
        const t = (y * image.width + x) * 3;
        if (image.rgb[t] !== doc.rgba[s] || image.rgb[t + 1] !== doc.rgba[s + 1] || image.rgb[t + 2] !== doc.rgba[s + 2]) {
          return { equal: false, rows: cursor + y };
        }
      }
    }
    cursor += image.height;
  }
  return { equal: true, rows: cursor };
}

/** نسبة الحبر في صفحة (للتحقق أن الصفحة الأخيرة ليست يتيمة). */
function inkRatio(image: InspectedImage): number {
  let ink = 0;
  for (let i = 0; i < image.rgb.length; i += 3) if (image.rgb[i] < 250 || image.rgb[i + 1] < 250 || image.rgb[i + 2] < 250) ink += 1;
  return ink / (image.width * image.height);
}

describe('PDF الحقيقي — الضغط (DOC-P0-1)', () => {
  it('الفاتورة القصيرة: صفحة واحدة وحجم أقل بكثير من خط الأساس غير المضغوط', async () => {
    const doc = makeSyntheticDocument({ rows: 6, trailingBlank: 700 });
    const after = await render(doc);
    const before = await render(doc, { compress: false });

    expect(after.pageCount).toBe(1);
    expect(after.mediaBoxes[0].widthPt).toBeCloseTo(595.28, 1);
    expect(after.mediaBoxes[0].heightPt).toBeCloseTo(841.89, 1);
    expect(before.hasUncompressedImages || before.bytes > 3_000_000).toBe(true);
    expect(after.hasUncompressedImages).toBe(false);
    // القياس الفعلي في التقرير: ~23× على التقاط حقيقي؛ هنا نشترط ≥ 10× كحدّ انحدار.
    expect(before.bytes / after.bytes).toBeGreaterThan(10);
    expect(after.bytes).toBeLessThan(1_000_000);
  });

  it('الفاتورة الطويلة: الحجم يتناسب مع الصفحات (≤ 0.6 MB للصفحة) لا 5.6 MB', async () => {
    const doc = makeSyntheticDocument({ rows: 45, trailingBlank: 500 });
    const after = await render(doc);
    expect(after.pageCount).toBeGreaterThanOrEqual(3);
    expect(after.bytes / after.pageCount).toBeLessThan(600_000);
  });

  it('الضغط بلا فقد: كل بكسل في الصفحات (نص/شعار/QR/باركود/توقيع) مطابق للمصدر', async () => {
    const doc = makeSyntheticDocument({ rows: 30, trailingBlank: 600 });
    const result = await render(doc);
    const content = doc.height - (doc.trailingBlank - 16);
    const comparison = stitchedMatchesSource(result.images, doc);
    expect(comparison.equal).toBe(true);
    // الصفحات تغطي كامل المحتوى (حتى نهاية الحبر + هامش الأمان) بلا فجوة ولا تكرار.
    expect(comparison.rows).toBe(content);
    // آخر منطقة (التذييل) داخل التغطية.
    const footer = doc.regions.find((r) => r.name === 'footer')!;
    expect(footer.top + footer.height).toBeLessThanOrEqual(comparison.rows);
  });
});

/** خوارزمية التقطيع قبل هذا PR (مرجع قياس «قبل/بعد» داخل الاختبار نفسه). */
function legacySlices(imageHeight: number, pageHeight: number, safeBreaks: readonly number[]) {
  const breaks = [...new Set(safeBreaks)].filter((p) => p > 0 && p < imageHeight).sort((l, r) => l - r);
  const out: Array<{ top: number; height: number }> = [];
  let top = 0;
  while (top < imageHeight) {
    const nominalEnd = Math.min(top + pageHeight, imageHeight);
    const candidate = breaks.filter((p) => p > top && p <= nominalEnd).at(-1);
    const end = candidate && candidate - top >= Math.max(pageHeight * 0.25, 48) ? candidate : nominalEnd;
    out.push({ top, height: end - top });
    top = end;
  }
  return out;
}

const ORPHAN_CASES: ReadonlyArray<readonly [string, number, number]> = [
  ['قصير جداً', 3, 900],
  ['يتّسع بالكاد في صفحة', 12, 0],
  ['صفحتان', 28, 650],
  ['ثلاث صفحات', 52, 800],
  ['طويل (5+ صفحات)', 105, 400],
];

describe('PDF الحقيقي — الصفحات اليتيمة (DOC-P1-1)', () => {
  it.each(ORPHAN_CASES)('%s: لا صفحة بلا حبر ولا صفحة أخيرة يتيمة', async (_label, rows, blank) => {
    const doc = makeSyntheticDocument({ rows, trailingBlank: blank, seed: rows });
    const result = await render(doc);
    const last = result.images[result.images.length - 1];

    for (const image of result.images) expect(inkRatio(image)).toBeGreaterThan(0.002);
    // الصفحة الأخيرة تحمل محتوى ذا معنى (إجماليات/توقيع/تذييل معاً) لا سطر تذييل وحيداً
    if (result.pageCount > 1) expect(last.height).toBeGreaterThanOrEqual(PAGE_PX * 0.08);
    // عدد الصفحات = ما يلزم المحتوى فعلاً (بلا صفحة زائدة)
    const needed = Math.ceil((doc.height - Math.max(0, blank - 16)) / PAGE_PX);
    expect(result.pageCount).toBeLessThanOrEqual(needed + 1);
  });

  it('قبل/بعد: الخوارزمية القديمة تُنتج صفحات زائدة أو هزيلة في العينات نفسها والجديدة لا تفعل', () => {
    let legacyExtra = 0;
    for (const [, rows, blank] of ORPHAN_CASES) {
      const doc = makeSyntheticDocument({ rows, trailingBlank: blank, seed: rows });
      const content = doc.height - Math.max(0, blank - 16);
      const before = legacySlices(doc.height, PAGE_PX, doc.safeBreaks); // بلا قصّ فراغ، كما كان
      const after = getPdfImageSlices(content, PAGE_PX, doc.safeBreaks);
      const tail = (slices: typeof before) => slices[slices.length - 1].height;
      if (before.length > after.length || (before.length > 1 && tail(before) < PAGE_PX * 0.08)) legacyExtra += 1;
      expect(after.length).toBeLessThanOrEqual(before.length);
      if (after.length > 1) expect(tail(after)).toBeGreaterThanOrEqual(PAGE_PX * 0.08);
    }
    expect(legacyExtra).toBeGreaterThan(0); // الاختبار حسّاس: يلتقط العلّة القديمة فعلاً
  });

  it('المحتوى الذي يتّسع في صفحة لا يُقطع عند حد داخلي (التذييل اليتيم القديم)', () => {
    const doc = makeSyntheticDocument({ rows: 12, trailingBlank: 0 });
    expect(doc.height).toBeLessThanOrEqual(PAGE_PX + 2);
    expect(doc.safeBreaks.length).toBeGreaterThan(5);
    expect(getPdfImageSlices(doc.height, PAGE_PX, doc.safeBreaks)).toHaveLength(1);
  });

  it('حدود الصفحات عند نهايات الصفوف: لا صف مقطوع بين صفحتين', () => {
    const doc = makeSyntheticDocument({ rows: 60, trailingBlank: 300 });
    const slices = getPdfImageSlices(doc.height - (doc.trailingBlank - 16), PAGE_PX, doc.safeBreaks);
    const breaks = new Set(doc.safeBreaks);
    for (const slice of slices.slice(0, -1)) expect(breaks.has(slice.top + slice.height)).toBe(true);
  });
});

describe('PDF الحقيقي — المقاسات والحراري (لا تراجع)', () => {
  it('A4 يبقى 595.28×841.89pt لكل صفحة', async () => {
    const result = await render(makeSyntheticDocument({ rows: 40, trailingBlank: 200 }));
    expect(result.mediaBoxes.length).toBe(result.pageCount);
    for (const box of result.mediaBoxes) {
      expect(box.widthPt).toBeCloseTo(595.28, 1);
      expect(box.heightPt).toBeCloseTo(841.89, 1);
    }
  });

  it('الحراري 80mm: صفحة واحدة بارتفاع المحتوى الكامل بلا قصّ ولا ترقيم صفحات', async () => {
    const doc = makeSyntheticDocument({ rows: 12, trailingBlank: 500 });
    const thermal: PdfPaper = { widthMm: 80, heightMm: 0 };
    const blob = buildPdfBlob(jsPDF, doc.raster, thermal, doc.safeBreaks, doc.height - 400);
    const result = inspectPdf(await toBuffer(blob));
    expect(result.pageCount).toBe(1);
    expect(result.mediaBoxes[0].widthPt).toBeCloseTo((80 / 25.4) * 72, 1);
    // ارتفاع الصفحة = ارتفاع الصورة كاملاً (الفراغ الختامي لا يُقصّ في الحراري — سلوك كما كان)
    const expectedHeightPt = ((doc.height * 80) / doc.width / 25.4) * 72;
    expect(result.mediaBoxes[0].heightPt).toBeCloseTo(expectedHeightPt, 0);
    expect(result.images[0].height).toBe(doc.height);
    expect(stitchedMatchesSource(result.images, doc).equal).toBe(true);
    expect(result.hasUncompressedImages).toBe(false);
  });
});

describe('فجوة معلنة (لا يعالجها هذا PR)', () => {
  it('GAP DOC-P0-1: PDF الصورة بلا طبقة نص — الضغط لا يعالج غياب النص القابل للبحث', async () => {
    const result = await render(makeSyntheticDocument({ rows: 8 }));
    // قرار معماري لاحق (تقرير التدقيق §8 / ZATCA CON-09). إن ظهر نص هنا يُراجَع التقرير والاختبار معاً.
    expect(result.hasTextLayer).toBe(false);
  });
});
