import { PAPER_SIZES } from '@/modules/documents/constants/paper';
import type { PaperSizeId } from '@/modules/documents/types';
import { fitText, filled, line, newPdf, text, type PdfDoc } from '@/modules/station-ops/receiving/documents/pdf-kit';
import { cellText, dateTimeText, summaryText, type Lang } from './format';
import type { ReportColumn, ReportPayload, ReportTable } from './schemas';

/**
 * HORIZON-REPORTS — رسم PDF لأي تقرير وقود من **الحمولة نفسها** (لا طلب ثانٍ ولا حساب مالي هنا): A4 عمودي/أفقي أو إيصال حراري 58/80مم.
 * التحويل الوحيد وحدات العرض (`format.ts`)؛ الأعمدة المحجوبة بالصلاحية غير موجودة أصلاً في الحمولة فلا تظهر.
 * الخط: Noto Sans Arabic مضمَّن في الملف (عبر `pdf-kit`)؛ اللاتيني والأرقام Helvetica. RTL للعربية.
 * التحمل: ترقيم الصفحات، تكرار رأس الجدول، سطر إجمالي، تذييل بالفاعل والوقت. ملف كبير: السقف 4000 صف في الـPDF (الباقي في Excel/CSV).
 */

/**
 * معرّفات الورق وأبعاده من البنية المشتركة لمنصة المستندات (`PAPER_SIZES` / `PaperSizeId`) — لا جدول مقاسات موازٍ هنا.
 * التقارير تدعم منها فقط: A4 عمودي/أفقي والحراري 58/80 (باقي المقاسات تحتاج تخطيط جدول مُثبَتاً لكل منها).
 */
export type Paper = Extract<PaperSizeId, 'a4' | 'a4_landscape' | 'thermal_58' | 'thermal_80'>;
export const REPORT_PAPERS: readonly Paper[] = ['a4', 'a4_landscape', 'thermal_80', 'thermal_58'];
export const isThermal = (paper: Paper): boolean => paper.startsWith('thermal');

/** الورق الافتراضي من توجيه تعريف التقرير. */
export const defaultPaper = (orientation: 'portrait' | 'landscape'): Paper => (orientation === 'landscape' ? 'a4_landscape' : 'a4');
export interface PdfCompany { name?: string | null; vat?: string | null; cr?: string | null; logo?: string | null }
export interface PdfOptions { lang: Lang; paper: Paper; company?: PdfCompany; generatedBy?: string | null }

export const PDF_ROW_CAP = 4000;
export const THERMAL_ROW_CAP = 80;
/** حد ارتفاع الإيصال الحراري (jsPDF يقصّ الصفحة عند 5080مم) وهامش محجوز للإجماليات والتحذيرات. */
export const THERMAL_MAX_MM = 4800;
const THERMAL_RESERVE_MM = 90;
const NAVY: [number, number, number] = [15, 39, 72];
const MUTED: [number, number, number] = [107, 114, 128];

const T = {
  ar: { company: 'المؤسسة', stations: 'المحطات', period: 'الفترة', current: 'الحالة الراهنة', generated: 'وقت الإنشاء', by: 'بواسطة', page: 'صفحة', total: 'الإجمالي', empty: 'لا توجد بيانات', incomplete: 'بيانات غير مكتملة — راجع الملاحظات', source: 'المصدر', truncatedPdf: 'اقتُطع الجدول في PDF؛ استعمل Excel/CSV للبيانات الكاملة.', vat: 'الرقم الضريبي', cr: 'السجل التجاري', notes: 'ملاحظات', gaps: 'فجوات البيانات' },
  en: { company: 'Company', stations: 'Stations', period: 'Period', current: 'Current state', generated: 'Generated', by: 'By', page: 'Page', total: 'Total', empty: 'No data', incomplete: 'Incomplete data — see notes', source: 'Source', truncatedPdf: 'Table truncated in PDF; use Excel/CSV for the full data.', vat: 'VAT no.', cr: 'CR no.', notes: 'Notes', gaps: 'Data gaps' },
} as const;

