import type { Company } from '@/lib/company';
import type { PartnerStatementData, StatementFilters } from '@/components/partners/partner-statement-document';

const PAGE = { width: 210, height: 297, margin: 10, contentWidth: 190 };
const FONT_FILE = 'NotoSansArabic-Regular.ttf';
const FONT_FAMILY = 'NotoSansArabic';

export interface StatementPdfLabels {
  title: string;
  customer: string;
  period: string;
  allPeriods: string;
  branchScope: string;
  allBranches: string;
  selectedBranches: (count: number) => string;
  openingBalance: string;
  totalDebit?: string;
  totalCredit?: string;
  closingBalance: string;
  date: string;
  entryNumber: string;
  description: string;
  debit: string;
  credit: string;
  balance: string;
  generatedAt: string;
  vatNumber?: string;
  crNumber?: string;
  footer: string;
  currency: string;
  empty: string;
}

export interface StatementPdfInput {
  statement: PartnerStatementData;
  company: Company | null;
  filters: StatementFilters;
  labels: StatementPdfLabels;
  locale: string;
}

type PdfDoc = import('jspdf').jsPDF;
type ArabicPdfDoc = PdfDoc & { processArabic?: (text: string) => string };

let fontDataPromise: Promise<string> | null = null;

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let start = 0; start < bytes.length; start += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(start, Math.min(start + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

async function arabicFontData(): Promise<string> {
  if (!fontDataPromise) {
    fontDataPromise = fetch('/fonts/NotoSansArabic-Regular.ttf')
      .then((response) => {
        if (!response.ok) throw new Error('Arabic PDF font could not be loaded');
        return response.arrayBuffer();
      })
      .then(toBase64);
  }
  return fontDataPromise;
}

function asArabic(pdf: ArabicPdfDoc, text: string): string {
  return pdf.processArabic ? pdf.processArabic(text) : text;
}

function money(value: string, currency: string): string {
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
  return `${formatted} ${currency}`;
}

function formatDate(value: string, locale: string): string {
  if (!value) return '—';
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA' : 'en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  }).format(date);
}

function formatPeriod(filters: StatementFilters, labels: StatementPdfLabels, locale: string): string {
  if (!filters.from && !filters.to) return labels.allPeriods;
  if (filters.from && filters.to && filters.from === filters.to) return formatDate(filters.from, locale);
  return `${formatDate(filters.from, locale)} — ${formatDate(filters.to, locale)}`;
}

function setArabicFont(pdf: PdfDoc, size: number, style: 'normal' | 'bold' = 'normal') {
  pdf.setFont(FONT_FAMILY, style);
  pdf.setFontSize(size);
}

function setLatinFont(pdf: PdfDoc, size: number, style: 'normal' | 'bold' = 'normal') {
  pdf.setFont('helvetica', style);
  pdf.setFontSize(size);
}

function writeArabicRight(pdf: ArabicPdfDoc, text: string, x: number, y: number, size: number, bold = false) {
  setArabicFont(pdf, size, bold ? 'bold' : 'normal');
  pdf.text(asArabic(pdf, text), x, y, { align: 'right' });
}

function writeLatinCenter(pdf: PdfDoc, text: string, x: number, y: number, size: number, bold = false) {
  setLatinFont(pdf, size, bold ? 'bold' : 'normal');
  pdf.text(text, x, y, { align: 'center' });
}

function writeLatinRight(pdf: PdfDoc, text: string, x: number, y: number, size: number, bold = false) {
  setLatinFont(pdf, size, bold ? 'bold' : 'normal');
  pdf.text(text, x, y, { align: 'right' });
}

