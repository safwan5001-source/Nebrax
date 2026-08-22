import type {
  DocumentTypeId,
  DocSectionKey,
  DocSectionLayoutItem,
  DocSectionProperties,
  DocItemsColumnId,
  PaperSizeId,
} from '../types';

/**
 * سجل عقد المستندات.
 *
 * لا يرسم هذا الملف أي واجهة ولا يحل بيانات فعلية؛ بل يعرّف بدقة ما يسمح به كل
 * نوع مستند من كتل وورق ومتغيرات. لذلك يصبح محرر القوالب وطبقة الإخراج قادرين
 * على قول الحقيقة قبل الحفظ، بدلاً من قبول إعداد لا يمكن عرضه لاحقاً.
 */
export type DocumentFamily = 'line_items' | 'voucher' | 'statement';

export type DocumentVariableCategory =
  | 'company'
  | 'branch'
  | 'counterparty'
  | 'document'
  | 'line'
  | 'totals'
  | 'payment'
  | 'compliance'
  | 'content';

export type DocumentVariableValueKind = 'text' | 'date' | 'money' | 'number' | 'image' | 'qr' | 'table';

export type DocumentVariableId =
  | 'company.name'
  | 'company.vat_number'
  | 'company.cr_number'
  | 'company.logo'
  | 'branch.name'
  | 'counterparty.name'
  | 'counterparty.vat_number'
  | 'counterparty.cr_number'
  | 'counterparty.address'
  | 'counterparty.city'
  | 'document.type_label'
  | 'document.number'
  | 'document.date'
  | 'document.due_date'
  | 'document.payment_type'
  | 'document.notes'
  | 'line.items'
  | 'totals.subtotal'
  | 'totals.tax'
  | 'totals.discount'
  | 'totals.total'
  | 'payment.direction'
  | 'payment.method'
  | 'payment.amount'
  | 'payment.reference'
  | 'payment.allocations'
  | 'compliance.zatca_qr'
  | 'content.terms'
  | 'content.bank'
  | 'content.stamp'
  | 'content.signature'
  | 'content.footer';

export interface DocumentTypeDefinition {
  id: DocumentTypeId;
  /** عائلة البنية؛ تحدد نوع البيانات الذي ينتجه المحول وليس نصاً معروضاً. */
  family: DocumentFamily;
  /** مفتاح ترجمة مقصود للواجهة التي ستبنى في المرحلة التالية. */
  labelKey: string;
  supportedPaper: readonly PaperSizeId[];
  allowedBlocks: readonly DocSectionKey[];
  requiredBlocks: readonly DocSectionKey[];
  defaultLayout: readonly DocSectionLayoutItem[];
}

export interface DocumentVariableDefinition {
  id: DocumentVariableId;
  category: DocumentVariableCategory;
  labelKey: string;
  descriptionKey: string;
  valueKind: DocumentVariableValueKind;
  /** `all` يعني أن المتغير جزء من النموذج الموحد لكل المستندات. */
  documentTypes: readonly DocumentTypeId[] | 'all';
  /** يوضح للمحرر أن غياب القيمة لا يجعل القالب غير صالح. */
  optional: boolean;
}

export interface DocumentLayoutValidationResult {
  valid: boolean;
  errors: readonly string[];
}

/** مفاتيح الخصائص التي يستطيع كل عارض كتلة استهلاكها فعلياً. */
export const DOCUMENT_BLOCK_PROPERTY_CONTRACT: Readonly<Record<DocSectionKey, readonly (keyof DocSectionProperties)[]>> = {
  header: [],
  barcode: [],
  parties: [],
  items: ['columns', 'alignment', 'font_size'],
  summary: [],
  voucher: [],
  amountWords: [],
  notes: ['alignment', 'font_size'],
  terms: ['alignment', 'font_size', 'static_content'],
  bank: ['alignment', 'font_size', 'static_content'],
  stamp: ['alignment', 'image_size', 'image_opacity'],
  signature: ['alignment', 'image_size', 'image_opacity'],
  footer: ['alignment', 'font_size', 'static_content'],
};

