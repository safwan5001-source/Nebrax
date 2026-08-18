import type { Company, Customer, InvoiceDoc } from '@/components/invoices/invoice-document';

import { DEFAULT_DOCUMENT_ITEMS_COLUMNS } from '@/modules/documents/registry/document-types';
import { getDocumentImagePdfOpacity, getDocumentImagePdfSize, getDocumentImagePdfX, withDocumentImagePdfOpacity } from '@/modules/documents/utils/block-image-size';
import type { DocBlockAlignment, DocBlockImageSize, DocItemsColumn, DocItemsColumnId, DocSectionLayoutItem, DocSectionProperties } from '@/modules/documents/types';

type PdfOrientation = 'portrait' | 'landscape';
type PdfPage = { orientation: PdfOrientation; width: number; height: number; margin: number; contentWidth: number };

const PDF_PAGES: Record<PdfOrientation, PdfPage> = {
  portrait: { orientation: 'portrait', width: 210, height: 297, margin: 10, contentWidth: 190 },
  landscape: { orientation: 'landscape', width: 297, height: 210, margin: 10, contentWidth: 277 },
};
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
  product: string;
  description: string;
  productCode?: string;
  barcode?: string;
  quantity: string;
  priceBeforeTax?: string;
  unitPrice: string;
  tax: string;
  total: string;
  subtotal: string;
  vat: string;
  grandTotal: string;
  qrNote: string;
  terms: string;
  bank: string;
  footer: string;
}

export interface InvoicePdfAdjustment {
  label: string;
  amount: string;
  negative?: boolean;
}

