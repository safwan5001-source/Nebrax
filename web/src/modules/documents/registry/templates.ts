import type { DocumentTypeId, TemplateDescriptor } from '../types';
import { TaxInvoiceClassic } from '../templates/tax-invoice-classic';
import { TaxInvoiceClassicV2 } from '../templates/tax-invoice-classic-v2';
import { TaxInvoiceModern } from '../templates/tax-invoice-modern';
import { TaxInvoiceModernV2 } from '../templates/tax-invoice-modern-v2';
import { TaxInvoiceErp } from '../templates/tax-invoice-erp';
import { TaxInvoiceErpV2 } from '../templates/tax-invoice-erp-v2';
import { TaxInvoiceMinimal } from '../templates/tax-invoice-minimal';
import { TaxInvoiceMinimalV2 } from '../templates/tax-invoice-minimal-v2';
import { TaxInvoiceRetail } from '../templates/tax-invoice-retail';
import { TaxInvoiceRetailV2 } from '../templates/tax-invoice-retail-v2';
import { QuotationProposal } from '../templates/quotation-proposal';
import { PurchaseOrderFormal } from '../templates/purchase-order-formal';
import { VoucherCompact } from '../templates/voucher-compact';
import { TaxReceiptThermal58, TaxReceiptThermal80 } from '../templates/thermal-receipt';

/**
 * سجلّ القوالب — id ← مكوّن + بيانات وصفية. إضافة قالب جديد = إدخال واحد هنا،
 * دون لمس أي مستهلك (الفاتورة/الإعدادات تقرأ من السجلّ).
 */