/** جميع الأعمدة التي يستطيع محرر القالب تفعيلها. */
export const DOCUMENT_ITEMS_COLUMN_IDS = [
  'number', 'product_code', 'barcode', 'product', 'description', 'unit_price',
  'quantity', 'price_before_tax', 'tax', 'total',
] as const satisfies readonly DocItemsColumnId[];
/** ترتيب افتراضي كامل لبنود المستند، ويمكن لمالك القالب تخصيصه لاحقاً. */
export const DEFAULT_DOCUMENT_ITEMS_COLUMNS = [
  'number', 'product_code', 'barcode', 'product', 'description', 'unit_price',
  'quantity', 'price_before_tax', 'tax', 'total',
] as const satisfies readonly DocItemsColumnId[];
const REQUIRED_ITEMS_COLUMNS = ['description', 'total'] as const satisfies readonly DocItemsColumnId[];
const ALIGNMENTS = ['start', 'center', 'end'] as const;
const FONT_SIZES = ['sm', 'md', 'lg'] as const;
const IMAGE_SIZES = ['sm', 'md', 'lg'] as const;
const IMAGE_OPACITIES = ['solid', 'soft', 'faint'] as const;

const PAGE_PAPERS = ['a4', 'a4_landscape', 'letter', 'legal'] as const satisfies readonly PaperSizeId[];
const THERMAL_PAPERS = ['thermal_58', 'thermal_80'] as const satisfies readonly PaperSizeId[];

const LINE_ITEM_BLOCKS = [
  'header', 'barcode', 'parties', 'items', 'summary', 'amountWords',
  'notes', 'terms', 'bank', 'stamp', 'signature', 'footer',
] as const satisfies readonly DocSectionKey[];

const VOUCHER_BLOCKS = [
  'header', 'parties', 'voucher', 'amountWords', 'notes', 'bank',
  'stamp', 'signature', 'footer',
] as const satisfies readonly DocSectionKey[];

const STATEMENT_BLOCKS = [
  'header', 'parties', 'items', 'summary', 'notes', 'footer',
] as const satisfies readonly DocSectionKey[];

function layoutWithVisibility(
  keys: readonly DocSectionKey[],
  visible: readonly DocSectionKey[],
): readonly DocSectionLayoutItem[] {
  return keys.map((key) => ({ key, visible: visible.includes(key) }));
}

// هذه القيم تكرر المخرجات الحالية حرفياً؛ لا تغيّر مرحلة العقود شكل مستند قائم.
const LINE_ITEM_DEFAULT = layoutWithVisibility(
  LINE_ITEM_BLOCKS,
  ['header', 'parties', 'items', 'summary', 'footer'],
);
const VOUCHER_DEFAULT = layoutWithVisibility(
  VOUCHER_BLOCKS,
  ['header', 'parties', 'voucher', 'amountWords', 'notes', 'signature', 'stamp', 'footer'],
);
const STATEMENT_DEFAULT = layoutWithVisibility(
  STATEMENT_BLOCKS,
  ['header', 'parties', 'items', 'summary', 'footer'],
);

const TAX_INVOICE_TYPES = ['tax_invoice', 'simplified_tax_invoice'] as const satisfies readonly DocumentTypeId[];
const STANDARD_LINE_ITEM_TYPES = [
  'quotation', 'proforma_invoice', 'sales_order', 'purchase_order', 'purchase_invoice', 'credit_note', 'debit_note',
] as const satisfies readonly DocumentTypeId[];
const DELIVERY_TYPES = ['delivery_note', 'packing_list'] as const satisfies readonly DocumentTypeId[];
const VOUCHER_TYPES = ['receipt_voucher', 'payment_voucher'] as const satisfies readonly DocumentTypeId[];