/** وزن عرض العمود النسبي بحسب نوعه. */
function weight(column: ReportColumn): number {
  switch (column.type) {
    case 'text': return 1.7;
    case 'datetime': return 1.45;
    case 'date': return 1.1;
    case 'status': return 0.95;
    case 'int': return 0.8;
    default: return 1.1;
  }
}

const isNumeric = (column: ReportColumn) => ['int', 'liters', 'money', 'bp'].includes(column.type);

async function logoData(logo: string | null | undefined): Promise<{ data: string; format: 'PNG' | 'JPEG' } | null> {
  if (!logo || !logo.startsWith('data:image/')) return null;
  if (logo.startsWith('data:image/png')) return { data: logo, format: 'PNG' };
  if (logo.startsWith('data:image/jpeg') || logo.startsWith('data:image/jpg')) return { data: logo, format: 'JPEG' };
  return null; // SVG/WebP غير مدعومة في jsPDF هنا: لا شعار بدل ملف تالف
}

/**
 * **نقطة التبديل الوحيدة** لرسم PDF تقرير وقود. تستهلكها `ReportActions` وحدها؛ حين تُعرّف منصة المستندات نوع مستند «تقرير إغلاق/تسليم وردية الوقود»
 * (التدقيق الشامل §D5) يُستبدل جسم هذه الدالة بمصدّر المنصة دون المساس بالمحرك ولا بالواجهات (انظر FUEL_REPORTS_DOCUMENT_PLATFORM_INTEGRATION.md).
 */
export type ReportDocumentRenderer = (payload: ReportPayload, options: PdfOptions) => Promise<Blob>;

export const createReportPdf: ReportDocumentRenderer = async (payload, options) => {
  if (isThermal(options.paper)) return createThermal(payload, options, PAPER_SIZES[options.paper].widthMm);
  return createA4(payload, options, options.paper === 'a4_landscape' ? 'landscape' : 'portrait');
};

// ───────────────────────── A4 ─────────────────────────

