import type { SourceCompany, SourceCustomer } from '@/modules/documents/builder/from-invoice';
import type { SourcePayment } from '@/modules/documents/builder/from-payment';
import type { DocBlockAlignment, DocBlockImageSize, DocSectionLayoutItem } from '@/modules/documents/types';
import { getDocumentImagePdfSize } from '@/modules/documents/utils/block-image-size';
import { downloadInvoicePdf, shareInvoicePdf } from '@/modules/invoices/services/invoice-pdf';

const PAGE = { width: 210, height: 297, margin: 10, contentWidth: 190 };
const FONT_FILE = 'NotoSansArabic-Regular.ttf';
const FONT_FAMILY = 'NotoSansArabic';

type PdfDoc = import('jspdf').jsPDF;
type ArabicPdfDoc = PdfDoc & { processArabic?: (text: string) => string };

export interface PaymentPdfLabels {
  receiptTitle: string;
  paymentTitle: string;
  receiptSubtitle: string;
  paymentSubtitle: string;
  company: string;
  customer: string;
  supplier: string;
  voucherNumber: string;
  date: string;
  method: string;
  reference: string;
  status: string;
  amount: string;
  allocations: string;
  onAccount: string;
  notes: string;
  cash: string;
  bank: string;
  vatNumber: string;
  crNumber: string;
  description: string;
  total: string;
  footer: string;
}