function lineItemDefinition(
  id: DocumentTypeId,
  labelKey: string,
  options: { papers?: readonly PaperSizeId[]; requiredBlocks?: readonly DocSectionKey[] } = {},
): DocumentTypeDefinition {
  return {
    id,
    family: 'line_items',
    labelKey,
    supportedPaper: options.papers ?? PAGE_PAPERS,
    allowedBlocks: LINE_ITEM_BLOCKS,
    requiredBlocks: options.requiredBlocks ?? ['header', 'parties', 'items', 'summary', 'footer'],
    defaultLayout: LINE_ITEM_DEFAULT,
  };
}

function voucherDefinition(id: 'receipt_voucher' | 'payment_voucher', labelKey: string): DocumentTypeDefinition {
  return {
    id,
    family: 'voucher',
    labelKey,
    supportedPaper: [...PAGE_PAPERS, ...THERMAL_PAPERS],
    allowedBlocks: VOUCHER_BLOCKS,
    requiredBlocks: ['header', 'parties', 'voucher', 'footer'],
    defaultLayout: VOUCHER_DEFAULT,
  };
}

/** مصدر الحقيقة لقواعد التوافق بين نوع المستند وكتل القالب. */
export const DOCUMENT_TYPE_REGISTRY: Readonly<Record<DocumentTypeId, DocumentTypeDefinition>> = {
  tax_invoice: lineItemDefinition('tax_invoice', 'taxInvoice', { papers: [...PAGE_PAPERS, ...THERMAL_PAPERS] }),
  simplified_tax_invoice: lineItemDefinition('simplified_tax_invoice', 'simplifiedTaxInvoice', { papers: [...PAGE_PAPERS, ...THERMAL_PAPERS] }),
  quotation: lineItemDefinition('quotation', 'quotation'),
  proforma_invoice: lineItemDefinition('proforma_invoice', 'proformaInvoice'),
  sales_order: lineItemDefinition('sales_order', 'salesOrder'),
  purchase_order: lineItemDefinition('purchase_order', 'purchaseOrder'),
  purchase_invoice: lineItemDefinition('purchase_invoice', 'purchaseInvoice', { papers: [...PAGE_PAPERS, ...THERMAL_PAPERS] }),
  delivery_note: lineItemDefinition('delivery_note', 'deliveryNote', { requiredBlocks: ['header', 'parties', 'items', 'footer'] }),
  packing_list: lineItemDefinition('packing_list', 'packingList', { requiredBlocks: ['header', 'parties', 'items', 'footer'] }),
  receipt_voucher: voucherDefinition('receipt_voucher', 'receiptVoucher'),
  payment_voucher: voucherDefinition('payment_voucher', 'paymentVoucher'),
  credit_note: lineItemDefinition('credit_note', 'creditNote', { papers: [...PAGE_PAPERS, ...THERMAL_PAPERS] }),
  debit_note: lineItemDefinition('debit_note', 'debitNote', { papers: [...PAGE_PAPERS, ...THERMAL_PAPERS] }),
  statement_of_account: {
    id: 'statement_of_account',
    family: 'statement',
    labelKey: 'statementOfAccount',
    supportedPaper: PAGE_PAPERS,
    allowedBlocks: STATEMENT_BLOCKS,
    requiredBlocks: ['header', 'parties', 'items', 'footer'],
    defaultLayout: STATEMENT_DEFAULT,
  },
};

/**
 * متغيرات مسموحة ومصنفة؛ تستعمل الواجهة مفاتيح الترجمة لاحقاً بدلاً من إدخال
 * متغير نصي غير متحقق منه. النوع الفعلي يصل دائماً من `DocumentModel`.
 */
