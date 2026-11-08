// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { inspectPdf } from '@/lib/__tests__/helpers/pdf-inspect';

const FONT = readFileSync(join(process.cwd(), 'public/fonts/NotoSansArabic-Regular.ttf'));
vi.stubGlobal('fetch', vi.fn(async (url: string) => {
  if (url !== '/fonts/NotoSansArabic-Regular.ttf') throw new Error(`unexpected fetch: ${url}`);
  const bytes = FONT.buffer.slice(FONT.byteOffset, FONT.byteOffset + FONT.byteLength);
  return { ok: true, arrayBuffer: async () => bytes } as unknown as Response;
}));

import { payload, definition } from './__fixtures__';
import { createReportPdf, PDF_ROW_CAP } from './report-pdf';
import type { ReportPayload } from './schemas';

const bytes = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());
const MM = 72 / 25.4;

function manyRows(count: number): ReportPayload {
  const base = payload();
  const table = base.tables[0];
  return { ...base, tables: [{ ...table, rows: Array.from({ length: count }, (_, i) => ({ period: '2027-03-10', station: `محطة ${i}`, shifts: 1, liters: 1000 + i, amount: 230 + i })), totals: { shifts: count, liters: 1, amount: 1 } }] };
}

describe('PDF التقارير — ملف حقيقي بـ jsPDF', () => {
  it('A4 أفقي بالعربية: ملف PDF صالح بصفحة واحدة ومقاس A4 أفقي', async () => {
    const pdf = await inspectPdf(await bytes(await createReportPdf(payload(), { lang: 'ar', paper: 'a4_landscape', company: { name: 'شركة أَوْج', vat: '300000000000003' }, generatedBy: 'مدير' })));
    expect(pdf.pageCount).toBe(1);
    expect(pdf.mediaBoxes[0].widthPt).toBeCloseTo(297 * MM, 0);
    expect(pdf.mediaBoxes[0].heightPt).toBeCloseTo(210 * MM, 0);
  });

  it('A4 عمودي (توجيه التقرير) بالإنجليزية', async () => {
    const portrait = payload({ report: definition({ orientation: 'portrait' }) });
    const pdf = await inspectPdf(await bytes(await createReportPdf(portrait, { lang: 'en', paper: 'a4' })));
    expect(pdf.mediaBoxes[0].widthPt).toBeCloseTo(210 * MM, 0);
    expect(pdf.mediaBoxes[0].heightPt).toBeCloseTo(297 * MM, 0);
  });

  it('الجدول الطويل يمتد على صفحات متعددة ويرقَّم', async () => {
    const pdf = await inspectPdf(await bytes(await createReportPdf(manyRows(140), { lang: 'ar', paper: 'a4' })));
    expect(pdf.pageCount).toBeGreaterThan(2);
  });

  it('سقف صفوف PDF محفوظ: لا يتضخم الملف بلا حد', async () => {
    expect(PDF_ROW_CAP).toBe(4000);
  });

  it.each([['thermal_80', 80], ['thermal_58', 58]] as const)('حراري %s: عرض الورق بالمم وصفحة واحدة بارتفاع يطابق المحتوى', async (paper, width) => {
    const thermal = payload({ report: definition({ key: 'shifts.closing', thermal: true, orientation: 'portrait' }) });
    const pdf = await inspectPdf(await bytes(await createReportPdf(thermal, { lang: 'ar', paper })));
    expect(pdf.pageCount).toBe(1);
    expect(pdf.mediaBoxes[0].widthPt).toBeCloseTo(width * MM, 0);
    expect(pdf.mediaBoxes[0].heightPt).toBeLessThan(400 * MM);
    expect(pdf.mediaBoxes[0].heightPt).toBeGreaterThan(40 * MM);
  });

  it('الحراري يطول بزيادة الصفوف (القياس حقيقي لا ثابت)', async () => {
    const shortDoc = payload({ report: definition({ thermal: true }) });
    const a = await inspectPdf(await bytes(await createReportPdf(shortDoc, { lang: 'en', paper: 'thermal_80' })));
    const longDoc = { ...manyRows(20), report: definition({ thermal: true }) };
    const b = await inspectPdf(await bytes(await createReportPdf(longDoc, { lang: 'en', paper: 'thermal_80' })));
    expect(b.mediaBoxes[0].heightPt).toBeGreaterThan(a.mediaBoxes[0].heightPt);
  });

  it('بيانات ناقصة وجدول فارغ لا يكسران الرسم', async () => {
    const empty = payload({ tables: [{ ...payload().tables[0], rows: [], totals: null }], summary: [], data_quality: { complete: false, gaps: ['missing_reading'], notes: [] } });
    const pdf = await inspectPdf(await bytes(await createReportPdf(empty, { lang: 'ar', paper: 'a4' })));
    expect(pdf.pageCount).toBe(1);
  });
});