async function createA4(payload: ReportPayload, options: PdfOptions, orientation: 'portrait' | 'landscape'): Promise<Blob> {
  const { lang } = options;
  const l = T[lang];
  const rtl = lang === 'ar';
  const pdf = await newPdf(orientation);
  const W = orientation === 'landscape' ? 297 : 210;
  const H = orientation === 'landscape' ? 210 : 297;
  const M = 10; const L = M; const R = W - M; const TW = R - L;
  const sa: 'left' | 'right' = rtl ? 'right' : 'left';
  const ea: 'left' | 'right' = rtl ? 'left' : 'right';
  const start = rtl ? R : L;
  const tz = payload.timezone;
  const logo = await logoData(options.company?.logo);
  let y = 10;
  const bottom = H - 16;

  const header = () => {
    filled(pdf, L, y, TW, 22, NAVY, 2);
    const company = options.company?.name ?? payload.tenant.name ?? '—';
    const textX = rtl ? R - 4 : L + 4;
    if (logo) {
      const logoX = rtl ? R - 18 : L + 3;
      try { pdf.addImage(logo.data, logo.format, logoX, y + 3, 16, 16); } catch { /* شعار تالف: يُتجاهل */ }
    }
    const nameX = logo ? (rtl ? R - 22 : L + 22) : textX;
    fitText(pdf, company, nameX, y + 9, TW * 0.55, { size: 13, bold: true, align: sa, color: [255, 255, 255] });
    const ids = [options.company?.vat ? `${l.vat}: ${options.company.vat}` : null, options.company?.cr ? `${l.cr}: ${options.company.cr}` : null].filter(Boolean).join('   ');
    if (ids) fitText(pdf, ids, nameX, y + 15, TW * 0.55, { size: 7.5, align: sa, color: [203, 213, 225] });
    fitText(pdf, payload.report.title[lang], rtl ? L + 4 : R - 4, y + 9, TW * 0.4, { size: 13, bold: true, align: ea, color: [255, 255, 255] });
    const period = payload.period ? `${payload.period.from} → ${payload.period.to}` : l.current;
    fitText(pdf, period, rtl ? L + 4 : R - 4, y + 15, TW * 0.4, { size: 8, align: ea, color: [203, 213, 225] });
    y += 26;
    const stations = payload.stations.map((s) => s.name).join('، ');
    fitText(pdf, `${l.stations}: ${stations || '—'}`, start, y, TW, { size: 8, color: MUTED, align: sa });
    y += 5;
  };

  header();

  if (!payload.data_quality.complete) {
    filled(pdf, L, y, TW, 7, [254, 243, 199], 1.5);
    fitText(pdf, l.incomplete, start === R ? R - 2 : L + 2, y + 4.8, TW - 4, { size: 8, bold: true, color: [146, 64, 14], align: sa });
    y += 10;
  }

  // مؤشرات
  if (payload.summary.length > 0) {
    const perRow = orientation === 'landscape' ? 5 : 4;
    const cardW = (TW - (perRow - 1) * 3) / perRow;
    payload.summary.forEach((item, index) => {
      const col = index % perRow;
      if (col === 0 && index > 0) y += 15;
      if (y + 15 > bottom) { pdf.addPage('a4', orientation); y = 12; }
      const x = rtl ? R - col * (cardW + 3) - cardW : L + col * (cardW + 3);
      filled(pdf, x, y, cardW, 13, [241, 245, 249], 1.5);
      fitText(pdf, item.label[lang], rtl ? x + cardW - 2 : x + 2, y + 4.5, cardW - 4, { size: 7, color: MUTED, align: sa });
      fitText(pdf, summaryText(item, lang, tz), rtl ? x + cardW - 2 : x + 2, y + 10.2, cardW - 4, { size: 10, bold: true, color: NAVY, align: sa });
    });
    y += 18;
  }

  for (const table of payload.tables) y = drawTable(pdf, table, y, { L, R, TW, H, bottom, rtl, sa, ea, start, orientation, lang, tz });

  const notes = [...payload.data_quality.notes.map((n) => n[lang]), ...(payload.data_quality.gaps.length > 0 ? [`${l.gaps}: ${payload.data_quality.gaps.join(', ')}`] : [])];
  if (notes.length > 0) {
    if (y + 8 > bottom) { pdf.addPage('a4', orientation); y = 12; }
    text(pdf, l.notes, start, y + 3, { size: 8.5, bold: true, color: NAVY, align: sa });
    y += 6;
    for (const note of notes) {
      if (y + 5 > bottom) { pdf.addPage('a4', orientation); y = 12; }
      fitText(pdf, `• ${note}`, start, y + 2.5, TW, { size: 7.5, color: MUTED, align: sa });
      y += 4.6;
    }
  }

  footer(pdf, payload, options, l, rtl, W, H, tz);
  return pdf.output('blob');
}

interface Geometry { L: number; R: number; TW: number; H: number; bottom: number; rtl: boolean; sa: 'left' | 'right'; ea: 'left' | 'right'; start: number; orientation: 'portrait' | 'landscape'; lang: Lang; tz: string }