export const DOCUMENT_VARIABLE_CATALOG: readonly DocumentVariableDefinition[] = [
  { id: 'company.name', category: 'company', labelKey: 'companyName', descriptionKey: 'companyNameDescription', valueKind: 'text', documentTypes: 'all', optional: false },
  { id: 'company.vat_number', category: 'company', labelKey: 'companyVatNumber', descriptionKey: 'companyVatNumberDescription', valueKind: 'text', documentTypes: 'all', optional: true },
  { id: 'company.cr_number', category: 'company', labelKey: 'companyCrNumber', descriptionKey: 'companyCrNumberDescription', valueKind: 'text', documentTypes: 'all', optional: true },
  { id: 'company.logo', category: 'company', labelKey: 'companyLogo', descriptionKey: 'companyLogoDescription', valueKind: 'image', documentTypes: 'all', optional: true },
  { id: 'branch.name', category: 'branch', labelKey: 'branchName', descriptionKey: 'branchNameDescription', valueKind: 'text', documentTypes: 'all', optional: true },
  { id: 'counterparty.name', category: 'counterparty', labelKey: 'counterpartyName', descriptionKey: 'counterpartyNameDescription', valueKind: 'text', documentTypes: 'all', optional: false },
  { id: 'counterparty.vat_number', category: 'counterparty', labelKey: 'counterpartyVatNumber', descriptionKey: 'counterpartyVatNumberDescription', valueKind: 'text', documentTypes: 'all', optional: true },
  { id: 'counterparty.cr_number', category: 'counterparty', labelKey: 'counterpartyCrNumber', descriptionKey: 'counterpartyCrNumberDescription', valueKind: 'text', documentTypes: 'all', optional: true },
  { id: 'counterparty.address', category: 'counterparty', labelKey: 'counterpartyAddress', descriptionKey: 'counterpartyAddressDescription', valueKind: 'text', documentTypes: 'all', optional: true },
  { id: 'counterparty.city', category: 'counterparty', labelKey: 'counterpartyCity', descriptionKey: 'counterpartyCityDescription', valueKind: 'text', documentTypes: 'all', optional: true },
  { id: 'document.type_label', category: 'document', labelKey: 'documentTypeLabel', descriptionKey: 'documentTypeLabelDescription', valueKind: 'text', documentTypes: 'all', optional: false },
  { id: 'document.number', category: 'document', labelKey: 'documentNumber', descriptionKey: 'documentNumberDescription', valueKind: 'text', documentTypes: 'all', optional: false },
  { id: 'document.date', category: 'document', labelKey: 'documentDate', descriptionKey: 'documentDateDescription', valueKind: 'date', documentTypes: 'all', optional: false },
  { id: 'document.due_date', category: 'document', labelKey: 'dueDate', descriptionKey: 'dueDateDescription', valueKind: 'date', documentTypes: [...TAX_INVOICE_TYPES, ...STANDARD_LINE_ITEM_TYPES], optional: true },
  { id: 'document.payment_type', category: 'document', labelKey: 'paymentType', descriptionKey: 'paymentTypeDescription', valueKind: 'text', documentTypes: TAX_INVOICE_TYPES, optional: true },
  { id: 'document.notes', category: 'document', labelKey: 'documentNotes', descriptionKey: 'documentNotesDescription', valueKind: 'text', documentTypes: 'all', optional: true },
  { id: 'line.items', category: 'line', labelKey: 'lineItems', descriptionKey: 'lineItemsDescription', valueKind: 'table', documentTypes: [...TAX_INVOICE_TYPES, ...STANDARD_LINE_ITEM_TYPES, ...DELIVERY_TYPES, 'statement_of_account'], optional: false },
  { id: 'totals.subtotal', category: 'totals', labelKey: 'subtotal', descriptionKey: 'subtotalDescription', valueKind: 'money', documentTypes: [...TAX_INVOICE_TYPES, ...STANDARD_LINE_ITEM_TYPES, 'statement_of_account'], optional: false },
  { id: 'totals.tax', category: 'totals', labelKey: 'tax', descriptionKey: 'taxDescription', valueKind: 'money', documentTypes: [...TAX_INVOICE_TYPES, ...STANDARD_LINE_ITEM_TYPES], optional: true },
  { id: 'totals.discount', category: 'totals', labelKey: 'discount', descriptionKey: 'discountDescription', valueKind: 'money', documentTypes: [...TAX_INVOICE_TYPES, ...STANDARD_LINE_ITEM_TYPES], optional: true },
  { id: 'totals.total', category: 'totals', labelKey: 'total', descriptionKey: 'totalDescription', valueKind: 'money', documentTypes: 'all', optional: false },
  { id: 'payment.direction', category: 'payment', labelKey: 'paymentDirection', descriptionKey: 'paymentDirectionDescription', valueKind: 'text', documentTypes: VOUCHER_TYPES, optional: false },
  { id: 'payment.method', category: 'payment', labelKey: 'paymentMethod', descriptionKey: 'paymentMethodDescription', valueKind: 'text', documentTypes: VOUCHER_TYPES, optional: false },
  { id: 'payment.amount', category: 'payment', labelKey: 'paymentAmount', descriptionKey: 'paymentAmountDescription', valueKind: 'money', documentTypes: VOUCHER_TYPES, optional: false },
  { id: 'payment.reference', category: 'payment', labelKey: 'paymentReference', descriptionKey: 'paymentReferenceDescription', valueKind: 'text', documentTypes: VOUCHER_TYPES, optional: true },
  { id: 'payment.allocations', category: 'payment', labelKey: 'paymentAllocations', descriptionKey: 'paymentAllocationsDescription', valueKind: 'table', documentTypes: VOUCHER_TYPES, optional: true },
  { id: 'compliance.zatca_qr', category: 'compliance', labelKey: 'zatcaQr', descriptionKey: 'zatcaQrDescription', valueKind: 'qr', documentTypes: TAX_INVOICE_TYPES, optional: true },
  { id: 'content.terms', category: 'content', labelKey: 'terms', descriptionKey: 'termsDescription', valueKind: 'text', documentTypes: 'all', optional: true },
  { id: 'content.bank', category: 'content', labelKey: 'bank', descriptionKey: 'bankDescription', valueKind: 'text', documentTypes: 'all', optional: true },
  { id: 'content.stamp', category: 'content', labelKey: 'stamp', descriptionKey: 'stampDescription', valueKind: 'image', documentTypes: 'all', optional: true },
  { id: 'content.signature', category: 'content', labelKey: 'signature', descriptionKey: 'signatureDescription', valueKind: 'image', documentTypes: 'all', optional: true },
  { id: 'content.footer', category: 'content', labelKey: 'footer', descriptionKey: 'footerDescription', valueKind: 'text', documentTypes: 'all', optional: true },
] as const;

