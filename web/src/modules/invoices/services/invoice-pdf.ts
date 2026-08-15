import type { Company, Customer, InvoiceDoc } from '@/components/invoices/invoice-document';

const PAGE = { width: 210, height: 297, margin: 10, contentWidth: 190 };
const FONT_FILE = 'NotoSansArabic-Regular.ttf';
const FONT_FAMILY = 'NotoSansArabic';

type PdfDoc = import('jspdf').jsPDF;
type ArabicPdfDoc = PdfDoc & { processArabic?: (text: string) => string };

export interface InvoicePdfLabels {
  title: string;
  titleSecondary: string;
  seller: string;
  billTo: string;
  invoiceNumber: string;
  vatNumber: string;
  crNumber: string;
  city: string;
  date: string;
  paymentType: string;
  cash: string;
  credit: string;
  description: string;
  quantity: string;
  unitPrice: string;
  tax: string;
  total: string;
  subtotal: string;
  vat: string;
  grandTotal: string;
  qrNote: string;
  footer: string;
}

export interface InvoicePdfInput {
  invoice: InvoiceDoc;
  company: Company | null;
  customer: Customer | null;
  /** صورة PNG للـ QR مستخرجة من SVG المعاينة، كي يبقى رمز ZATCA مطابقاً للمستند المرئي. */
  qrImage?: string | null;
  /** شعار إعدادات التصميم له أولوية، ثم شعار هوية الشركة. */
  logoUrl?: string | null;
  labels: InvoicePdfLabels;
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

function writeLatinRight(pdf: PdfDoc, text: string, x: number, y: number, size: number, bold = false) {
  setLatin(pdf, size, bold);
  pdf.text(text, x, y, { align: 'right' });
}

function writeLatinCenter(pdf: PdfDoc, text: string, x: number, y: number, size: number, bold = false) {
  setLatin(pdf, size, bold);
  pdf.text(text, x, y, { align: 'center' });
}

function money(value: string): string {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0)) + ' SAR';
}