export interface PaymentPdfInput {
  payment: SourcePayment & { status?: string };
  company: SourceCompany | null;
  partner: SourceCustomer | null;
  logoUrl?: string | null;
  /** أصول ومحتوى مراجعة PDF المثبتة، أو التعيين الحي قبل إصدار السند. */
  stampUrl?: string | null;
  signatureUrl?: string | null;
  bankText?: string | null;
  templateLayout?: DocSectionLayoutItem[] | null;
  /** تذييل مراجعة PDF المثبتة وقت ترحيل السند، إن وُجد. */
  footerText?: string | null;
  labels: PaymentPdfLabels;
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

function writeLatinRight(pdf: PdfDoc, text: string, x: number, y: number, size: number, bold = false) {
  setLatin(pdf, size, bold);
  pdf.text(text, x, y, { align: 'right' });
}

function writeLatinCenter(pdf: PdfDoc, text: string, x: number, y: number, size: number, bold = false) {
  setLatin(pdf, size, bold);
  pdf.text(text, x, y, { align: 'center' });
}

function money(value: string): string {
  return `${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0))} SAR`;
}

async function toPdfImage(source: string | null | undefined): Promise<string | null> {
  if (!source) return null;
  if (source.startsWith('data:image/')) return source;
  try {
    const response = await fetch(source);
    const blob = await response.blob();
    if (!response.ok || !blob.type.startsWith('image/')) return null;
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export function resolvePaymentPdfBlockContent(
  layout: DocSectionLayoutItem[] | null | undefined,
  key: 'bank',
  fallback: string | null | undefined,
): string | null {
  const block = layout?.find((candidate) => candidate.key === key);
  if (!block?.visible) return null;
  const content = (block.properties?.static_content ?? fallback)?.trim();
  return content || null;
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

/** يرسم سند قبض أو صرف عربياً كنص متجهي، لا كتقاط صورة من DOM. */
export async function createPaymentPdf(input: PaymentPdfInput): Promise<Blob> {
  const logoSource = input.logoUrl?.trim() ? input.logoUrl : input.company?.logo;
  const [{ jsPDF }, fontData, logo, stamp, signature] = await Promise.all([
    import('jspdf'), arabicFontData(), toPdfImage(logoSource), toPdfImage(input.stampUrl), toPdfImage(input.signatureUrl),
  ]);
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', putOnlyUsedFonts: true }) as ArabicPdfDoc;
  pdf.addFileToVFS(FONT_FILE, fontData);
  pdf.addFont(FONT_FILE, FONT_FAMILY, 'normal');
  pdf.addFont(FONT_FILE, FONT_FAMILY, 'bold');

  const left = PAGE.margin;
  const right = PAGE.width - PAGE.margin;
  const isReceipt = input.payment.direction === 'received';
  const title = isReceipt ? input.labels.receiptTitle : input.labels.paymentTitle;
  const subtitle = isReceipt ? input.labels.receiptSubtitle : input.labels.paymentSubtitle;
  const partyLabel = isReceipt ? input.labels.customer : input.labels.supplier;

  pdf.setFillColor(15, 39, 72);
  pdf.roundedRect(left, 10, PAGE.contentWidth, 43, 2, 2, 'F');
  pdf.setFillColor(37, 99, 235);
  pdf.rect(left, 50, PAGE.contentWidth, 3, 'F');
  const logoShown = drawLogo(pdf, logo, right - 31, 15, 23, 22);
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
  writeArabicRight(pdf, title, 112, 23.5, 14.5, true);
  writeArabicRight(pdf, subtitle, 112, 32.5, 7.2);
  writeArabicRight(pdf, `${input.labels.voucherNumber}:`, 112, 41, 6.7);
  writeLatinRight(pdf, input.payment.number, 73, 41, 7.2, true);
  pdf.setTextColor(21, 24, 29);

  const cardY = 62;
  const cardW = (PAGE.contentWidth - 5) / 2;
  const drawIdentityCard = (x: number, label: string, name: string, details: Array<string | null | undefined>) => {
    pdf.setFillColor(248, 250, 252);
    pdf.setDrawColor(226, 232, 240);
    pdf.roundedRect(x, cardY, cardW, 29, 1.5, 1.5, 'FD');
    writeArabicRight(pdf, label, x + cardW - 3, cardY + 6.5, 7, true);
    writeArabicRight(pdf, name || '—', x + cardW - 3, cardY + 14.5, 8.3, true);
    details.filter(Boolean).slice(0, 2).forEach((detail, index) => {
      writeArabicRight(pdf, String(detail), x + cardW - 3, cardY + 21 + index * 5, 6.2);
    });
  };
  drawIdentityCard(right - cardW, input.labels.company, input.company?.name ?? '—', [
    input.company?.vat_number && `${input.labels.vatNumber}: ${input.company.vat_number}`,
    input.company?.cr_number && `${input.labels.crNumber}: ${input.company.cr_number}`,
  ]);
  drawIdentityCard(left, partyLabel, input.partner?.name ?? '—', [
    input.partner?.vat_number && `${input.labels.vatNumber}: ${input.partner.vat_number}`,
    input.partner?.city,
  ]);

  const detailsY = 99;
  pdf.setFillColor(248, 250, 252);
  pdf.setDrawColor(226, 232, 240);
  pdf.roundedRect(left, detailsY, PAGE.contentWidth, 29, 1.5, 1.5, 'FD');
  writeArabicRight(pdf, input.labels.date, right - 4, detailsY + 8, 7, true);
  writeLatinRight(pdf, input.payment.payment_date, right - 4, detailsY + 16, 8, true);
  writeArabicRight(pdf, input.labels.method, 137, detailsY + 8, 7, true);
  writeArabicRight(pdf, input.payment.method === 'bank' ? input.labels.bank : input.labels.cash, 137, detailsY + 16, 8.2, true);
  writeArabicRight(pdf, input.labels.reference, 72, detailsY + 8, 7, true);
  writeLatinRight(pdf, input.payment.reference || '—', 72, detailsY + 16, 8, true);
  if (input.payment.status) {
    writeArabicRight(pdf, input.labels.status, right - 4, detailsY + 24, 6.5, true);
    writeArabicRight(pdf, input.payment.status, right - 22, detailsY + 24, 6.8, true);
  }

  const amountY = 140;
  pdf.setFillColor(15, 39, 72);
  pdf.roundedRect(left, amountY, PAGE.contentWidth, 31, 1.5, 1.5, 'F');
  pdf.setTextColor(255, 255, 255);
  writeArabicCenter(pdf, input.labels.amount, PAGE.width / 2, amountY + 9, 8, true);
  writeLatinCenter(pdf, money(input.payment.amount), PAGE.width / 2, amountY + 22, 15, true);
  pdf.setTextColor(21, 24, 29);

  let y = 184;
  const allocations = input.payment.allocations ?? [];
  writeArabicRight(pdf, input.labels.allocations, right, y, 9.2, true);
  y += 6;
  pdf.setFillColor(15, 39, 72);
  pdf.setDrawColor(15, 39, 72);
  pdf.rect(left, y, PAGE.contentWidth, 10, 'FD');
  pdf.setTextColor(255, 255, 255);
  writeArabicRight(pdf, input.labels.description, right - 3, y + 6.4, 7.2, true);
  writeArabicCenter(pdf, input.labels.total, left + 31, y + 6.4, 7.2, true);
  pdf.setTextColor(21, 24, 29);
  y += 10;
  const rows = allocations.length ? allocations : [{ label: input.labels.onAccount, amount: input.payment.amount }];
  rows.forEach((row, index) => {
    const height = 11;
    if (y + height > 268) {
      pdf.addPage();
      y = 25;
    }
    pdf.setFillColor(index % 2 ? 248 : 255, index % 2 ? 250 : 255, index % 2 ? 252 : 255);
    pdf.setDrawColor(226, 232, 240);
    pdf.rect(left, y, PAGE.contentWidth, height, 'FD');
    writeArabicRight(pdf, row.label, right - 3, y + 7, 7.5);
    writeLatinCenter(pdf, money(row.amount), left + 31, y + 7, 8, true);
    pdf.line(left + 62, y, left + 62, y + height);
    y += height;
  });

  if (input.payment.notes) {
    y += 10;
    writeArabicRight(pdf, input.labels.notes, right, y, 8, true);
    y += 5;
    setArabic(pdf, 7.2);
    const notes = pdf.splitTextToSize(asArabic(pdf, input.payment.notes), PAGE.contentWidth - 6) as string[];
    pdf.setFillColor(248, 250, 252);
    pdf.setDrawColor(226, 232, 240);
    const noteHeight = Math.max(14, notes.length * 4.5 + 7);
    if (y + noteHeight > 268) { pdf.addPage(); y = 25; }
    pdf.roundedRect(left, y, PAGE.contentWidth, noteHeight, 1.5, 1.5, 'FD');
    pdf.text(notes, right - 3, y + 6, { align: 'right', lineHeightFactor: 1.1 });
    y += noteHeight;
  }

  const bankBlock = input.templateLayout?.find((block) => block.key === 'bank');
  const bankContent = resolvePaymentPdfBlockContent(input.templateLayout, 'bank', input.bankText);
  if (bankContent) {
    y += 10;
    const lines = pdf.splitTextToSize(asArabic(pdf, bankContent), PAGE.contentWidth - 8) as string[];
    const height = Math.max(14, lines.length * 4.5 + 8);
    if (y + height > 268) { pdf.addPage(); y = 25; }
    pdf.setFillColor(248, 250, 252);
    pdf.setDrawColor(226, 232, 240);
    pdf.roundedRect(left, y, PAGE.contentWidth, height, 1.5, 1.5, 'FD');
    writeArabicRight(pdf, input.labels.bank, right - 3, y + 5.5, 6.8, true);
    const alignment: Record<DocBlockAlignment, 'left' | 'center' | 'right'> = { start: 'right', center: 'center', end: 'left' };
    const textAlign = alignment[bankBlock?.properties?.alignment ?? 'start'];
    const textX = textAlign === 'left' ? left + 4 : textAlign === 'center' ? PAGE.width / 2 : right - 4;
    setArabic(pdf, 7.2);
    pdf.text(lines, textX, y + 10, { align: textAlign, lineHeightFactor: 1.1 });
    y += height;
  }

  const stampBlock = input.templateLayout?.find((block) => block.key === 'stamp');
  const signatureBlock = input.templateLayout?.find((block) => block.key === 'signature');
  const assets = [
    { image: stamp, visible: stampBlock?.visible === true, size: stampBlock?.properties?.image_size },
    { image: signature, visible: signatureBlock?.visible === true, size: signatureBlock?.properties?.image_size },
  ].filter((asset): asset is { image: string; visible: true; size: DocBlockImageSize | undefined } => Boolean(asset.image) && asset.visible)
    .map((asset) => ({ ...asset, ...getDocumentImagePdfSize(asset.size, 32, 22) }));
  if (assets.length) {
    const gap = 8;
    const maxHeight = Math.max(...assets.map((asset) => asset.height));
    y += 8;
    if (y + maxHeight + 4 > 268) { pdf.addPage(); y = 25; }
    const totalWidth = assets.reduce((sum, asset) => sum + asset.width, 0) + (assets.length - 1) * gap;
    let x = right - totalWidth;
    assets.forEach((asset) => {
      drawLogo(pdf, asset.image, x, y, asset.width, asset.height);
      x += asset.width + gap;
    });
  }

  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    pdf.setPage(page);
    const footerY = PAGE.height - 12;
    pdf.setDrawColor(203, 213, 225);
    pdf.line(left, footerY - 5, right, footerY - 5);
    writeArabicRight(pdf, input.footerText?.trim() || input.labels.footer, right, footerY + 0.5, 6.3);
    writeLatinCenter(pdf, `${page} / ${pages}`, PAGE.width / 2, footerY + 0.5, 6.7);
  }

  return pdf.output('blob');
}

export const downloadPaymentPdf = downloadInvoicePdf;
export const sharePaymentPdf = shareInvoicePdf;