export function getDocumentTypeDefinition(type: DocumentTypeId): DocumentTypeDefinition {
  return DOCUMENT_TYPE_REGISTRY[type];
}

/**
 * مراجعة الطباعة تنتمي إلى عائلة عرض واحدة. يسمح بمشاركة الفاتورة وعرض السعر
 * مثلاً، لكنه يمنع خلطها بالسند أو بكشف الحساب قبل الوصول إلى حارس API.
 */
export function validateDocumentTypeFamily(documentTypes: readonly DocumentTypeId[]): DocumentLayoutValidationResult {
  const families = [...new Set(documentTypes.map((type) => getDocumentTypeDefinition(type).family))];
  return families.length <= 1
    ? { valid: true, errors: [] }
    : { valid: false, errors: ['mixed_document_families'] };
}

export function getDefaultDocumentLayout(type: DocumentTypeId): DocSectionLayoutItem[] {
  return getDocumentTypeDefinition(type).defaultLayout.map((item) => ({ ...item }));
}

export function listDocumentVariables(type: DocumentTypeId): readonly DocumentVariableDefinition[] {
  return DOCUMENT_VARIABLE_CATALOG.filter((variable) => variable.documentTypes === 'all' || variable.documentTypes.includes(type));
}

export function isDocumentBlockAllowed(type: DocumentTypeId, block: DocSectionKey): boolean {
  return getDocumentTypeDefinition(type).allowedBlocks.includes(block);
}

