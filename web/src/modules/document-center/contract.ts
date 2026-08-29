/** عقد مراجعة مركز المستندات — مرآة `DocumentReviewResource` و`DocumentBatchReviewResource`. */

export type ReviewCapabilities = {
  view: boolean;
  review: boolean;
  manage: boolean;
  build_draft: boolean;
};

export type ReviewFile = {
  id: string;
  original_name: string;
  mime_type: string | null;
  page_count: number | null;
  download_available: boolean;
  scan_status?: string;
};

export type ReviewField = {
  key: string;
  original: string | number | boolean | null;
  current: string | number | boolean | null;
  confidence_basis_points?: number;
  page?: number;
};

export type ReviewLineField = {
  key: string;
  original: string | number | boolean | null;
  current: string | number | boolean | null;
  editable: boolean;
};

export type ReviewLine = {
  index: number;
  description: string | null;
  fields: ReviewLineField[];
  confidence_basis_points?: number;
  page?: number;
  product_match_id: string | null;
  unit_match_id: string | null;
};

export type MatchCandidate = {
  id: string;
  label: string;
  candidate_type: string;
  name?: string;
  sku?: string;
  unit?: string;
  score_basis_points: number;
  strategy: string;
  is_active: boolean;
};

export type DocumentMatch = {
  id: string;
  subject_key: string;
  status: string;
  score_basis_points: number;
  strategy: string;
  candidates: MatchCandidate[];
};

export type ReviewIssue = {
  id: string;
  code: string;
  severity: string;
  status: string;
  safe_message: string;
  subject_key: string | null;
};

export type ReviewHistory = {
  id: string;
  action: string;
  reason: string | null;
  before: Record<string, string | number | boolean> | null;
  after: Record<string, string | number | boolean> | null;
  actor: { id: string; name: string } | null;
  occurred_at: string | null;
};

export type ProcessingSummary = {
  scan_status: string;
  download_available: boolean;
  workflow_status: string;
  processing_key: string;
  processing_message: string;
  retry_available: boolean;
  diagnostics_url: string;
};

export type LinkedTransaction = {
  link_id: string;
  transaction_type: 'purchase' | 'expense';
  transaction_id: string;
  transaction_number: string;
  status: string;
  url: string;
};

export type DocumentReviewPayload = {
  batch: {
    id: string;
    status: string;
    version: number;
    reviewer: { id: string; name: string } | null;
    document_type: string;
    source_type?: string;
    source?: {
      channel: string;
      identity_name: string | null;
      identity_reference: string | null;
      external_reference: string | null;
      received_at: string | null;
    } | null;
  };
  fields: ReviewField[];
  lines: ReviewLine[];
  warnings: string[];
  files: ReviewFile[];
  matches: DocumentMatch[];
  issues: ReviewIssue[];
  history: ReviewHistory[];
  processing_summary: ProcessingSummary | null;
  linked_transaction: LinkedTransaction | null;
  linked_purchase: LinkedTransaction | null;
  capabilities: ReviewCapabilities;
};

export type DocumentBatchListItem = {
  id: string;
  document_type: string;
  source_type: string;
  status: string;
  version: number;
  created_at: string;
  files_count: number;
  blocking_issues_count: number;
  warning_issues_count: number;
  reviewer: { id: string; name: string } | null;
};

export type DocumentBatchFilters = {
  search: string;
  status: string;
  documentType: string;
  sourceType: string;
  channel: string;
  reviewerId: string;
  from: string;
  to: string;
  blockingOnly: boolean;
};

export const EDITABLE_LINE_FIELDS = new Set([
  'quantity',
  'unit_price_minor',
  'discount_minor',
  'tax_amount_minor',
  'total_minor',
]);

export const EDITABLE_HEADER_FIELDS = new Set([
  'document_number',
  'document_date',
  'currency',
]);

export type MobileReviewSection = 'preview' | 'details' | 'lines' | 'matches' | 'issues' | 'history';

export function buildBatchListQuery(filters: DocumentBatchFilters, page: number, perPage = 20): string {
  const params = new URLSearchParams({
    page: String(page),
    per_page: String(perPage),
    sort: 'created_at',
    direction: 'desc',
  });
  if (filters.search.trim()) params.set('search', filters.search.trim());
  if (filters.status) params.set('status', filters.status);
  if (filters.documentType) params.set('document_type', filters.documentType);
  if (filters.sourceType) params.set('source_type', filters.sourceType);
  if (filters.channel) params.set('channel', filters.channel);
  if (filters.reviewerId) params.set('reviewer_id', filters.reviewerId);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.blockingOnly) params.set('has_blocking', '1');
  return `/document-batches?${params.toString()}`;
}

export function filtersFromSearchParams(params: URLSearchParams): DocumentBatchFilters {
  return {
    search: params.get('search') ?? '',
    status: params.get('status') ?? '',
    documentType: params.get('document_type') ?? '',
    sourceType: params.get('source_type') ?? '',
    channel: params.get('channel') ?? '',
    reviewerId: params.get('reviewer_id') ?? '',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    blockingOnly: params.get('has_blocking') === '1',
  };
}

export function filtersToSearchParams(filters: DocumentBatchFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.search.trim()) params.set('search', filters.search.trim());
  if (filters.status) params.set('status', filters.status);
  if (filters.documentType) params.set('document_type', filters.documentType);
  if (filters.sourceType) params.set('source_type', filters.sourceType);
  if (filters.channel) params.set('channel', filters.channel);
  if (filters.reviewerId) params.set('reviewer_id', filters.reviewerId);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.blockingOnly) params.set('has_blocking', '1');
  return params;
}
