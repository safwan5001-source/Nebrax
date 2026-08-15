import type { ReportColumn } from '@/components/reports/report-document';
import type { SourceCompany } from '@/modules/documents/builder/from-invoice';
import { downloadInvoicePdf, shareInvoicePdf } from '@/modules/invoices/services/invoice-pdf';

const PAGE = { width: 210, height: 297, margin: 10, contentWidth: 190 };
const FONT_FILE = 'NotoSansArabic-Regular.ttf';
const FONT_FAMILY = 'NotoSansArabic';

type PdfDoc = import('jspdf').jsPDF;
type ArabicPdfDoc = PdfDoc & { processArabic?: (text: string) => string };

export interface ReportPdfLabels {
  asOf: string;
  vatNumber: string;
  crNumber: string;
  footer: string;
  empty: string;
}

export interface ReportPdfInput {
  title: string;
  asOf?: string | null;
  company: SourceCompany | null;
  columns: ReportColumn[];
  rows: string[][];
  totalRow?: string[] | null;
  labels: ReportPdfLabels;
  locale: string;
}

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

function arabicFontData(): Promise<string> {
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

function setArabic(pdf: PdfDoc, size: number, bold = false) {
  pdf.setFont(FONT_FAMILY, bold ? 'bold' : 'normal');
  pdf.setFontSize(size);
}

function setLatin(pdf: PdfDoc, size: number, bold = false) {
  pdf.setFont('helvetica', bold ? 'bold' : 'normal');
  pdf.setFontSize(size);
}

function writeArabicRight(pdf: ArabicPdfDoc, text: string, x: number, y: number, size: number, bold = false) {
  setArabic(pdf, size, bold);
  pdf.text(asArabic(pdf, text), x, y, { align: 'right' });
}

function writeArabicCenter(pdf: ArabicPdfDoc, text: string, x: number, y: number, size: number, bold = false) {
  setArabic(pdf, size, bold);
  pdf.text(asArabic(pdf, text), x, y, { align: 'center' });
}

function writeLatinCenter(pdf: PdfDoc, text: string, x: number, y: number, size: number, bold = false) {
  setLatin(pdf, size, bold);
  pdf.text(text, x, y, { align: 'center' });
}

function drawLogo(pdf: PdfDoc, logo: string | null | undefined, x: number, y: number, maxWidth: number, maxHeight: number): boolean {
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

function numericText(value: string): string {
  return value.replace(/[﷼]/g, 'SAR').replace(/ريال/g, 'SAR').replace(/\s+/g, ' ').trim();
}

/** يرسم التقرير كجدول عربي متجهي، مع ترويسة وصفحات متابعة وإجماليات قابلة للطباعة والمشاركة. */
export async function createReportPdf(input: ReportPdfInput): Promise<Blob> {
  const [{ jsPDF }, fontData] = await Promise.all([import('jspdf'), arabicFontData()]);
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', putOnlyUsedFonts: true }) as ArabicPdfDoc;
  pdf.addFileToVFS(FONT_FILE, fontData);
  pdf.addFont(FONT_FILE, FONT_FAMILY, 'normal');
  pdf.addFont(FONT_FILE, FONT_FAMILY, 'bold');

  const left = PAGE.margin;
  const right = PAGE.width - PAGE.margin;
  const numericalColumns = input.columns.map((column) => column.align === 'end');
  const numericCount = numericalColumns.filter(Boolean).length;
  const numericWidth = input.columns.length >= 6 ? 27 : input.columns.length === 5 ? 33 : 42;
  const textCount = Math.max(1, input.columns.length - numericCount);
  const textWidth = (PAGE.contentWidth - numericCount * numericWidth) / textCount;
  const widths = input.columns.map((_, index) => numericalColumns[index] ? numericWidth : textWidth);
  let y = 18;

  const drawHeader = (continued = false) => {
    pdf.setFillColor(15, 39, 72);
    pdf.roundedRect(left, 10, PAGE.contentWidth, continued ? 26 : 43, 2, 2, 'F');
    pdf.setFillColor(37, 99, 235);
    pdf.rect(left, continued ? 33 : 50, PAGE.contentWidth, 3, 'F');
    if (!continued) {
      const logoShown = drawLogo(pdf, input.company?.logo, right - 31, 15, 23, 22);
      if (!logoShown) {
        pdf.setFillColor(255, 255, 255);
        pdf.roundedRect(right - 31, 15, 23, 22, 1.5, 1.5, 'F');
        pdf.setTextColor(37, 99, 235);
        writeArabicCenter(pdf, 'ن', right - 19.5, 30, 12, true);
      }
      pdf.setTextColor(255, 255, 255);
      writeArabicRight(pdf, input.company?.name ?? 'Nebrax', right - 35, 23, 10.5, true);
      const identity = [
        input.company?.vat_number && `${input.labels.vatNumber}: ${input.company.vat_number}`,
        input.company?.cr_number && `${input.labels.crNumber}: ${input.company.cr_number}`,
      ].filter(Boolean).join('  •  ');
      if (identity) writeArabicRight(pdf, identity, right - 35, 31, 6.5);
      writeArabicRight(pdf, input.title, 112, 24, 14.5, true);
      if (input.asOf) writeArabicRight(pdf, `${input.labels.asOf}: ${input.asOf}`, 112, 33, 7);
      y = 61;
    } else {
      pdf.setTextColor(255, 255, 255);
      writeArabicRight(pdf, input.title, right - 4, 25.5, 10.5, true);
      pdf.setTextColor(21, 24, 29);
      y = 43;
    }
    pdf.setTextColor(21, 24, 29);
  };

  const drawTableHeader = () => {
    pdf.setFillColor(15, 39, 72);
    pdf.setDrawColor(15, 39, 72);
    pdf.rect(left, y, PAGE.contentWidth, 10, 'FD');
    pdf.setTextColor(255, 255, 255);
    let cursor = right;
    input.columns.forEach((column, index) => {
      const width = widths[index];
      writeArabicRight(pdf, column.label, cursor - 2, y + 6.3, 6.6, true);
      cursor -= width;
      if (cursor > left) pdf.line(cursor, y, cursor, y + 10);
    });
    pdf.setTextColor(21, 24, 29);
    y += 10;
  };

  const nextPage = () => {
    pdf.addPage();
    drawHeader(true);
    drawTableHeader();
  };

  const drawRow = (row: string[], emphasized = false, rowIndex = 0) => {
    const lineGroups = row.map((cell, index) => {
      if (numericalColumns[index]) return [numericText(cell ?? '—')];
      setArabic(pdf, 7.1);
      return pdf.splitTextToSize(asArabic(pdf, cell ?? '—'), widths[index] - 4) as string[];
    });
    const height = Math.max(10, Math.max(...lineGroups.map((lines) => lines.length)) * 4.4 + 4.5);
    if (y + height > PAGE.height - 22) nextPage();
    if (emphasized) pdf.setFillColor(239, 246, 255);
    else if (rowIndex % 2) pdf.setFillColor(248, 250, 252);
    else pdf.setFillColor(255, 255, 255);
    pdf.setDrawColor(226, 232, 240);
    pdf.rect(left, y, PAGE.contentWidth, height, 'FD');
    let cursor = right;
    row.forEach((cell, index) => {
      const width = widths[index];
      if (numericalColumns[index]) writeLatinCenter(pdf, numericText(cell ?? '—'), cursor - width / 2, y + height / 2 + 2.5, 6.9, emphasized);
      else {
        setArabic(pdf, 7.1, emphasized);
        pdf.text(lineGroups[index], cursor - 2, y + 5.6, { align: 'right', lineHeightFactor: 1.08 });
      }
      cursor -= width;
      if (cursor > left) pdf.line(cursor, y, cursor, y + height);
    });
    y += height;
  };

  drawHeader();
  drawTableHeader();
  if (input.rows.length === 0) drawRow([input.labels.empty, ...input.columns.slice(1).map(() => '')]);
  else input.rows.forEach((row, index) => drawRow(row, false, index));
  if (input.totalRow) drawRow(input.totalRow, true);

  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    pdf.setPage(page);
    const footerY = PAGE.height - 12;
    pdf.setDrawColor(203, 213, 225);
    pdf.line(left, footerY - 5, right, footerY - 5);
    writeArabicRight(pdf, input.labels.footer, right, footerY + 0.5, 6.3);
    writeLatinCenter(pdf, `${page} / ${pages}`, PAGE.width / 2, footerY + 0.5, 6.7);
  }

  return pdf.output('blob');
}

export const downloadReportPdf = downloadInvoicePdf;
export const shareReportPdf = shareInvoicePdf;