/** يتحقق من خصائص الكتل قبل الحفظ من دون تغييرها أو رسمها. */
export function validateDocumentBlockProperties(
  type: DocumentTypeId,
  layout: readonly DocSectionLayoutItem[],
): DocumentLayoutValidationResult {
  const errors: string[] = [];
  const definition = getDocumentTypeDefinition(type);

  for (const item of layout) {
    if (!item.properties) continue;
    if (!definition.allowedBlocks.includes(item.key)) {
      errors.push(`unsupported_block:${item.key}`);
      continue;
    }

    const allowed = DOCUMENT_BLOCK_PROPERTY_CONTRACT[item.key];
    for (const key of Object.keys(item.properties) as (keyof DocSectionProperties)[]) {
      if (!allowed.includes(key)) errors.push(`unsupported_block_property:${item.key}:${key}`);
    }

    const { alignment, font_size: fontSize, image_opacity: imageOpacity, static_content: staticContent, columns } = item.properties;
    if (alignment !== undefined && !ALIGNMENTS.includes(alignment)) errors.push(`invalid_block_alignment:${item.key}`);
    if (fontSize !== undefined && !FONT_SIZES.includes(fontSize)) errors.push(`invalid_block_font_size:${item.key}`);
    if (item.properties.image_size !== undefined && !IMAGE_SIZES.includes(item.properties.image_size)) {
      errors.push(`invalid_block_image_size:${item.key}`);
    }
    if (imageOpacity !== undefined && !IMAGE_OPACITIES.includes(imageOpacity)) {
      errors.push(`invalid_block_image_opacity:${item.key}`);
    }
    if (staticContent !== undefined && (typeof staticContent !== 'string' || staticContent.length > 2000)) {
      errors.push(`invalid_static_content:${item.key}`);
    }

    if (columns !== undefined) {
      if (!Array.isArray(columns) || columns.length === 0) {
        errors.push('invalid_items_columns');
        continue;
      }
      const columnIds = columns.map((column) => column.id);
      if (columnIds.some((id) => !DOCUMENT_ITEMS_COLUMN_IDS.includes(id))) errors.push('invalid_items_column');
      if (new Set(columnIds).size !== columnIds.length) errors.push('duplicate_items_column');
      if (REQUIRED_ITEMS_COLUMNS.some((id) => !columnIds.includes(id))) errors.push('required_items_column_missing');
      for (const column of columns) {
        if (column.label !== undefined && (typeof column.label !== 'string' || column.label.length > 80)) errors.push('invalid_items_column_label');
        if (column.alignment !== undefined && !ALIGNMENTS.includes(column.alignment)) errors.push('invalid_items_column_alignment');
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * يتحقق من بنية التخطيط قبل الحفظ أو النشر. لا يغيرها ولا يرسمها؛ لذلك يبقى
 * قابلاً لإعادة الاستخدام في واجهة المحرر وواجهة API الخادمية مستقبلاً.
 */
export function validateDocumentLayout(
  type: DocumentTypeId,
  layout: readonly DocSectionLayoutItem[],
): DocumentLayoutValidationResult {
  const definition = getDocumentTypeDefinition(type);
  const errors: string[] = [];
  const occurrences = new Map<DocSectionKey, number>();

  for (const item of layout) {
    occurrences.set(item.key, (occurrences.get(item.key) ?? 0) + 1);
    if (!definition.allowedBlocks.includes(item.key)) {
      errors.push(`unsupported_block:${item.key}`);
    }
  }

  for (const [key, count] of occurrences) {
    if (count > 1) errors.push(`duplicate_block:${key}`);
  }

  for (const required of definition.requiredBlocks) {
    const item = layout.find((candidate) => candidate.key === required);
    if (!item || !item.visible) errors.push(`required_block_hidden:${required}`);
  }

  const propertyValidation = validateDocumentBlockProperties(type, layout);
  return {
    valid: errors.length === 0 && propertyValidation.valid,
    errors: [...errors, ...propertyValidation.errors],
  };
}
