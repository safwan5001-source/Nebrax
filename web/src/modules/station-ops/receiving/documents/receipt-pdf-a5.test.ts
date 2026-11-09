// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { inspectPdf } from '@/lib/__tests__/helpers/pdf-inspect';
import type { ReceiptDocument } from '../schemas';

const FONT = readFileSync(join(process.cwd(), 'public/fonts/NotoSansArabic-Regular.ttf'));
vi.stubGlobal('fetch', vi.fn(async (url: string) => {
  if (url !== '/fonts/NotoSansArabic-Regular.ttf') throw new Error(`unexpected fetch: ${url}`);
  const bytes = FONT.buffer.slice(FONT.byteOffset, FONT.byteOffset + FONT.byteLength);
  return { ok: true, arrayBuffer: async () => bytes } as unknown as Response;
}));

import { receiptLabels } from './labels';
import { createReceiptPdf } from './receipt-pdf';
import { createReceiptPdfA5 } from './receipt-pdf-a5';
import ar from '@/messages/ar.json';
import en from '@/messages/en.json';

type Tree = { [key: string]: string | Tree };
const lookup = (tree: Tree) => (key: string): string => {
  let cursor: string | Tree = (tree as unknown as { stationOps: Tree }).stationOps;
  for (const part of key.split('.')) { if (typeof cursor === 'string' || cursor === undefined) throw new Error(`missing message ${key}`); cursor = cursor[part]; }
  if (typeof cursor !== 'string') throw new Error(`missing message ${key}`);
  return cursor;
};

