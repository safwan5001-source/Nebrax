// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ReceiptDocument, ReceiptReport } from '../schemas';
import { dateText, hasArabic, litersText, minorText } from './pdf-kit';

const FONT = readFileSync(join(process.cwd(), 'public/fonts/NotoSansArabic-Regular.ttf'));

/** fetch للخط الثابت فقط — يحاكي خدمة الأصول؛ أي طلب آخر يفشل الاختبار (لا شبكة API في المستندات). */
vi.stubGlobal('fetch', vi.fn(async (url: string) => {
  if (url !== '/fonts/NotoSansArabic-Regular.ttf') throw new Error(`unexpected fetch: ${url}`);
  const bytes = FONT.buffer.slice(FONT.byteOffset, FONT.byteOffset + FONT.byteLength);
  return { ok: true, arrayBuffer: async () => bytes } as unknown as Response;
}));

import { receiptLabels, reportLabels } from './labels';
import { createReceiptPdf } from './receipt-pdf';
import { createReportPdf } from './report-pdf';
import ar from '@/messages/ar.json';
import en from '@/messages/en.json';

type Tree = { [key: string]: string | Tree };
const lookup = (tree: Tree) => (key: string): string => {
  let cursor: string | Tree = (tree as unknown as { stationOps: Tree }).stationOps;
  for (const part of key.split('.')) { if (typeof cursor === 'string' || cursor === undefined) throw new Error(`missing message ${key}`); cursor = cursor[part]; }
  if (typeof cursor !== 'string') throw new Error(`missing message ${key}`);
  return cursor;
};

const doc = (over: Partial<ReceiptDocument> = {}): ReceiptDocument => ({
  variant: 'operational', generated_at: '2026-11-06T10:00:00+00:00', generated_by: 'Sup Visor', company: { name: 'شركة أَوْج', vat_number: '300000000000003', cr_number: '1010101010', currency: 'SAR' },
  station: { code: 'ST1', name: 'محطة الدمام', city: 'الدمام', address: null }, reference: 'FD-AB12CD34', status: 'approved', delivery_note_number: 'DN-9', purchase_reference: 'PO-1',
  supplier: { name: 'مورد الوقود', code: 'S1' }, product: { code: 'P1', name: 'ديزل' }, tank: { code: 'T1', name: 'خزان 1' }, warehouse: { code: 'WH', name: 'مخزن المحطة' },
  tanker_identifier: 'TNK-1', driver_name: 'سائق', temperature_milli_celsius: null, density_kg_per_m3: null,
  quantities: { dispatched_liters: '10000', received_liters: '9995.5', transit_variance_liters: '-4.5', transit_variance_percent: '-0.05' },
  readings: { before_physical: { liters: '1000', measured_at: null }, after_physical: { liters: '10995.5', measured_at: null }, before_atg: null, after_atg: null },
  received_at: '2026-11-06T08:30:00+00:00', received_by: 'أحمد', approved_by: 'خالد', approved_at: '2026-11-06T09:00:00+00:00', notes: 'ملاحظة',
  attachments: [{ name: 'note.pdf', mime_type: 'application/pdf', size: 10 }], ...over,
});

describe('pdf-kit formatting (0–9 digits, integer maths, no float)', () => {
  it('formats litres with three decimals and grouping, and money from minor units', () => {
    expect(litersText('9995.5')).toBe('9,995.500');
    expect(litersText('-4.5')).toBe('-4.500');
    expect(litersText('10')).toBe('10.000');
    expect(litersText(null)).toBe('—');
    expect(minorText(500_050)).toBe('5,000.50');
    expect(minorText(5)).toBe('0.05');
    expect(minorText(-1234)).toBe('-12.34');
    expect(minorText(null)).toBe('—');
    expect(dateText('not-a-date')).toBe('not-a-date');
    expect(hasArabic('ديزل')).toBe(true);
    expect(hasArabic('DN-9')).toBe(false);
  });
});