/** يضع شعار المؤسسة المحفوظ كـ data URL داخل بطاقة بيضاء دون تشويه نسب الصورة. */
function drawCompanyLogo(pdf: PdfDoc, logo: string | null | undefined, x: number, y: number, maxWidth: number, maxHeight: number): boolean {
  if (!logo?.startsWith('data:image/')) return false;
  try {
    const image = pdf.getImageProperties(logo);
    const ratio = image.width / image.height;
    let width = maxWidth;
    let height = width / ratio;
    if (height > maxHeight) {
      height = maxHeight;
      width = height * ratio;
    }
    const format = logo.match(/^data:image\/(png|jpe?g|webp);/i)?.[1]?.replace('jpg', 'jpeg').toUpperCase() ?? 'PNG';
    pdf.setFillColor(255, 255, 255);
    pdf.roundedRect(x, y, maxWidth, maxHeight, 1.5, 1.5, 'F');
    pdf.addImage(logo, format, x + (maxWidth - width) / 2, y + (maxHeight - height) / 2, width, height, undefined, 'FAST');
    return true;
  } catch {
    return false;
  }
}

/** ينشئ PDF متجهياً (Vector PDF) حتى تبقى العربية واضحة وقابلة للبحث ولا تتأثر بـ html2canvas. */
export async function createPartnerStatementPdf(input: StatementPdfInput): Promise<Blob> {
  const [{ jsPDF }, fontData] = await Promise.all([import('jspdf'), arabicFontData()]);
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', putOnlyUsedFonts: true }) as ArabicPdfDoc;
  pdf.addFileToVFS(FONT_FILE, fontData);
  pdf.addFont(FONT_FILE, FONT_FAMILY, 'normal');
  // خط regular فقط متاح عمداً؛ jsPDF يرفع الوزن بصرياً عبر نفس ملف الخط عند الحاجة.
  pdf.addFont(FONT_FILE, FONT_FAMILY, 'bold');

  const currency = input.company?.currency ?? 'SAR';
  // رقم وتاريخ محايدان في المستند المصدَّر: فصلهما عن النص العربي يمنع خلل اتجاه bidi.
  const generatedAt = new Intl.DateTimeFormat('en-GB', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date()).replace(',', '');
  const branchScope = input.filters.branchIds.length === 0
    ? input.labels.allBranches
    : input.labels.selectedBranches(input.filters.branchIds.length);

    const right = PAGE.width - PAGE.margin;
  const left = PAGE.margin;
  const totalDebit = input.statement.rows.reduce((sum, row) => sum + Number(row.debit || 0), 0);
  const totalCredit = input.statement.rows.reduce((sum, row) => sum + Number(row.credit || 0), 0);
  const summaryMoney = (value: number | string) => money(String(value), currency);
  let y = 18;

  const drawHeader = (continued = false) => {
    const navy: [number, number, number] = [15, 39, 72];
    const blue: [number, number, number] = [37, 99, 235];
    pdf.setFillColor(...navy);
    pdf.roundedRect(left, 10, PAGE.contentWidth, continued ? 25 : 42, 2, 2, 'F');
    pdf.setFillColor(...blue);
    pdf.rect(left, continued ? 33 : 49, PAGE.contentWidth, 3, 'F');

    if (continued) {
      drawCompanyLogo(pdf, input.company?.logo, right - 28, 13, 20, 17);
      pdf.setTextColor(255, 255, 255);
      writeArabicRight(pdf, `${input.labels.title} · ${input.statement.partner.name}`, right - 32, 25, 10.5, true);
      pdf.setTextColor(21, 24, 29);
      y = 43;
      return;
    }

    const logoShown = drawCompanyLogo(pdf, input.company?.logo, right - 31, 15, 23, 22);
    if (!logoShown) {
      pdf.setFillColor(255, 255, 255);
      pdf.roundedRect(right - 31, 15, 23, 22, 1.5, 1.5, 'F');
      pdf.setTextColor(...blue);
      writeArabicRight(pdf, 'ن', right - 15, 30, 12, true);
    }

    pdf.setTextColor(255, 255, 255);
    writeArabicRight(pdf, input.company?.name ?? 'Nebrax', right - 35, 23, 10.5, true);
    const identity = [
      input.company?.vat_number && `${input.labels.vatNumber ?? 'VAT'}: ${input.company.vat_number}`,
      input.company?.cr_number && `${input.labels.crNumber ?? 'CR'}: ${input.company.cr_number}`,
    ].filter(Boolean).join('  •  ');
    if (identity) writeArabicRight(pdf, identity, right - 35, 31, 6.5);
    writeArabicRight(pdf, input.labels.title, 112, 24, 14.5, true);
    writeArabicRight(pdf, input.labels.generatedAt, 112, 34, 6.8);
    writeLatinRight(pdf, generatedAt, 72, 34, 6.8);
    pdf.setTextColor(21, 24, 29);

    const detailY = 59;
    const detailW = (PAGE.contentWidth - 8) / 3;
    const detailCard = (x: number, label: string, value: string) => {
      pdf.setFillColor(248, 250, 252);
      pdf.setDrawColor(226, 232, 240);
      pdf.roundedRect(x, detailY, detailW, 21, 1.5, 1.5, 'FD');
      writeArabicRight(pdf, label, x + detailW - 3, detailY + 6.5, 6.5);
      setArabicFont(pdf, 8.1, 'bold');
      const lines = pdf.splitTextToSize(asArabic(pdf, value), detailW - 6) as string[];
      pdf.text(lines.slice(0, 2), x + detailW - 3, detailY + 14, { align: 'right', lineHeightFactor: 1.08 });
    };
    detailCard(right - detailW, input.labels.customer, input.statement.partner.name);
    detailCard(right - detailW * 2 - 4, input.labels.period, formatPeriod(input.filters, input.labels, input.locale));
    detailCard(left, input.labels.branchScope, branchScope);

    const summaryY = 88;
    const summaryGap = 2;
    const summaryW = (PAGE.contentWidth - summaryGap * 3) / 4;
    const summaryCard = (x: number, label: string, value: string, accent: [number, number, number]) => {
      pdf.setFillColor(255, 255, 255);
      pdf.setDrawColor(226, 232, 240);
      pdf.roundedRect(x, summaryY, summaryW, 27, 1.5, 1.5, 'FD');
      pdf.setFillColor(...accent);
      pdf.roundedRect(x, summaryY, summaryW, 2.5, 1.5, 1.5, 'F');
      writeArabicRight(pdf, label, x + summaryW - 3, summaryY + 10.5, 6.8);
      writeLatinRight(pdf, value, x + summaryW - 3, summaryY + 20.5, 10.5, true);
    };
    summaryCard(right - summaryW, input.labels.closingBalance, summaryMoney(input.statement.closing_balance), [15, 39, 72]);
    summaryCard(right - summaryW * 2 - summaryGap, input.labels.totalCredit ?? input.labels.credit, summaryMoney(totalCredit), [22, 163, 74]);
    summaryCard(right - summaryW * 3 - summaryGap * 2, input.labels.totalDebit ?? input.labels.debit, summaryMoney(totalDebit), [37, 99, 235]);
    summaryCard(left, input.labels.openingBalance, summaryMoney(input.statement.opening_balance), [148, 163, 184]);
    y = 126;
  };

  const columns = [
    { label: input.labels.date, width: 24 },
    { label: input.labels.entryNumber, width: 31 },
    { label: input.labels.description, width: 50 },
    { label: input.labels.debit, width: 28 },
    { label: input.labels.credit, width: 28 },
    { label: input.labels.balance, width: 29 },
  ];

  const drawTableHeader = () => {
    pdf.setFillColor(15, 39, 72);
    pdf.setDrawColor(15, 39, 72);
    pdf.rect(left, y, PAGE.contentWidth, 10, 'FD');
    pdf.setTextColor(255, 255, 255);
    let cursor = right;
    for (const column of columns) {
      writeArabicRight(pdf, column.label, cursor - 2, y + 6.35, 7.2, true);
      cursor -= column.width;
      if (cursor > left) pdf.line(cursor, y, cursor, y + 10);
    }
    pdf.setTextColor(21, 24, 29);
    y += 10;
  };

  const nextPage = () => {
    pdf.addPage();
    drawHeader(true);
    drawTableHeader();
  };

  const drawRow = (cells: Array<{ text: string; kind: 'arabic' | 'latin' | 'money' }>, fill?: [number, number, number]) => {
    // المصدر والتسوية قد يبلغان عدة أسطر؛ إبقاء الصف ثابتاً يجعل النص يتداخل مع
    // الأعمدة الرقمية، لذلك يُقاس النص العربي أولاً ويزداد ارتفاع الصف عند الحاجة.
    const arabicLines = cells.map((cell, index) => {
      if (cell.kind !== 'arabic') return [cell.text];
      setArabicFont(pdf, 7.6);
      return pdf.splitTextToSize(asArabic(pdf, cell.text), columns[index].width - 4) as string[];
    });
    const rowHeight = Math.max(12, Math.max(...arabicLines.map((lines) => lines.length)) * 4.6 + 4.5);
    if (y + rowHeight > PAGE.height - 20) nextPage();
    if (fill) pdf.setFillColor(...fill);
    else pdf.setFillColor(255, 255, 255);
    pdf.setDrawColor(226, 232, 240);
    pdf.rect(left, y, PAGE.contentWidth, rowHeight, 'FD');
    let cursor = right;
    cells.forEach((cell, index) => {
      const width = columns[index].width;
      const center = cursor - width / 2;
      if (cell.kind === 'arabic') {
        setArabicFont(pdf, 7.6);
        pdf.text(arabicLines[index], cursor - 2, y + 5.6, { align: 'right', lineHeightFactor: 1.08 });
      } else if (cell.kind === 'money') writeLatinCenter(pdf, cell.text, center, y + rowHeight / 2 + 2.5, 7.4, true);
      else writeLatinCenter(pdf, cell.text, center, y + rowHeight / 2 + 2.5, 7.3, true);
      cursor -= width;
      if (cursor > left) pdf.line(cursor, y, cursor, y + rowHeight);
    });
    y += rowHeight;
  };

  drawHeader();
  drawTableHeader();
  drawRow([
    { text: '', kind: 'latin' },
    { text: '', kind: 'latin' },
    { text: input.labels.openingBalance, kind: 'arabic' },
    { text: '', kind: 'latin' },
    { text: '', kind: 'latin' },
    { text: money(input.statement.opening_balance, currency), kind: 'money' },
  ], [248, 250, 252]);

  if (input.statement.rows.length === 0) {
    drawRow([
      { text: '', kind: 'latin' }, { text: '', kind: 'latin' }, { text: input.labels.empty, kind: 'arabic' },
      { text: '', kind: 'latin' }, { text: '', kind: 'latin' }, { text: '', kind: 'latin' },
    ]);
  } else {
    input.statement.rows.forEach((row, index) => {
      drawRow([
        { text: row.date, kind: 'latin' },
        { text: row.number, kind: 'latin' },
        { text: row.description ?? '—', kind: 'arabic' },
        { text: row.debit !== '0.00' ? money(row.debit, currency) : '—', kind: 'money' },
        { text: row.credit !== '0.00' ? money(row.credit, currency) : '—', kind: 'money' },
        { text: money(row.balance, currency), kind: 'money' },
      ], index % 2 === 1 ? [248, 250, 252] : undefined);
    });
  }

  // تذييل موحد لكل صفحة: يحافظ على صفة المستند الرسمية عند امتداد الجدول لصفحات عدة.
  const pageCount = pdf.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    pdf.setPage(page);
    const footerY = PAGE.height - 12;
    pdf.setDrawColor(203, 213, 225);
    pdf.setLineWidth(0.25);
    pdf.line(left, footerY - 5, right, footerY - 5);
    writeArabicRight(pdf, input.labels.footer, right, footerY + 0.5, 6.7);
    writeArabicRight(pdf, input.labels.currency, left + 35, footerY + 0.5, 6.7);
    writeLatinCenter(pdf, currency, left + 10, footerY + 0.5, 6.7, true);
    writeLatinCenter(pdf, `${page} / ${pageCount}`, PAGE.width / 2, footerY + 0.5, 6.7);
  }

  return pdf.output('blob');
}

export function downloadPartnerStatementPdf(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function sharePartnerStatementPdf(blob: Blob, fileName: string, title: string): Promise<'shared' | 'downloaded'> {
  const name = fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`;
  const file = new File([blob], name, { type: 'application/pdf' });
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (typeof navigator.share === 'function' && nav.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title });
    return 'shared';
  }
  downloadPartnerStatementPdf(blob, name);
  return 'downloaded';
}