export interface InvoicePdfInput {
  invoice: InvoiceDoc;
  company: Company | null;
  customer: Customer | null;
  /** صورة PNG للـ QR مستخرجة من SVG المعاينة، كي يبقى رمز ZATCA مطابقاً للمستند المرئي. */
  qrImage?: string | null;
  /** شعار إعدادات التصميم له أولوية، ثم شعار هوية الشركة. */
  logoUrl?: string | null;
  /** ختم وتوقيع المراجعة المثبتة؛ لا يُعاد حلهما من إعدادات حية عند التنزيل. */
  stampUrl?: string | null;
  signatureUrl?: string | null;
  /** تذييل المراجعة المثبتة عند إصدار المستند؛ لا يُعاد قراءته من الإعدادات الحية. */
  footerText?: string | null;
  /** تخطيط مراجعة المخرج المثبتة؛ يزوّد PDF بخصائص الكتل نفسها التي يستهلكها العارض. */
  templateLayout?: DocSectionLayoutItem[] | null;
  /** الشروط التي جُمّدت مع مراجعة القالب أو قُرئت من التصميم الحي قبل الإصدار. */
  termsText?: string | null;
  /** بيانات التحويل البنكي التي جُمّدت مع مراجعة القالب أو قُرئت من التصميم الحي قبل الإصدار. */
  bankText?: string | null;
  /** حقول إضافية للمستندات غير البيعية، مثل رقم فاتورة المورد وتاريخ الاستحقاق. */
  documentMeta?: Array<[string, string | null | undefined]>;
  /** الخصم أو الشحن أو التسوية؛ تظهر بين الإجمالي الفرعي والضريبة. */
  adjustments?: InvoicePdfAdjustment[];
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

const DEFAULT_ITEM_COLUMNS: readonly DocItemsColumn[] = DEFAULT_DOCUMENT_ITEMS_COLUMNS.map((id) => ({ id }));

function layoutBlock(layout: DocSectionLayoutItem[] | null | undefined, key: DocSectionLayoutItem['key']): DocSectionLayoutItem | undefined {
  return layout?.find((item) => item.key === key);
}

function blockProperties(layout: DocSectionLayoutItem[] | null | undefined, key: DocSectionLayoutItem['key']): DocSectionProperties {
  return layoutBlock(layout, key)?.properties ?? {};
}

/**
 * لا يكفي وجود محتوى للكتلة: PDF يلتزم بظهورها المنشور كما تفعل معاينة المستند.
 * المحتوى الثابت، حتى إن كان فارغاً، يحجب القيمة الديناميكية كي لا يتسرّب إعداد
 * حي إلى مستند يستند إلى مراجعة تاريخية.
 */
export function resolvePdfBlockContent(
  layout: DocSectionLayoutItem[] | null | undefined,
  key: 'terms' | 'bank',
  fallback: string | null | undefined,
): string | null {
  const block = layoutBlock(layout, key);
  if (!block?.visible) return null;
  const value = block.properties?.static_content ?? fallback;
  const content = value?.trim();
  return content ? content : null;
}

function pdfBlockFontSize(properties: DocSectionProperties): number {
  const sizes: Record<NonNullable<DocSectionProperties['font_size']>, number> = { sm: 7, md: 8, lg: 9 };
  return properties.font_size ? sizes[properties.font_size] : 7.6;
}

function itemColumns(properties: DocSectionProperties): readonly DocItemsColumn[] {
  return properties.columns?.length ? properties.columns : DEFAULT_ITEM_COLUMNS;
}

/** يحافظ الجدول المختصر على A4 رأسي، ويستخدم العرض الأفقي عند كثافة الأعمدة. */
export function getInvoicePdfOrientation(columns: readonly DocItemsColumn[]): PdfOrientation {
  return columns.length >= 8 ? 'landscape' : 'portrait';
}

function pdfAlignment(alignment: DocBlockAlignment): 'left' | 'center' | 'right' {
  const alignments: Record<DocBlockAlignment, 'left' | 'center' | 'right'> = { start: 'right', center: 'center', end: 'left' };
  return alignments[alignment];
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
  const itemsProperties = blockProperties(input.templateLayout, 'items');
  const selectedColumns = itemColumns(itemsProperties);
  const orientation = getInvoicePdfOrientation(selectedColumns);
  const pdfPage = PDF_PAGES[orientation];
  const compactTable = orientation === 'landscape';
  const logoSource = input.logoUrl?.trim() ? input.logoUrl : input.company?.logo;
  const [{ jsPDF }, fontData, logo, stamp, signature] = await Promise.all([
    import('jspdf'), arabicFontData(), toPdfImage(logoSource), toPdfImage(input.stampUrl), toPdfImage(input.signatureUrl),
  ]);
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation, putOnlyUsedFonts: true }) as ArabicPdfDoc;
  pdf.addFileToVFS(FONT_FILE, fontData);
  pdf.addFont(FONT_FILE, FONT_FAMILY, 'normal');
  pdf.addFont(FONT_FILE, FONT_FAMILY, 'bold');

  const right = pdfPage.width - pdfPage.margin;
  const left = pdfPage.margin;
  const generated = new Intl.DateTimeFormat('en-GB', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date()).replace(',', '');
  let y = 18;

  const drawHeader = (continued = false) => {
    pdf.setFillColor(15, 39, 72);
    pdf.roundedRect(left, 10, pdfPage.contentWidth, continued ? 25 : 43, 2, 2, 'F');
    pdf.setFillColor(37, 99, 235);
    pdf.rect(left, continued ? 33 : 50, pdfPage.contentWidth, 3, 'F');

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
    const documentTitleX = compactTable ? left + pdfPage.contentWidth * 0.58 : 112;
    const documentNumberX = compactTable ? left + pdfPage.contentWidth * 0.32 : 73;
    writeArabicRight(pdf, input.labels.title, documentTitleX, 23.5, 14.5, true);
    writeArabicRight(pdf, input.labels.titleSecondary, documentTitleX, 32.5, 7.2);
    writeArabicRight(pdf, `${input.labels.invoiceNumber}:`, documentTitleX, 41, 6.7);
    writeLatinRight(pdf, input.invoice.number, documentNumberX, 41, 7.2, true);
    pdf.setTextColor(21, 24, 29);

    const cardY = 60;
    const cardW = (pdfPage.contentWidth - 8) / 3;
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
    infoCard(left, input.labels.paymentType, input.documentMeta ?? [
      [input.labels.date, date(input.invoice.invoice_date, input.locale)],
      [input.labels.paymentType, input.invoice.payment_type === 'cash' ? input.labels.cash : input.labels.credit],
    ]);
    y = compactTable ? 94 : 100;
  };

  const termsProperties = blockProperties(input.templateLayout, 'terms');
  const bankProperties = blockProperties(input.templateLayout, 'bank');
  const footerProperties = blockProperties(input.templateLayout, 'footer');
  const stampBlock = layoutBlock(input.templateLayout, 'stamp');
  const signatureBlock = layoutBlock(input.templateLayout, 'signature');
  const termsContent = resolvePdfBlockContent(input.templateLayout, 'terms', input.termsText);
  const bankContent = resolvePdfBlockContent(input.templateLayout, 'bank', input.bankText);
  const columnLabels: Record<DocItemsColumnId, string> = {
    number: '#', product: input.labels.product, description: input.labels.description,
    product_code: input.labels.productCode ?? 'SKU', barcode: input.labels.barcode ?? 'Barcode',
    quantity: input.labels.quantity, price_before_tax: input.labels.priceBeforeTax ?? 'Net price',
    unit_price: input.labels.unitPrice, tax: input.labels.tax, total: input.labels.total,
  };
  const columnWeights: Record<DocItemsColumnId, number> = {
    number: 10, product_code: 28, barcode: 34, product: 42, description: 52,
    unit_price: 32, quantity: 20, price_before_tax: 34, tax: 32, total: 40,
  };
  const totalWeight = selectedColumns.reduce((sum, column) => sum + columnWeights[column.id], 0);
  const defaultAlignment = (id: DocItemsColumnId): DocBlockAlignment => (
    id === 'number' || id === 'product' || id === 'description' || id === 'product_code' || id === 'barcode'
      ? 'start'
      : 'end'
  );
  const columns = selectedColumns.map((column) => ({
    ...column,
    label: column.label?.trim() || columnLabels[column.id],
    width: pdfPage.contentWidth * columnWeights[column.id] / totalWeight,
    kind: column.id === 'product' || column.id === 'description' ? 'arabic' as const : 'latin' as const,
    alignment: column.alignment ?? itemsProperties.alignment ?? defaultAlignment(column.id),
  }));
  const tableHeaderHeight = compactTable ? 8 : 10;
  const tableArabicHeaderFontSize = compactTable ? 6.3 : 7.1;
  const tableLatinHeaderFontSize = compactTable ? 6.4 : 7.2;
  const tableArabicBodyFontSize = compactTable ? 6.8 : 7.6;
  const tableLatinBodyFontSize = compactTable ? 6.3 : 7.4;
  const tableLineHeight = compactTable ? 3.9 : 4.5;
  const tablePageBottom = pdfPage.height - (compactTable ? 45 : 62);

  const drawTableHeader = () => {
    pdf.setFillColor(15, 39, 72);
    pdf.setDrawColor(15, 39, 72);
    pdf.rect(left, y, pdfPage.contentWidth, tableHeaderHeight, 'FD');
    pdf.setTextColor(255, 255, 255);
    let cursor = right;
    columns.forEach((column) => {
      const cellStart = cursor - column.width;
      const alignment = pdfAlignment(column.alignment);
      const x = alignment === 'left' ? cellStart + 1.5 : alignment === 'center' ? cellStart + column.width / 2 : cursor - 1.5;
      if (column.kind === 'arabic') {
        setArabic(pdf, tableArabicHeaderFontSize, true);
        pdf.text(asArabic(pdf, column.label), x, y + tableHeaderHeight / 2 + 2.05, { align: alignment });
      } else {
        setLatin(pdf, tableLatinHeaderFontSize, true);
        pdf.text(column.label, x, y + tableHeaderHeight / 2 + 2.05, { align: alignment });
      }
      cursor -= column.width;
      if (cursor > left) pdf.line(cursor, y, cursor, y + tableHeaderHeight);
    });
    pdf.setTextColor(21, 24, 29);
    y += tableHeaderHeight;
  };

  const nextPage = () => {
    pdf.addPage();
    drawHeader(true);
    drawTableHeader();
  };

  const drawLine = (line: InvoiceDoc['lines'][number], index: number) => {
    const descriptionColumn = columns.find((column) => column.id === 'description');
    if (!descriptionColumn) return;
    setArabic(pdf, tableArabicBodyFontSize);
    const productValue = line.product_name ?? '—';
    const descriptionValue = line.description ?? '—';
    const productColumn = columns.find((column) => column.id === 'product');
    const product = productColumn
      ? pdf.splitTextToSize(asArabic(pdf, productValue), productColumn.width - 4) as string[]
      : [];
    const description = pdf.splitTextToSize(asArabic(pdf, descriptionValue), descriptionColumn.width - 4) as string[];
    const height = Math.max(
      compactTable ? 10 : 12,
      product.length * tableLineHeight + (compactTable ? 4 : 4.5),
      description.length * tableLineHeight + (compactTable ? 4 : 4.5),
    );
    if (y + height > tablePageBottom) nextPage();
    if (index % 2 === 1) pdf.setFillColor(248, 250, 252);
    else pdf.setFillColor(255, 255, 255);
    pdf.setDrawColor(226, 232, 240);
    pdf.rect(left, y, pdfPage.contentWidth, height, 'FD');
    const values: Record<DocItemsColumnId, string> = {
      number: String(index + 1), product: productValue, description: descriptionValue,
      product_code: line.product_code ?? '—', barcode: line.barcode ?? '—', quantity: String(line.quantity),
      price_before_tax: line.unit_price_before_tax === null || line.unit_price_before_tax === undefined
        ? '—'
        : money(line.unit_price_before_tax),
      unit_price: money(line.unit_price), tax: money(line.line_tax), total: money(line.line_total),
    };
    let cursor = right;
    columns.forEach((column) => {
      const cellStart = cursor - column.width;
      const alignment = pdfAlignment(column.alignment);
      const x = alignment === 'left' ? cellStart + 1.5 : alignment === 'center' ? cellStart + column.width / 2 : cursor - 1.5;
      if (column.id === 'product' || column.id === 'description') {
        setArabic(pdf, tableArabicBodyFontSize);
        pdf.text(column.id === 'product' ? product : description, x, y + (compactTable ? 4.6 : 5.6), { align: alignment, lineHeightFactor: 1.08 });
      } else {
        const isMoney = column.id === 'price_before_tax' || column.id === 'unit_price' || column.id === 'tax' || column.id === 'total';
        setLatin(pdf, isMoney ? tableLatinBodyFontSize : tableLatinBodyFontSize + 0.1, isMoney);
        pdf.text(values[column.id], x, y + height / 2 + (compactTable ? 2.1 : 2.5), { align: alignment });
      }
      cursor -= column.width;
      if (cursor > left) pdf.line(cursor, y, cursor, y + height);
    });
    y += height;
  };

  drawHeader();
  drawTableHeader();
  input.invoice.lines.forEach(drawLine);

  if (y > pdfPage.height - (compactTable ? 68 : 78)) {
    pdf.addPage();
    drawHeader(true);
  }

  const totalsX = left;
  const totalsW = compactTable ? 95 : 79;
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
  const totalRows: Array<{ label: string; value: string; emphasized?: boolean }> = [
    { label: input.labels.subtotal, value: money(input.invoice.subtotal) },
    ...(input.adjustments ?? []).map((adjustment) => ({
      label: adjustment.label,
      value: `${adjustment.negative ? '− ' : ''}${money(adjustment.amount)}`,
    })),
    // نحذف نسبة الضريبة بين الأقواس في النص المرسوم، لأن مزج الأقواس والأرقام بالعربية
    // قد يُظهر «15» منفصلاً في jsPDF رغم سلامة باقي النص.
    { label: input.labels.vat.replace(/\s*\([^)]*\)/, ''), value: money(input.invoice.tax_amount) },
    { label: input.labels.grandTotal, value: money(input.invoice.total), emphasized: true },
  ];
  totalRows.forEach((row, index) => drawTotalRow(bottomY + index * 11, row.label, row.value, row.emphasized));

  let contentStartY = bottomY + totalRows.length * 11 + 6;
  if (input.qrImage) {
    const qrSize = 39;
    const qrX = right - qrSize;
    const qrY = bottomY - 2;
    pdf.setFillColor(255, 255, 255);
    pdf.setDrawColor(226, 232, 240);
    pdf.roundedRect(qrX - 2, qrY - 2, qrSize + 4, qrSize + 4, 1.5, 1.5, 'FD');
    pdf.addImage(input.qrImage, 'PNG', qrX, qrY, qrSize, qrSize, undefined, 'FAST');
    writeArabicRight(pdf, input.labels.qrNote, right, qrY + qrSize + 8, 6.2);
    contentStartY = Math.max(contentStartY, qrY + qrSize + 13);
  }

  y = contentStartY;
  const contentBottom = pdfPage.height - 20;
  const drawContentBlock = (label: string, content: string | null, properties: DocSectionProperties) => {
    if (!content) return;
    const alignment = pdfAlignment(properties.alignment ?? 'start');
    const fontSize = pdfBlockFontSize(properties);
    const lineHeight = fontSize * 0.62;
    setArabic(pdf, fontSize);
    const lines = pdf.splitTextToSize(asArabic(pdf, content), pdfPage.contentWidth - 8) as string[];
    let offset = 0;

    while (offset < lines.length) {
      // لا نسمح لمحتوى ثابت طويل أن يطغى على تذييل الصفحة أو ينقطع في منتصف سطر.
      if (y + 14 > contentBottom) {
        pdf.addPage();
        drawHeader(true);
      }
      const availableLines = Math.max(1, Math.floor((contentBottom - y - 10) / lineHeight));
      const chunk = lines.slice(offset, offset + availableLines);
      const height = 8 + chunk.length * lineHeight;
      pdf.setFillColor(248, 250, 252);
      pdf.setDrawColor(226, 232, 240);
      pdf.roundedRect(left, y, pdfPage.contentWidth, height, 1.5, 1.5, 'FD');
      writeArabicRight(pdf, label, right - 3, y + 5, 6.8, true);
      const textX = alignment === 'left' ? left + 4 : alignment === 'center' ? pdfPage.width / 2 : right - 4;
      setArabic(pdf, fontSize);
      pdf.text(chunk, textX, y + 9, { align: alignment, lineHeightFactor: 1 });
      y += height + 5;
      offset += chunk.length;
      if (offset < lines.length) {
        pdf.addPage();
        drawHeader(true);
      }
    }
  };

  drawContentBlock(input.labels.terms, termsContent, termsProperties);
  drawContentBlock(input.labels.bank, bankContent, bankProperties);

  const assets = [
    { block: 'stamp' as const, image: stamp, visible: stampBlock?.visible === true, size: stampBlock?.properties?.image_size, opacity: stampBlock?.properties?.image_opacity, alignment: stampBlock?.properties?.alignment },
    { block: 'signature' as const, image: signature, visible: signatureBlock?.visible === true, size: signatureBlock?.properties?.image_size, opacity: signatureBlock?.properties?.image_opacity, alignment: signatureBlock?.properties?.alignment },
  ].filter((asset): asset is { block: 'stamp' | 'signature'; image: string; visible: true; size: DocBlockImageSize | undefined; opacity: DocSectionProperties['image_opacity']; alignment: DocBlockAlignment | undefined } => Boolean(asset.image) && asset.visible)
    .map((asset) => ({ ...asset, ...getDocumentImagePdfSize(asset.size, 32, 24) }));
  if (assets.length) {
    const gap = 8;
    const historicalAssets = assets.filter((asset) => asset.alignment === undefined);
    if (historicalAssets.length) {
      const maxHeight = Math.max(...historicalAssets.map((asset) => asset.height));
      if (y + maxHeight + 7 > contentBottom) { pdf.addPage(); drawHeader(true); }
      const totalWidth = historicalAssets.reduce((sum, asset) => sum + asset.width, 0) + (historicalAssets.length - 1) * gap;
      let x = right - totalWidth;
      historicalAssets.forEach((asset) => {
        withDocumentImagePdfOpacity(pdf, getDocumentImagePdfOpacity(asset.block, asset.opacity), () => {
          drawLogo(pdf, asset.image, x, y, asset.width, asset.height);
        });
        x += asset.width + gap;
      });
      y += maxHeight + 5;
    }
    assets.filter((asset) => asset.alignment !== undefined).forEach((asset) => {
      if (y + asset.height + 7 > contentBottom) { pdf.addPage(); drawHeader(true); }
      withDocumentImagePdfOpacity(pdf, getDocumentImagePdfOpacity(asset.block, asset.opacity), () => {
        drawLogo(pdf, asset.image, getDocumentImagePdfX(asset.alignment, pdfPage.width, left, right, asset.width), y, asset.width, asset.height);
      });
      y += asset.height + 5;
    });
  }

  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    pdf.setPage(page);
    const footerY = pdfPage.height - 12;
    pdf.setDrawColor(203, 213, 225);
    pdf.line(left, footerY - 5, right, footerY - 5);
    writeArabicRight(pdf, footerProperties.static_content?.trim() || input.footerText?.trim() || input.labels.footer, right, footerY + 0.5, 6.3);
    writeLatinCenter(pdf, `${page} / ${pages}`, pdfPage.width / 2, footerY + 0.5, 6.7);
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