export const TEMPLATES: Record<string, TemplateDescriptor> = {
  'tax-invoice-classic': {
    id: 'tax-invoice-classic',
    nameKey: 'classic',
    component: TaxInvoiceClassic,
    defaultTheme: 'blue',
    supportedPaper: ['a4', 'letter', 'legal', 'a4_landscape', 'a5_landscape'],
    minContentWidthMm: 182,
  },
  'tax-invoice-classic-v2': {
    id: 'tax-invoice-classic-v2',
    nameKey: 'classic_v2',
    component: TaxInvoiceClassicV2,
    defaultTheme: 'blue',
    supportedPaper: ['a4', 'letter', 'legal', 'a4_landscape', 'a5_landscape', 'a5', 'a6_landscape'],
    minContentWidthMm: 128,
  },
  'tax-invoice-modern': {
    id: 'tax-invoice-modern',
    nameKey: 'modern',
    component: TaxInvoiceModern,
    defaultTheme: 'blue',
    supportedPaper: ['a4', 'letter', 'legal', 'a4_landscape', 'a5_landscape'],
    minContentWidthMm: 182,
  },
  'tax-invoice-modern-v2': {
    id: 'tax-invoice-modern-v2',
    nameKey: 'modern_v2',
    component: TaxInvoiceModernV2,
    defaultTheme: 'blue',
    supportedPaper: ['a4', 'letter', 'legal', 'a4_landscape', 'a5_landscape'],
    minContentWidthMm: 182,
  },
  'tax-invoice-erp': {
    id: 'tax-invoice-erp',
    nameKey: 'erp',
    component: TaxInvoiceErp,
    defaultTheme: 'gray',
    supportedPaper: ['a4', 'letter', 'legal', 'a4_landscape', 'a5_landscape'],
    minContentWidthMm: 182,
  },
  'tax-invoice-erp-v2': {
    id: 'tax-invoice-erp-v2',
    nameKey: 'erp_v2',
    component: TaxInvoiceErpV2,
    defaultTheme: 'gray',
    supportedPaper: ['a4', 'letter', 'legal', 'a4_landscape', 'a5_landscape', 'a6_landscape'],
    minContentWidthMm: 132,
  },
  'tax-invoice-minimal': {
    id: 'tax-invoice-minimal',
    nameKey: 'minimal',
    component: TaxInvoiceMinimal,
    defaultTheme: 'black',
    supportedPaper: ['a4', 'letter', 'legal', 'a4_landscape', 'a5_landscape', 'a6_landscape'],
    minContentWidthMm: 132,
  },
  'tax-invoice-minimal-v2': {
    id: 'tax-invoice-minimal-v2',
    nameKey: 'minimal_v2',
    component: TaxInvoiceMinimalV2,
    defaultTheme: 'black',
    supportedPaper: ['a4', 'letter', 'legal', 'a4_landscape', 'a5_landscape', 'a6_landscape'],
    minContentWidthMm: 132,
  },
  'tax-invoice-retail': {
    id: 'tax-invoice-retail',
    nameKey: 'retail',
    component: TaxInvoiceRetail,
    defaultTheme: 'blue',
    supportedPaper: ['a4', 'letter', 'a4_landscape', 'a5_landscape'],
    minContentWidthMm: 182,
  },
  'tax-invoice-retail-v2': {
    id: 'tax-invoice-retail-v2',
    nameKey: 'retail_v2',
    component: TaxInvoiceRetailV2,
    defaultTheme: 'blue',
    supportedPaper: ['a4', 'letter', 'a4_landscape', 'a5_landscape'],
    minContentWidthMm: 182,
  },
  'tax-invoice-thermal58': {
    id: 'tax-invoice-thermal58',
    nameKey: 'thermal58',
    component: TaxReceiptThermal58,
    defaultTheme: 'black',
    supportedPaper: ['thermal_58'],
  },
  'tax-invoice-thermal80': {
    id: 'tax-invoice-thermal80',
    nameKey: 'thermal80',
    component: TaxReceiptThermal80,
    defaultTheme: 'black',
    supportedPaper: ['thermal_80'],
  },
  'quotation-proposal': {
    id: 'quotation-proposal',
    nameKey: 'quotation_proposal',
    component: QuotationProposal,
    defaultTheme: 'blue',
    supportedPaper: ['a4', 'a4_landscape', 'letter', 'legal', 'a5_landscape'],
    minContentWidthMm: 182,
    documentTypes: ['quotation'],
  },
  'purchase-order-formal': {
    id: 'purchase-order-formal',
    nameKey: 'purchase_order_formal',
    component: PurchaseOrderFormal,
    defaultTheme: 'gray',
    supportedPaper: ['a4', 'a4_landscape', 'letter', 'legal', 'a5_landscape'],
    minContentWidthMm: 182,
    documentTypes: ['purchase_order'],
  },
  // سند القبض/الصرف المدمج (AWJ-DOC-V2-PR5). غياب Output Profile = A4 كسائر القوالب. المقاسات المعلنة قيست في
  // Chromium (معاينة + طباعة + PDF): A5 أفقي/عمودي وA6 أفقي لأسطر قليلة؛ ما زاد ينساب لصفحات تالية بلا قصّ.
  // A6 عمودي وLetter/Legal غير معلنة (لم يُثبَت تخطيطها).
  'voucher-compact': {
    id: 'voucher-compact',
    nameKey: 'voucher_compact',
    component: VoucherCompact,
    defaultTheme: 'blue',
    supportedPaper: ['a4', 'a4_landscape', 'a5', 'a5_landscape', 'a6_landscape'],
    minContentWidthMm: 128,
    documentTypes: ['receipt_voucher', 'payment_voucher'],
    preferredOutput: { paper: 'a5', orientation: 'landscape' },
  },
};

export const DEFAULT_TEMPLATE_ID = 'tax-invoice-classic';

export function getTemplate(id?: string | null): TemplateDescriptor {
  return TEMPLATES[id ?? DEFAULT_TEMPLATE_ID] ?? TEMPLATES[DEFAULT_TEMPLATE_ID];
}

export function listTemplates(): TemplateDescriptor[] {
  return Object.values(TEMPLATES);
}

/** غياب `documentTypes` يبقي القالب متاحاً لكل الأنواع (قوالب الفاتورة التاريخية). */
export function templateSupportsDocumentType(
  template: TemplateDescriptor,
  type: DocumentTypeId,
): boolean {
  return !template.documentTypes || template.documentTypes.includes(type);
}

export function listTemplatesForDocumentType(type: DocumentTypeId): TemplateDescriptor[] {
  return listTemplates().filter((template) => templateSupportsDocumentType(template, type));
}

export function listTemplatesForDocumentTypes(types: readonly DocumentTypeId[]): TemplateDescriptor[] {
  if (types.length === 0) return listTemplates();
  return listTemplates().filter((template) => types.every((type) => templateSupportsDocumentType(template, type)));
}
