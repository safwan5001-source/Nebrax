export type DocumentReviewTranslationKey =
  | 'field'
  | 'fieldDocumentNumber'
  | 'fieldDocumentDate'
  | 'fieldSupplierName'
  | 'fieldIssuerName'
  | 'fieldCurrency'
  | 'fieldPriceIncludesTax'
  | 'fieldSubtotalMinor'
  | 'fieldTaxMinor'
  | 'fieldTotalMinor';

const fieldTranslationKeys: Record<string, DocumentReviewTranslationKey> = {
  document_number: 'fieldDocumentNumber',
  invoice_number: 'fieldDocumentNumber',
  document_date: 'fieldDocumentDate',
  invoice_date: 'fieldDocumentDate',
  supplier_name: 'fieldSupplierName',
  supplier: 'fieldSupplierName',
  issuer_name: 'fieldIssuerName',
  currency: 'fieldCurrency',
  price_includes_tax: 'fieldPriceIncludesTax',
  subtotal_minor: 'fieldSubtotalMinor',
  tax_minor: 'fieldTaxMinor',
  tax_amount_minor: 'fieldTaxMinor',
  total_minor: 'fieldTotalMinor',
  total_amount_minor: 'fieldTotalMinor',
};

export function documentFieldTranslationKey(key: string): DocumentReviewTranslationKey {
  return fieldTranslationKeys[key] ?? 'field';
}

export function confidencePercentage(score: number | null | undefined): number | null {
  if (typeof score !== 'number' || !Number.isInteger(score) || score < 0 || score > 10000) {
    return null;
  }

  return Math.round(score / 100);
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