describe('receipt PDF (real jsPDF + Arabic font)', () => {
  it.each([['ar', ar], ['en', en]] as const)('renders an operational and a financial voucher without throwing in %s', async (locale, messages) => {
    const t = lookup(messages as unknown as Tree);
    const operational = await createReceiptPdf(doc(), receiptLabels(t), locale);
    const financial = await createReceiptPdf(doc({ variant: 'financial', cost: { currency: 'SAR', total_minor: 500_050, per_liter: '0.5003', recorded_by: 'المالية', recorded_at: null } }), receiptLabels(t), locale);
    for (const blob of [operational, financial]) {
      expect(blob.type).toBe('application/pdf');
      const head = Buffer.from(await blob.arrayBuffer()).subarray(0, 5).toString('latin1');
      expect(head).toBe('%PDF-');
    }
    expect(financial.size).toBeGreaterThan(operational.size); // كتلة التكلفة إضافية فقط في المالية
  });

  it('renders a draft with no readings, no notes, no attachments and a missing cost', async () => {
    const t = lookup(en as unknown as Tree);
    const blob = await createReceiptPdf(doc({ status: 'draft', approved_by: null, approved_at: null, notes: null, attachments: [], readings: { before_physical: null, after_physical: null, before_atg: null, after_atg: null }, variant: 'financial', cost: { currency: 'SAR', total_minor: null, per_liter: null, recorded_by: null, recorded_at: null } }), receiptLabels(t), 'en');
    expect(blob.size).toBeGreaterThan(1000);
  });
});

describe('report PDF (real jsPDF)', () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({
    reference: `FD-${i}`, received_at: '2026-11-06T08:30:00+00:00', status: i % 2 ? 'approved' : 'draft', delivery_note_number: `DN-${i}`, station: 'محطة', supplier: 'مورد', product: 'ديزل', tank: 'T1',
    dispatched_liters: '100', received_liters: '99.5', transit_variance_liters: '-0.5', total_cost_minor: i % 3 ? 123_456 : null,
  }));
  const report = (variant: 'operational' | 'financial'): ReceiptReport => ({
    variant, generated_at: '2026-11-06T10:00:00+00:00', generated_by: 'x', company: { name: 'أَوْج', vat_number: null, cr_number: null, currency: 'SAR' }, filters: { q: 'DN', status: 'draft' }, truncated: true,
    rows: variant === 'financial' ? rows : rows.map(({ total_cost_minor: _drop, ...rest }) => rest),
    totals: { count: 60, dispatched_liters: '6000', received_liters: '5970', transit_variance_liters: '-30', ...(variant === 'financial' ? { total_cost_minor: 7_000_000, uncosted_count: 20 } : {}) },
  });

  it.each(['ar', 'en'] as const)('paginates 60 rows in %s for both versions', async (locale) => {
    const t = lookup((locale === 'ar' ? ar : en) as unknown as Tree);
    for (const variant of ['operational', 'financial'] as const) {
      const blob = await createReportPdf(report(variant), reportLabels(t), locale);
      const text = Buffer.from(await blob.arrayBuffer()).toString('latin1');
      expect(text.startsWith('%PDF-')).toBe(true);
      expect((text.match(/\/Type\s*\/Page\b/g) ?? []).length).toBeGreaterThan(1);
    }
  });

  it('an empty statement still renders', async () => {
    const t = lookup(en as unknown as Tree);
    const blob = await createReportPdf({ ...report('operational'), rows: [], truncated: false, totals: { count: 0, dispatched_liters: '0', received_liters: '0', transit_variance_liters: '0' } }, reportLabels(t), 'en');
    expect(blob.size).toBeGreaterThan(500);
  });
});

describe('operational documents never carry money (source guard)', () => {
  it('the operational branch of the voucher and statement has no cost key in the payload schema path', () => {
    const receipt = readFileSync(join(__dirname, 'receipt-pdf.ts'), 'utf8');
    expect(receipt).toMatch(/if \(doc\.cost\) \{/); // التكلفة تُرسم فقط إن حملتها الحمولة (الخادم يحذفها من التشغيلية)
    const report = readFileSync(join(__dirname, 'report-pdf.ts'), 'utf8');
    expect(report).toMatch(/if \(financial\) cols\.push/);
  });

  it('documents never call the API: the only fetch is the static Arabic font', () => {
    for (const file of ['pdf-kit.ts', 'receipt-pdf.ts', 'report-pdf.ts', 'labels.ts', 'share.ts']) {
      const code = readFileSync(join(__dirname, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
      expect(code, file).not.toMatch(/from '@\/lib\/api'|api\s*[<(]|axios|XMLHttpRequest/);
      const fetches = [...code.matchAll(/\bfetch\(([^)]*)\)/g)].map((match) => match[1]);
      if (file === 'pdf-kit.ts') expect(fetches).toEqual(["'/fonts/NotoSansArabic-Regular.ttf'"]);
      else if (file === 'share.ts') expect(fetches).toEqual(['url']);
      else expect(fetches, file).toEqual([]);
    }
  });
});