function drawTable(pdf: PdfDoc, table: ReportTable, startY: number, g: Geometry): number {
  let y = startY;
  const l = T[g.lang];
  if (y + 24 > g.bottom) { pdf.addPage('a4', g.orientation); y = 12; }
  text(pdf, table.title[g.lang], g.start, y + 3, { size: 10, bold: true, color: NAVY, align: g.sa });
  y += 6;

  const total = table.columns.reduce((sum, c) => sum + weight(c), 0);
  const widths = table.columns.map((c) => (weight(c) / total) * g.TW);
  const xOf = (index: number) => {
    const before = widths.slice(0, index).reduce((sum, w) => sum + w, 0);
    return g.rtl ? g.R - before : g.L + before;
  };
  const anchor = (index: number, numeric: boolean) => {
    const x = xOf(index); const w = widths[index];
    if (numeric) return g.rtl ? x - w + 1.5 : x + w - 1.5;
    return g.rtl ? x - 1.5 : x + 1.5;
  };

  const head = () => {
    filled(pdf, g.L, y, g.TW, 7, [226, 232, 240]);
    table.columns.forEach((c, i) => fitText(pdf, c.label[g.lang], anchor(i, isNumeric(c)), y + 4.7, widths[i] - 3, { size: 7.5, bold: true, color: NAVY, align: isNumeric(c) ? g.ea : g.sa }));
    y += 7;
  };
  head();

  if (table.rows.length === 0) {
    text(pdf, l.empty, (g.L + g.R) / 2, y + 7, { size: 9, color: MUTED, align: 'center' });
    return y + 12;
  }

  const rows = table.rows.slice(0, PDF_ROW_CAP);
  rows.forEach((row, rowIndex) => {
    if (y + 6.4 > g.bottom) { pdf.addPage('a4', g.orientation); y = 12; head(); }
    if (rowIndex % 2 === 1) filled(pdf, g.L, y, g.TW, 6.4, [249, 250, 251]);
    table.columns.forEach((c, i) => fitText(pdf, cellText(c, row[c.key], g.lang, g.tz), anchor(i, isNumeric(c)), y + 4.4, widths[i] - 3, { size: 7.5, align: isNumeric(c) ? g.ea : g.sa }));
    line(pdf, g.L, y + 6.4, g.R, y + 6.4, [229, 231, 235]);
    y += 6.4;
  });

  if (table.totals) {
    if (y + 8 > g.bottom) { pdf.addPage('a4', g.orientation); y = 12; }
    filled(pdf, g.L, y, g.TW, 7.2, [203, 213, 225]);
    table.columns.forEach((c, i) => {
      const value = i === 0 ? l.total : table.totals && c.key in table.totals ? cellText(c, table.totals[c.key], g.lang, g.tz) : '';
      if (value !== '') fitText(pdf, value, anchor(i, i !== 0 && isNumeric(c)), y + 4.9, widths[i] - 3, { size: 8, bold: true, color: NAVY, align: i !== 0 && isNumeric(c) ? g.ea : g.sa });
    });
    y += 7.2;
  }
  if (table.rows.length > PDF_ROW_CAP) {
    fitText(pdf, l.truncatedPdf, g.start, y + 4, g.TW, { size: 8, color: [180, 83, 9], align: g.sa });
    y += 6;
  }

  return y + 7;
}

function footer(pdf: PdfDoc, payload: ReportPayload, options: PdfOptions, l: (typeof T)[Lang], rtl: boolean, W: number, H: number, tz: string): void {
  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    pdf.setPage(page);
    line(pdf, 10, H - 12, W - 10, H - 12);
    const meta = [options.generatedBy ? `${l.by}: ${options.generatedBy}` : null, `${l.generated}: ${dateTimeText(payload.generated_at, tz)} (${tz})`, `${l.source}: ${payload.source.kind}`].filter(Boolean).join('   ');
    fitText(pdf, meta, rtl ? W - 10 : 10, H - 7.5, W - 50, { size: 7, color: MUTED, align: rtl ? 'right' : 'left' });
    text(pdf, `${l.page} ${page} / ${pages}`, rtl ? 10 : W - 10, H - 7.5, { size: 7, color: MUTED, align: rtl ? 'left' : 'right' });
  }
}

// ───────────────────────── حراري ─────────────────────────

/**
 * إيصال حراري 58/80مم: عمود واحد؛ الهيدر وسطر لكل مؤشر، ثم كل صف جدول كتلة «تسمية: قيمة». الارتفاع يُقاس بتمريرة أولى على مستند مؤقت
 * ثم يُرسم المستند النهائي بالارتفاع الدقيق (صفحة واحدة بلا قص). لا ادّعاء بطابعة Bluetooth مباشرة: الطباعة عبر نافذة الطباعة/AirPrint بمقاس الورق.
 */