const PT_PER_MM = 72 / 25.4;
const hasPdftotext = (() => { try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const hasPoppler = (() => { try { execFileSync('pdftoppm', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; } })();

const short = (over: Partial<ReceiptDocument> = {}): ReceiptDocument => ({
  variant: 'operational', generated_at: '2026-11-06T10:00:00+00:00', generated_by: 'Sup Visor', company: { name: 'شركة أَوْج', vat_number: '300000000000003', cr_number: '1010101010', currency: 'SAR' },
  station: { code: 'ST1', name: 'محطة الدمام', city: 'الدمام', address: null }, reference: 'FD-AB12CD34', status: 'approved', delivery_note_number: 'DN-9', purchase_reference: 'PO-1',
  supplier: { name: 'مورد الوقود', code: 'S1' }, product: { code: 'P1', name: 'ديزل' }, tank: { code: 'T1', name: 'خزان 1' }, warehouse: { code: 'WH', name: 'مخزن المحطة' },
  tanker_identifier: 'TNK-1', driver_name: 'سائق', temperature_milli_celsius: null, density_kg_per_m3: null,
  quantities: { dispatched_liters: '10000', received_liters: '9995.5', transit_variance_liters: '-4.5', transit_variance_percent: '-0.05' },
  readings: { before_physical: { liters: '1000', measured_at: null }, after_physical: { liters: '10995.5', measured_at: null }, before_atg: null, after_atg: null },
  received_at: '2026-11-06T08:30:00+00:00', received_by: 'أحمد', approved_by: 'خالد', approved_at: '2026-11-06T09:00:00+00:00', notes: null,
  attachments: [{ name: 'note.pdf', mime_type: 'application/pdf', size: 10 }], ...over,
});

const LONG = 'Gulf Regional Industrial Supplies and Fuel Logistics Establishment for Advanced Projects';
const long = (over: Partial<ReceiptDocument> = {}): ReceiptDocument => short({
  variant: 'financial', company: { name: 'شركة نبراكس للعمليات المؤسسية والخدمات التجارية المتكاملة للأنظمة المالية', vat_number: '300000000000003', cr_number: '1010101010', currency: 'SAR' },
  station: { code: 'ST1', name: 'محطة الملك فهد الشرقية للخدمات البترولية المتكاملة بالدمام', city: 'الدمام', address: null },
  reference: 'FD-AB12CD34', delivery_note_number: 'DN-2026-000000123456789-LONG-REFERENCE-X', purchase_reference: 'PO-2026-GULF-REGIONAL-PROJECT-000987654321',
  supplier: { name: LONG, code: 'S1' }, product: { code: 'P1', name: 'ديزل منخفض الكبريت 10 جزء في المليون' }, tank: { code: 'T-01', name: 'خزان الديزل الرئيسي رقم واحد' },
  warehouse: { code: 'WH', name: 'مخزن المحطة الرئيسي' }, tanker_identifier: 'TNK-998877-ABC', driver_name: 'عبدالرحمن بن محمد العتيبي',
  quantities: { dispatched_liters: '1234567.891', received_liters: '1234500.5', transit_variance_liters: '-67.391', transit_variance_percent: '-0.0055' },
  readings: {
    before_physical: { liters: '1000.250', measured_at: null }, after_physical: { liters: '1235500.750', measured_at: null },
    before_atg: { liters: '1002.000', measured_at: null }, after_atg: { liters: '1235498.125', measured_at: null },
  },
  notes: 'ملاحظات الاستلام: تم الاستلام بحضور مشرف المحطة وسائق الناقلة، وتمت مطابقة ختم العدّاد ورقم الناقلة مع سند المورد، والعيّنة سليمة ولا ملاحظات على الجودة. '.repeat(2),
  attachments: Array.from({ length: 5 }, (_, i) => ({ name: `delivery-note-${i + 1}.pdf`, mime_type: 'application/pdf', size: 10 })),
  cost: { currency: 'SAR', total_minor: 123_456_789_012, per_liter: '1.0000', recorded_by: 'المالية', recorded_at: null },
  ...over,
});

const pageSizeMm = (info: ReturnType<typeof inspectPdf>, i = 0) => ({ w: info.mediaBoxes[i].widthPt / PT_PER_MM, h: info.mediaBoxes[i].heightPt / PT_PER_MM });
const bytes = async (blob: Blob) => Buffer.from(await blob.arrayBuffer());

describe('receipt PDF A5 landscape (AWJ-DOC-V2-PR6)', () => {
  it.each([['ar', ar], ['en', en]] as const)('short operational voucher is a single 210×148 page with a real text layer in %s', async (locale, messages) => {
    const labels = receiptLabels(lookup(messages as unknown as Tree));
    const blob = await createReceiptPdfA5(short(), labels, locale);
    const info = inspectPdf(await bytes(blob));
    expect(info.pageCount).toBe(1);
    expect(Math.abs(pageSizeMm(info).w - 210)).toBeLessThan(0.5);
    expect(Math.abs(pageSizeMm(info).h - 148)).toBeLessThan(0.5);
    expect(info.hasTextLayer).toBe(true);
    expect(info.images).toHaveLength(0); // متجهي: لا صورة ملتقطة
  });

  it.each([['ar', ar], ['en', en]] as const)('long financial voucher (large decimal litres, long references, long notes) keeps the A5 size and stays bounded in %s', async (locale, messages) => {
    const labels = receiptLabels(lookup(messages as unknown as Tree));
    const info = inspectPdf(await bytes(await createReceiptPdfA5(long(), labels, locale)));
    expect(info.pageCount).toBeGreaterThanOrEqual(1);
    expect(info.pageCount).toBeLessThanOrEqual(2);
    for (let i = 0; i < info.pageCount; i += 1) {
      expect(Math.abs(pageSizeMm(info, i).w - 210)).toBeLessThan(0.5);
      expect(Math.abs(pageSizeMm(info, i).h - 148)).toBeLessThan(0.5);
    }
  });

  it('A4 historical voucher is unchanged: portrait 210×297 single page', async () => {
    const labels = receiptLabels(lookup(en as unknown as Tree));
    const info = inspectPdf(await bytes(await createReceiptPdf(short(), labels, 'en')));
    expect(info.pageCount).toBe(1);
    expect(Math.abs(pageSizeMm(info).w - 210)).toBeLessThan(0.5);
    expect(Math.abs(pageSizeMm(info).h - 297)).toBeLessThan(0.5);
  });

  it('operational payload has no cost key and the A5 drawer draws cost only when the payload carries it', () => {
    const source = readFileSync(join(__dirname, 'receipt-pdf-a5.ts'), 'utf8');
    expect(source).toMatch(/if \(doc\.cost\) \{/);
    expect(source).not.toMatch(/total_minor[^\n]*\?\?|unit_cost|unit_price|\bvat_rate|\* 100\b|toFixed\(2\)/); // لا حساب مالي في الرسم (الكميات والمبالغ من الخادم)
    expect(source.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/from '@\/lib\/api'|\bfetch\(|axios|XMLHttpRequest/);
  });

  it.skipIf(!hasPdftotext)('extracts the real values as text (reference, delivery note, litres with 3 decimals, dates, station) in English', async () => {
    const labels = receiptLabels(lookup(en as unknown as Tree));
    const doc = short({ station: { code: 'ST1', name: 'Dammam Station', city: null, address: null }, supplier: { name: 'Fuel Supplier Co', code: 'S1' }, product: { code: 'P1', name: 'Diesel' }, tank: { code: 'T1', name: 'Tank 1' }, received_by: 'Ahmed', approved_by: 'Khaled', driver_name: 'Driver One', notes: 'Received in presence of supervisor.' });
    const dir = mkdtempSync(join(tmpdir(), 'pr6-a5-'));
    try {
      writeFileSync(join(dir, 'a.pdf'), await bytes(await createReceiptPdfA5(doc, labels, 'en')));
      const text = execFileSync('pdftotext', ['-layout', join(dir, 'a.pdf'), '-'], { encoding: 'utf8' });
      for (const expected of ['FD-AB12CD34', 'DN-9', 'PO-1', '10,000.000', '9,995.500', '-4.500', '1,000.000', '10,995.500', 'Dammam Station', 'Fuel Supplier Co', 'Diesel', 'Tank 1', 'Ahmed', 'Khaled', 'Driver One', 'Received in presence of supervisor.', '2026-11-06', 'Operational version']) {
        expect(text, `مفقود: ${expected}`).toContain(expected);
      }
      expect(text).not.toMatch(/Total cost|Average cost/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(!hasPdftotext)('financial A5 voucher carries the cost block; operational never does', async () => {
    const labels = receiptLabels(lookup(en as unknown as Tree));
    const dir = mkdtempSync(join(tmpdir(), 'pr6-a5-'));
    try {
      writeFileSync(join(dir, 'f.pdf'), await bytes(await createReceiptPdfA5(long({ notes: null }), labels, 'en')));
      writeFileSync(join(dir, 'o.pdf'), await bytes(await createReceiptPdfA5(long({ variant: 'operational', cost: undefined, notes: null }), labels, 'en')));
      const text = (name: string) => execFileSync('pdftotext', ['-layout', join(dir, name), '-'], { encoding: 'utf8' });
      expect(text('f.pdf')).toContain('1,234,567,890.12');
      expect(text('f.pdf')).toContain('1,234,567.891');
      expect(text('o.pdf')).not.toMatch(/1,234,567,890\.12|Total cost/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // أدلة بصرية اختيارية: PR6_OUT=/path يكتب PDF/PNG لـ A4 وA5 (قصير/طويل × عربي/إنجليزي) للمراجعة والتقرير.
  it.skipIf(!process.env.PR6_OUT)('writes A4/A5 sample PDFs for visual review', async () => {
    const out = process.env.PR6_OUT as string;
    mkdirSync(out, { recursive: true });
    for (const [locale, messages] of [['ar', ar], ['en', en]] as const) {
      const labels = receiptLabels(lookup(messages as unknown as Tree));
      for (const [name, doc] of [['short', short()], ['long', long()], ['draft', short({ status: 'draft', approved_by: null, approved_at: null, readings: { before_physical: null, after_physical: null, before_atg: null, after_atg: null }, attachments: [] })]] as const) {
        writeFileSync(join(out, `a5-${name}-${locale}.pdf`), await bytes(await createReceiptPdfA5(doc, labels, locale)));
        writeFileSync(join(out, `a4-${name}-${locale}.pdf`), await bytes(await createReceiptPdf(doc, labels, locale)));
      }
    }
    if (hasPoppler) for (const file of ['a5-short-ar', 'a5-long-ar', 'a5-short-en', 'a5-long-en', 'a5-draft-ar', 'a4-short-ar', 'a4-long-en']) execFileSync('pdftoppm', ['-png', '-r', '110', join(out, `${file}.pdf`), join(out, file)]);
    expect(true).toBe(true);
  });
});
