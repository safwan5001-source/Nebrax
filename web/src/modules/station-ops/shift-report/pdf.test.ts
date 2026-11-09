// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { inspectPdf } from '@/lib/__tests__/helpers/pdf-inspect';
import { buildStationCatalog } from '../catalog';
import { meter, nozzle, product, pump, tank } from '../__fixtures__';

const FONT = readFileSync(join(process.cwd(), 'public/fonts/NotoSansArabic-Regular.ttf'));
vi.stubGlobal('fetch', vi.fn(async (url: string) => {
  if (url !== '/fonts/NotoSansArabic-Regular.ttf') throw new Error(`unexpected fetch: ${url}`);
  const bytes = FONT.buffer.slice(FONT.byteOffset, FONT.byteOffset + FONT.byteLength);
  return { ok: true, arrayBuffer: async () => bytes } as unknown as Response;
}));

import { CATALOG, STATION, closedDetail, frozenCollection, translator } from './__fixtures__';
import { buildShiftReport, type ShiftReportInput, type ShiftReportModel } from './model';
import { createShiftReportPdf } from './pdf';

const PT_PER_MM = 72 / 25.4;
const hasPdftotext = (() => { try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const hasPoppler = (() => { try { execFileSync('pdftoppm', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; } })();

const base = (over: Partial<ShiftReportInput> = {}): ShiftReportInput => ({
  t: translator('en'), company: { name: 'Acme Fuel Co', vat_number: '300000000000003', cr_number: '1010101010' }, station: STATION,
  detail: closedDetail(), catalog: CATALOG, collection: frozenCollection(), viewer: { id: 'u1', name: 'Sami Operator' }, paper: 'a4', generatedAt: new Date('2026-11-03T14:00:00Z'), ...over,
});

/** وردية كبيرة: 12 مضخة × 4 فوهات بمنتجات متعددة (تفرض صفحات إضافية بدل القصّ). */
function bigShift() {
  const pumps = Array.from({ length: 12 }, (_, i) => pump(`pump${i + 1}`, 'a'));
  const products = [product('p1', 'Alpha'), product('p2', 'Beta'), product('p3', 'Gamma')];
  const tanks = [tank('t1', 'a', 'p1'), tank('t2', 'a', 'p2'), tank('t3', 'a', 'p3')];
  const nozzles = pumps.flatMap((p, i) => [0, 1, 2, 3].map((k) => nozzle(`n${i * 4 + k + 1}`, 'a', p.id, tanks[k % 3].id, `p${(k % 3) + 1}`)));
  const catalog = buildStationCatalog({ station: STATION, products, pumps, tanks, nozzles });
  const readings = nozzles.flatMap((n, i) => [meter(`o${i}`, n.id, 'opening', 1_000_000_000 + i * 17), meter(`c${i}`, n.id, 'closing', 1_000_000_000 + i * 17 + 123_456 + i)]);
  const total = nozzles.reduce((sum, _n, i) => sum + 123_456 + i, 0);
  return { catalog, detail: closedDetail({ meter_readings: readings, operational_meter_milliliters: total }) };
}

const pageMm = (info: ReturnType<typeof inspectPdf>, i = 0) => ({ w: info.mediaBoxes[i].widthPt / PT_PER_MM, h: info.mediaBoxes[i].heightPt / PT_PER_MM });
const bytes = async (blob: Blob) => Buffer.from(await blob.arrayBuffer());
const textOf = (buffer: Buffer): string => {
  const dir = mkdtempSync(join(tmpdir(), 'shift-pdf-'));
  try { writeFileSync(join(dir, 'a.pdf'), buffer); return execFileSync('pdftotext', ['-layout', join(dir, 'a.pdf'), '-'], { encoding: 'utf8' }); } finally { rmSync(dir, { recursive: true, force: true }); }
};
const OUT = process.env.PR7_EVIDENCE_DIR;
const keep = (name: string, buffer: Buffer) => { if (OUT) { mkdirSync(OUT, { recursive: true }); writeFileSync(join(OUT, name), buffer); } };

const flat = (model: ShiftReportModel): string[] => model.sections.flatMap((section) => {
  if (section.kind === 'kv') return section.rows.flatMap((row) => [row.label, row.value.text]);
  if (section.kind === 'table') return [...section.rows.flat().map((cell) => cell.text), ...(section.totals ?? []).map((cell) => cell.text)];
  if (section.kind === 'note') return [section.text];
  return section.cells.flatMap((cell) => [cell.role, ...(cell.name ? [cell.name.text] : [])]);
});

describe('shift report PDF (AWJ-DOC-V2-PR7)', () => {
  it.each([['ar'], ['en']] as const)('(10/11) A4 portrait detailed is one 210×297 vector page with a real text layer in %s', async (locale) => {
    const blob = await createShiftReportPdf(buildShiftReport(base({ t: translator(locale) })), locale);
    const buffer = await bytes(blob);
    keep(`shift-report-a4-${locale}.pdf`, buffer);
    const info = inspectPdf(buffer);
    expect(info.pageCount).toBe(1);
    expect(Math.abs(pageMm(info).w - 210)).toBeLessThan(0.5);
    expect(Math.abs(pageMm(info).h - 297)).toBeLessThan(0.5);
    expect(info.hasTextLayer).toBe(true);
    expect(info.images).toHaveLength(0);
  });

  it.each([['ar'], ['en']] as const)('(10/11) A5 landscape brief is 210×148 (≤ 2 pages) in %s', async (locale) => {
    const blob = await createShiftReportPdf(buildShiftReport(base({ t: translator(locale), paper: 'a5' })), locale);
    const buffer = await bytes(blob);
    keep(`shift-report-a5-${locale}.pdf`, buffer);
    const info = inspectPdf(buffer);
    // المختصر: صفحة أو صفحتان (التوقيعات لا تُقصّ ولا يُصغَّر النص لإجبارها على صفحة واحدة).
    expect(info.pageCount).toBeLessThanOrEqual(2);
    for (let i = 0; i < info.pageCount; i += 1) {
      expect(Math.abs(pageMm(info, i).w - 210)).toBeLessThan(0.5);
      expect(Math.abs(pageMm(info, i).h - 148)).toBeLessThan(0.5);
    }
    expect(info.hasTextLayer).toBe(true);
  });

  it('(6) a big shift (12 pumps × 4 nozzles) flows onto extra A4 pages instead of clipping, keeping the A4 size on every page', async () => {
    const { catalog, detail } = bigShift();
    const model = buildShiftReport(base({ catalog, detail }));
    const buffer = await bytes(await createShiftReportPdf(model, 'en'));
    keep('shift-report-a4-big-en.pdf', buffer);
    const info = inspectPdf(buffer);
    expect(info.pageCount).toBeGreaterThan(1);
    for (let i = 0; i < info.pageCount; i += 1) {
      expect(Math.abs(pageMm(info, i).w - 210)).toBeLessThan(0.5);
      expect(Math.abs(pageMm(info, i).h - 297)).toBeLessThan(0.5);
    }
    if (hasPdftotext) {
      const text = textOf(buffer);
      // كل فوهة (48) حاضرة بفرقها الدقيق؛ لا صف مفقود بسبب الانتقال بين الصفحات.
      expect((text.match(/123\.[45]\d\d/g) ?? []).length).toBeGreaterThanOrEqual(48);
    }
  });

  it('A5 stays one bounded page even for the big shift (brief omits the nozzle table)', async () => {
    const { catalog, detail } = bigShift();
    const info = inspectPdf(await bytes(await createShiftReportPdf(buildShiftReport(base({ catalog, detail, paper: 'a5' })), 'en')));
    expect(info.pageCount).toBeLessThanOrEqual(2);
    expect(Math.abs(pageMm(info).h - 148)).toBeLessThan(0.5);
  });

  it.skipIf(!hasPdftotext)('(11) preview ↔ PDF parity: every value the model carries appears in the PDF text layer (EN)', async () => {
    for (const paper of ['a4', 'a5'] as const) {
      const model = buildShiftReport(base({ paper }));
      const text = textOf(await bytes(await createShiftReportPdf(model, 'en'))).replace(/\s+/g, ' ');
      const missing = flat(model).filter((value) => value !== '' && !text.includes(value.replace(/\s+/g, ' ')));
      expect(missing, `values missing from the ${paper} PDF`).toEqual([]);
    }
  });

  it.skipIf(!hasPdftotext)('(7) exact large amounts and litres are printed digit-for-digit', async () => {
    const detail = closedDetail({ operational_meter_milliliters: 9_999_999_999_999, meter_readings: [meter('a', 'n1', 'opening', 0), meter('b', 'n1', 'closing', 9_999_999_999_999)] });
    const collection = frozenCollection({
      sales: { ...frozenCollection().sales, milliliters: 9_999_999_999_999, amount_minor: 99_999_999_999_999, products: [{ fuel_product_id: 'p1', name: 'Alpha', nozzle_count: 1, milliliters: 9_999_999_999_999, price_per_liter_minor: 12_345, price_source: 'x', amount_minor: 99_999_999_999_999, gaps: [] }] },
      reconciliation: { visible: true, final: true, reason: null, collected_total_minor: 99_999_999_999_999, sales_minor: 99_999_999_999_999, difference_minor: 0, direction: 'none' },
    });
    const text = textOf(await bytes(await createShiftReportPdf(buildShiftReport(base({ detail, collection })), 'en')));
    expect(text).toContain('9,999,999,999.999');
    expect(text).toContain('999,999,999,999.99');
  });

  it.skipIf(!hasPdftotext)('(8) the PDF of a viewer without sales permission carries no price/amount/difference text', async () => {
    const hidden = frozenCollection({
      review: { visible: false },
      sales: { ...frozenCollection().sales, visible: false, amount_minor: null, products: [{ fuel_product_id: 'p1', name: 'Alpha', nozzle_count: 2, milliliters: 790_500, gaps: [] }] },
      reconciliation: { visible: false },
    });
    const text = textOf(await bytes(await createShiftReportPdf(buildShiftReport(base({ collection: hidden })), 'en')));
    for (const forbidden of ['1,581.00', 'Price per litre', 'Sales due', 'Shortage', 'Overage']) expect(text).not.toContain(forbidden);
  });

  it.skipIf(!hasPdftotext)('Arabic PDF carries the Arabic title and Latin digits', async () => {
    const text = textOf(await bytes(await createShiftReportPdf(buildShiftReport(base({ t: translator('ar') })), 'ar')));
    expect(text).toMatch(/[؀-ۿ]/);
    expect(text).toContain('SH-100');
    expect(text).toContain('790.500');
    expect(text).not.toMatch(/[٠-٩]/);
  });

  it.skipIf(!hasPoppler)('renders to a non-blank raster page (visual smoke)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shift-png-'));
    try {
      writeFileSync(join(dir, 'a.pdf'), await bytes(await createShiftReportPdf(buildShiftReport(base()), 'en')));
      execFileSync('pdftoppm', ['-png', '-r', '40', join(dir, 'a.pdf'), join(dir, 'p')]);
      const png = readFileSync(join(dir, 'p-1.png'));
      expect(png.length).toBeGreaterThan(5_000);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