async function createThermal(payload: ReportPayload, options: PdfOptions, widthMm: number): Promise<Blob> {
  const measure = await newPdf('portrait', [widthMm, 2000]);
  const height = drawThermal(measure, payload, options, widthMm, false) + 6;
  const pdf = await newPdf('portrait', [widthMm, Math.max(40, height)]);
  drawThermal(pdf, payload, options, widthMm, true);
  return pdf.output('blob');
}

function drawThermal(pdf: PdfDoc, payload: ReportPayload, options: PdfOptions, widthMm: number, draw: boolean): number {
  const { lang } = options;
  const l = T[lang];
  const rtl = lang === 'ar';
  const M = 3; const L = M; const R = widthMm - M; const TW = R - L;
  const sa: 'left' | 'right' = rtl ? 'right' : 'left';
  const ea: 'left' | 'right' = rtl ? 'left' : 'right';
  const start = rtl ? R : L; const end = rtl ? L : R;
  const tz = payload.timezone;
  const small = widthMm <= 58 ? 6.5 : 7.5;
  let y = 5;

  const center = (value: string, size: number, bold = false) => { if (draw) fitText(pdf, value, widthMm / 2, y, TW, { size, bold, align: 'center' }); y += size * 0.5 + 1.4; };
  const rule = () => { if (draw) line(pdf, L, y, R, y, [120, 120, 120], 0.2); y += 2; };
  const pair = (label: string, value: string, bold = false) => {
    if (draw) {
      fitText(pdf, label, start, y, TW * 0.55, { size: small, align: sa, color: MUTED });
      fitText(pdf, value, end, y, TW * 0.45, { size: small, bold, align: ea });
    }
    y += small * 0.5 + 1.4;
  };

  center(options.company?.name ?? payload.tenant.name ?? '—', small + 2, true);
  center(payload.report.title[lang], small + 1, true);
  if (payload.stations.length > 0) center(payload.stations.map((s) => s.name).join('، '), small);
  center(payload.period ? `${payload.period.from} → ${payload.period.to}` : l.current, small);
  center(`${dateTimeText(payload.generated_at, tz)}`, small - 0.5);
  rule();

  for (const item of payload.summary) pair(item.label[lang], summaryText(item, lang, tz), true);
  if (payload.summary.length > 0) rule();

  // كل الجداول تُطبع (لا يُقتطع قسم بصمت)؛ عنوان القسم حين يتعدد. ميزانية الارتفاع تمنع تجاوز حد صفحة jsPDF (5080مم): يُوقَف الرسم بتحذير صريح لا بقصّ صامت.
  const pairHeight = small * 0.5 + 1.4;
  for (const table of payload.tables) {
    if (payload.tables.length > 1) center(table.title[lang], small, true);
    const candidates = table.rows.slice(0, THERMAL_ROW_CAP);
    if (candidates.length === 0) center(l.empty, small);
    let printed = 0;
    for (const row of candidates) {
      const lines = table.columns.filter((c, i) => cellText(c, row[c.key], lang, tz) !== '—' || i === 0).length;
      if (y + lines * pairHeight + 2 + THERMAL_RESERVE_MM > THERMAL_MAX_MM) break;
      table.columns.forEach((c, i) => { const v = cellText(c, row[c.key], lang, tz); if (v !== '—' || i === 0) pair(c.label[lang], v, i === 0); });
      rule();
      printed++;
    }
    if (printed < table.rows.length) center(l.truncatedPdf, small - 0.5);
    if (table.totals) {
      pair(l.total, '', true);
      for (const c of table.columns) if (c.key in table.totals) pair(c.label[lang], cellText(c, table.totals[c.key], lang, tz), true);
      rule();
    }
  }
  if (!payload.data_quality.complete) center(l.incomplete, small - 0.5, true);
  return y;
}