function date(value: string, locale: string): string {
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.valueOf())) return value;
  // التاريخ المالي يُكتب بأرقام لاتينية محايدة داخل PDF لتجنّب أثر bidi مع العربية.
  return new Intl.DateTimeFormat(locale === 'ar' ? 'en-GB' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(parsed);
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

/**
 * مولد فاتورة مبيعات متجهي: لا يصوّر HTML، لذلك تظل العربية حروفاً نصية واضحة
 * في PDF، ولا تتأثر بنتيجة html2canvas أو اختلاف أبعاد شاشة المصدر.
 */
export async function createInvoicePdf(input: InvoicePdfInput): Promise<Blob> {
  const [{ jsPDF }, fontData] = await Promise.all([import('jspdf'), arabicFontData()]);
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', putOnlyUsedFonts: true }) as ArabicPdfDoc;
  pdf.addFileToVFS(FONT_FILE, fontData);
  pdf.addFont(FONT_FILE, FONT_FAMILY, 'normal');
  pdf.addFont(FONT_FILE, FONT_FAMILY, 'bold');

  const right = PAGE.width - PAGE.margin;
  const left = PAGE.margin;
  const logo = input.logoUrl?.trim() ? input.logoUrl : input.company?.logo;
  const generated = new Intl.DateTimeFormat('en-GB', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date()).replace(',', '');
  let y = 18;

  const drawHeader = (continued = false) => {
    pdf.setFillColor(15, 39, 72);
    pdf.roundedRect(left, 10, PAGE.contentWidth, continued ? 25 : 43, 2, 2, 'F');
    pdf.setFillColor(37, 99, 235);
    pdf.rect(left, continued ? 33 : 50, PAGE.contentWidth, 3, 'F');

    if (continued) {
      drawLogo(pdf, logo, right - 28, 13, 20, 17);
      pdf.setTextColor(255, 255, 255);
      writeArabicRight(pdf, `${input.labels.title} · ${input.invoice.number}`, right - 32, 25, 10.5, true);
      pdf.setTextColor(21, 24, 29);
      y = 43;
      return;
    }

    const logoShown = drawLogo(pdf, logo, right - 31, 15, 23, 22);
    if (!logoShown) {
      pdf.setFillColor(255, 255, 255);
      pdf.roundedRect(right - 31, 15, 23, 22, 1.5, 1.5, 'F');
      pdf.setTextColor(37, 99, 235);
      writeArabicRight(pdf, 'ن', right - 15, 30, 12, true);
    }

    pdf.setTextColor(255, 255, 255);
    writeArabicRight(pdf, input.company?.name ?? 'Nebrax', right - 35, 23, 10.5, true);
    const identity = [
      input.company?.vat_number && `${input.labels.vatNumber}: ${input.company.vat_number}`,
      input.company?.cr_number && `${input.labels.crNumber}: ${input.company.cr_number}`,
    ].filter(Boolean).join('  •  ');
    if (identity) writeArabicRight(pdf, identity, right - 35, 31, 6.5);
    writeArabicRight(pdf, input.labels.title, 112, 23.5, 14.5, true);
    writeArabicRight(pdf, input.labels.titleSecondary, 112, 32.5, 7.2);
    writeArabicRight(pdf, `${input.labels.invoiceNumber}:`, 112, 41, 6.7);
    writeLatinRight(pdf, input.invoice.number, 73, 41, 7.2, true);
    pdf.setTextColor(21, 24, 29);

    const cardY = 60;
    const cardW = (PAGE.contentWidth - 8) / 3;
    const infoCard = (x: number, title: string, details: Array<[string, string | null | undefined]>) => {
      pdf.setFillColor(248, 250, 252);
      pdf.setDrawColor(226, 232, 240);
      pdf.roundedRect(x, cardY, cardW, 29, 1.5, 1.5, 'FD');
      writeArabicRight(pdf, title, x + cardW - 3, cardY + 6.5, 7, true);
      let innerY = cardY + 13;
      details.filter(([, value]) => Boolean(value)).slice(0, 3).forEach(([label, value]) => {
        writeArabicRight(pdf, label, x + cardW - 3, innerY, 6.4);
        const safeValue = String(value ?? '—');
        if (/^[A-Za-z0-9 .:/-]+$/.test(safeValue)) writeLatinRight(pdf, safeValue, x + cardW - 24, innerY, 6.8, true);
        else writeArabicRight(pdf, safeValue, x + cardW - 24, innerY, 7, true);
        innerY += 6.2;
      });
    };
    infoCard(right - cardW, input.labels.seller, [
      [input.labels.vatNumber, input.company?.vat_number], [input.labels.crNumber, input.company?.cr_number],
    ]);
    infoCard(right - cardW * 2 - 4, input.labels.billTo, [
      [input.labels.vatNumber, input.customer?.vat_number], [input.labels.city, input.customer?.city],
    ]);
    infoCard(left, input.labels.paymentType, [
      [input.labels.date, date(input.invoice.invoice_date, input.locale)],
      [input.labels.paymentType, input.invoice.payment_type === 'cash' ? input.labels.cash : input.labels.credit],
    ]);
    y = 100;
  };

  const columns = [
    { label: '#', width: 10, kind: 'latin' as const },
    { label: input.labels.description, width: 56, kind: 'arabic' as const },
    { label: input.labels.quantity, width: 20, kind: 'arabic' as const },
    { label: input.labels.unitPrice, width: 32, kind: 'arabic' as const },
    { label: input.labels.tax, width: 32, kind: 'arabic' as const },
    { label: input.labels.total, width: 40, kind: 'arabic' as const },
  ];

  const drawTableHeader = () => {
    pdf.setFillColor(15, 39, 72);
    pdf.setDrawColor(15, 39, 72);
    pdf.rect(left, y, PAGE.contentWidth, 10, 'FD');
    pdf.setTextColor(255, 255, 255);
    let cursor = right;
    columns.forEach((column) => {
      if (column.kind === 'arabic') writeArabicRight(pdf, column.label, cursor - 2, y + 6.35, 7.1, true);
      else writeLatinCenter(pdf, column.label, cursor - column.width / 2, y + 6.35, 7.2, true);
      cursor -= column.width;
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

  const drawLine = (line: InvoiceDoc['lines'][number], index: number) => {
    setArabic(pdf, 7.6);
    const description = pdf.splitTextToSize(asArabic(pdf, line.description ?? '—'), columns[1].width - 4) as string[];
    const height = Math.max(12, description.length * 4.5 + 4.5);
    if (y + height > PAGE.height - 62) nextPage();
    if (index % 2 === 1) pdf.setFillColor(248, 250, 252);
    else pdf.setFillColor(255, 255, 255);
    pdf.setDrawColor(226, 232, 240);
    pdf.rect(left, y, PAGE.contentWidth, height, 'FD');
    let cursor = right;
    const cells = [
      String(index + 1), line.description ?? '—', String(line.quantity), money(line.unit_price), money(line.line_tax), money(line.line_total),
    ];
    cells.forEach((value, cellIndex) => {
      const width = columns[cellIndex].width;
      if (cellIndex === 1) {
        setArabic(pdf, 7.6);
        pdf.text(description, cursor - 2, y + 5.6, { align: 'right', lineHeightFactor: 1.08 });
      } else {
        writeLatinCenter(pdf, value, cursor - width / 2, y + height / 2 + 2.5, cellIndex >= 3 ? 7.2 : 7.4, cellIndex >= 3);
      }
      cursor -= width;
      if (cursor > left) pdf.line(cursor, y, cursor, y + height);
    });
    y += height;
  };

  drawHeader();
  drawTableHeader();
  input.invoice.lines.forEach(drawLine);

  if (y > PAGE.height - 78) {
    pdf.addPage();
    drawHeader(true);
  }

  const totalsX = left;
  const totalsW = 79;
  // يبدأ الملخص فور انتهاء الجدول؛ الفراغ الكبير يجعل الفاتورة القصيرة غير متوازنة بصرياً.
  const bottomY = y + 8;
  const drawTotalRow = (rowY: number, label: string, value: string, emphasized = false) => {
    pdf.setFillColor(emphasized ? 15 : 248, emphasized ? 39 : 250, emphasized ? 72 : 252);
    pdf.setDrawColor(emphasized ? 15 : 226, emphasized ? 39 : 232, emphasized ? 72 : 240);
    pdf.rect(totalsX, rowY, totalsW, 11, 'FD');
    pdf.setTextColor(emphasized ? 255 : 21, emphasized ? 255 : 24, emphasized ? 255 : 29);
    writeArabicRight(pdf, label, totalsX + totalsW - 3, rowY + 7, 7.4, emphasized);
    writeLatinRight(pdf, value, totalsX + 31, rowY + 7, 8.5, true);
    pdf.setTextColor(21, 24, 29);
  };
  drawTotalRow(bottomY, input.labels.subtotal, money(input.invoice.subtotal));
  // نحذف نسبة الضريبة بين الأقواس في النص المرسوم، لأن مزج الأقواس والأرقام بالعربية
  // قد يُظهر «15» منفصلاً في jsPDF رغم سلامة باقي النص.
  const vatLabel = input.labels.vat.replace(/\s*\([^)]*\)/, '');
  drawTotalRow(bottomY + 11, vatLabel, money(input.invoice.tax_amount));
  drawTotalRow(bottomY + 22, input.labels.grandTotal, money(input.invoice.total), true);

  if (input.qrImage) {
    const qrSize = 39;
    const qrX = right - qrSize;
    const qrY = bottomY - 2;
    pdf.setFillColor(255, 255, 255);
    pdf.setDrawColor(226, 232, 240);
    pdf.roundedRect(qrX - 2, qrY - 2, qrSize + 4, qrSize + 4, 1.5, 1.5, 'FD');
    pdf.addImage(input.qrImage, 'PNG', qrX, qrY, qrSize, qrSize, undefined, 'FAST');
    writeArabicRight(pdf, input.labels.qrNote, right, qrY + qrSize + 8, 6.2);
  }

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

export function downloadInvoicePdf(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function shareInvoicePdf(blob: Blob, fileName: string, title: string): Promise<'shared' | 'downloaded'> {
  const name = fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`;
  const file = new File([blob], name, { type: 'application/pdf' });
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (typeof navigator.share === 'function' && nav.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title });
    return 'shared';
  }
  downloadInvoicePdf(blob, name);
  return 'downloaded';
}
