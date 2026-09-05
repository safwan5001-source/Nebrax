export type DocumentReviewTranslationKey =
  | 'field'
  | 'fieldDocumentNumber'
  | 'fieldDocumentDate'
  | 'fieldSupplierName'
  | 'fieldIssuerName'
  | 'fieldRecipientName'
  | 'fieldIssuerTaxNumber'
  | 'fieldRecipientTaxNumber'
  | 'fieldCurrency'
  | 'fieldPriceIncludesTax'
  | 'fieldSubtotalMinor'
  | 'fieldDiscountMinor'
  | 'fieldTaxMinor'
  | 'fieldTotalMinor'
  | 'fieldExternalReference'
  | 'fieldPurchaseOrderNumber'
  | 'lineDescription'
  | 'lineSku'
  | 'lineBarcode'
  | 'lineUnit'
  | 'lineQuantity'
  | 'lineUnitPrice'
  | 'lineDiscount'
  | 'lineTax'
  | 'lineTotal';

const fieldTranslationKeys: Record<string, DocumentReviewTranslationKey> = {
  document_number: 'fieldDocumentNumber',
  invoice_number: 'fieldDocumentNumber',
  document_date: 'fieldDocumentDate',
  invoice_date: 'fieldDocumentDate',
  supplier_name: 'fieldSupplierName',
  supplier: 'fieldSupplierName',
  issuer_name: 'fieldIssuerName',
  recipient_name: 'fieldRecipientName',
  issuer_tax_number: 'fieldIssuerTaxNumber',
  recipient_tax_number: 'fieldRecipientTaxNumber',
  currency: 'fieldCurrency',
  price_includes_tax: 'fieldPriceIncludesTax',
  subtotal_minor: 'fieldSubtotalMinor',
  discount_minor: 'fieldDiscountMinor',
  tax_minor: 'fieldTaxMinor',
  tax_amount_minor: 'fieldTaxMinor',
  total_minor: 'fieldTotalMinor',
  total_amount_minor: 'fieldTotalMinor',
  external_reference: 'fieldExternalReference',
  purchase_order_number: 'fieldPurchaseOrderNumber',
  description: 'lineDescription',
  sku: 'lineSku',
  barcode: 'lineBarcode',
  unit: 'lineUnit',
  quantity: 'lineQuantity',
  unit_price_minor: 'lineUnitPrice',
  discount_minor_line: 'lineDiscount',
  tax_amount_minor_line: 'lineTax',
  total_minor_line: 'lineTotal',
};

export function documentFieldTranslationKey(key: string): DocumentReviewTranslationKey {
  return fieldTranslationKeys[key] ?? 'field';
}

export type ReadinessGapTranslationKey =
  | 'readinessGap_delivery_note_document_number_missing'
  | 'readinessGap_delivery_note_document_date_missing'
  | 'readinessGap_delivery_note_customer_missing'
  | 'readinessGap_delivery_note_quantity_missing';

const readinessGapTranslationKeys: Record<string, ReadinessGapTranslationKey> = {
  delivery_note_document_number_missing: 'readinessGap_delivery_note_document_number_missing',
  delivery_note_document_date_missing: 'readinessGap_delivery_note_document_date_missing',
  delivery_note_customer_missing: 'readinessGap_delivery_note_customer_missing',
  delivery_note_quantity_missing: 'readinessGap_delivery_note_quantity_missing',
};

/** يعيد null لكودٍ غير معروف — لا نص احتياطي مضلِّل لفجوة لم تُعرَّف رسائلها بعد. */
export function readinessGapTranslationKey(code: string): ReadinessGapTranslationKey | null {
  return readinessGapTranslationKeys[code] ?? null;
}

export function lineFieldTranslationKey(key: string): DocumentReviewTranslationKey {
  if (key === 'discount_minor') return 'lineDiscount';
  if (key === 'tax_amount_minor') return 'lineTax';
  if (key === 'total_minor') return 'lineTotal';
  if (key === 'unit_price_minor') return 'lineUnitPrice';
  return fieldTranslationKeys[key] ?? 'field';
}

export function isMinorAmountField(key: string): boolean {
  return key.endsWith('_minor') || key.includes('unit_price') || key.includes('tax_amount') || key.includes('total_minor');
}

export function confidencePercentage(score: number | null | undefined): number | null {
  if (typeof score !== 'number' || !Number.isInteger(score) || score < 0 || score > 10000) {
    return null;
  }

  return Math.round(score / 100);
}

export function confidenceTone(score: number | null | undefined): 'positive' | 'warning' | 'negative' | 'muted' {
  const percent = confidencePercentage(score);
  if (percent === null) return 'muted';
  if (percent >= 85) return 'positive';
  if (percent >= 60) return 'warning';
  return 'negative';
}

type MatchStatus = { status: string };
type IssueStatus = { severity: string; status: string };

/**
 * هذه إشارة واجهة فقط لشرح سبب تعطيل الإكمال؛ يظل التحقق النهائي ذريًا في الخادم.
 */
export function reviewHasVisibleBlocker(matches: MatchStatus[], issues: IssueStatus[]): boolean {
  const hasUnresolvedBlockingIssue = issues.some(
    (issue) => issue.severity === 'blocking' && ['open', 'reopened'].includes(issue.status),
  );
  const hasPendingMatch = matches.some((match) => !['confirmed', 'rejected'].includes(match.status));

  return hasUnresolvedBlockingIssue || hasPendingMatch;
}

export function matchStatusTone(status: string): 'positive' | 'warning' | 'negative' | 'muted' {
  if (status === 'confirmed') return 'positive';
  if (status === 'rejected') return 'muted';
  return 'warning';
}

export function issueSeverityTone(severity: string): 'negative' | 'warning' {
  return severity === 'blocking' ? 'negative' : 'warning';
}
