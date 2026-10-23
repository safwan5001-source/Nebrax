import type {
  AgingResult, AssistantStatus, CapabilityState, DocumentProjection, IncomeStatementResult, MessageResponse, ToolCall,
} from '../contract';

const money = (minor: number) => ({ minor, decimal: (minor / 100).toFixed(2) });

export function makeStatus(overrides: Partial<AssistantStatus> = {}): AssistantStatus {
  return {
    platform_enabled: true,
    provider_mode: 'mock',
    tenant: { enabled: true, consented_categories: ['assistant_messages', 'financial_summary'] },
    categories: [
      { key: 'assistant_messages', available: true, consented: true },
      { key: 'financial_summary', available: true, consented: true },
      { key: 'document_projected_text', available: false, consented: false },
    ],
    abilities: { use: true, manage_consent: true, view_audit: false, partner_detail: true, document_read: true },
    chat: 'ready',
    financial: 'ready',
    financial_tools: ['finance.income_statement', 'finance.receivables_aging', 'finance.payables_aging'],
    // الافتراضي: مفتاح منصة المستندات مغلق (الفئة غير متاحة) — كما في الإنتاج اليوم.
    document: 'category_unavailable',
    document_tools: ['documents.projected_read'],
    clock: { timezone: 'Asia/Riyadh', today: '2026-10-16' },
    ...overrides,
  };
}

/** مستأجر فعّل المنصة مفتاح المستندات ووافق على فئة نصّ المستند: القراءة جاهزة. */
export function docReadyStatus(overrides: Partial<AssistantStatus> = {}): AssistantStatus {
  return makeStatus({
    tenant: { enabled: true, consented_categories: ['assistant_messages', 'financial_summary', 'document_projected_text'] },
    categories: [
      { key: 'assistant_messages', available: true, consented: true },
      { key: 'financial_summary', available: true, consented: true },
      { key: 'document_projected_text', available: true, consented: true },
    ],
    document: 'ready',
    ...overrides,
  });
}

export const DOC_ID = '3f2b8c1e-5a4d-4e7b-9c1a-0d2e4f6a8b10';

export function documentProjection(overrides: Partial<DocumentProjection> = {}): DocumentProjection {
  return {
    report: 'document_projection',
    schema_version: 1,
    document: { ref: DOC_ID, document_type: 'purchase_invoice', status: 'ready_for_draft', language: 'ar', extracted_at: '2026-10-10T08:00:00+00:00', page_count: 2 },
    basis: { values: 'human_reviewed_values', redaction: 'document_center_overlays_applied', content_trust: 'untrusted_document_data', generated_by_model: false, redacted_values: 1 },
    fields: [
      { key: 'document_number', type: 'text', value: 'PI-2026-0042', redacted: false },
      { key: 'document_date', type: 'text', value: '2026-10-10', redacted: false },
      { key: 'issuer_name', type: 'text', value: null, redacted: true },
      { key: 'recipient_name', type: 'text', value: 'شركة المنارة', redacted: false },
      { key: 'currency', type: 'text', value: 'SAR', redacted: false },
      { key: 'price_includes_tax', type: 'flag', value: false, redacted: false },
      { key: 'total_amount_minor', type: 'money', value: 115000, decimal: '1150.00', redacted: false },
    ],
    lines: [{ index: 0, fields: [
      { key: 'description', type: 'text', value: 'صمام صناعي', redacted: false },
      { key: 'quantity', type: 'text', value: '2', redacted: false },
      { key: 'total_minor', type: 'money', value: 115000, decimal: '1150.00', redacted: false },
    ] }],
    warnings: ['تنبيه اختباري'],
    truncated: { fields: false, lines: false, warnings: false },
    timezone: 'Asia/Riyadh',
    generated_at: '2026-10-16T09:00:00+03:00',
    sources: [{ type: 'document', service: 'DocumentCenter', ui_path: `/documents/${DOC_ID}` }],
    ...overrides,
  };
}

export function blockedStatus(state: CapabilityState, overrides: Partial<AssistantStatus> = {}): AssistantStatus {
  return makeStatus({ chat: state, financial: state, ...overrides });
}

const envelope = {
  schema_version: 1,
  currency: 'SAR',
  minor_unit: 2,
  currency_assumption: 'tenant_currency_must_be_sar',
  scope: { branch: { mode: 'assigned' as const, ids: [] }, warehouse: { mode: 'not_applicable' as const, ids: [], reason: 'financial_reports_are_not_warehouse_scoped', user_restriction_applied: false } },
  timezone: 'Asia/Riyadh',
  generated_at: '2026-10-16T09:00:00+03:00',
  sources: [{ type: 'report', service: 'ReportService::incomeStatement', api_path: '/api/reports/income-statement', ui_path: '/reports/general/income-statement' }],
};

export function incomeResult(): IncomeStatementResult {
  return {
    ...envelope,
    report: 'income_statement',
    period: { from: '2026-10-01', to: '2026-10-16', inclusive: true },
    basis: { method: 'accrual', entries: 'posted', date_field: 'entry_date', excludes: 'drafts' },
    totals: { total_revenue: money(1_234_500), total_expense: money(400_000), net_income: money(834_500) },
    revenues: [{ code: '4110', name: 'إيرادات المبيعات', amount: money(1_234_500) }],
    expenses: [{ code: '5110', name: 'تكلفة البضاعة', amount: money(400_000) }],
  };
}

export function agingResult(report: AgingResult['report'] = 'receivables_aging', withWarning = true): AgingResult {
  return {
    ...envelope,
    sources: [{ type: 'report', service: 'ReportService::aging', api_path: '/api/reports/aging/receivable', ui_path: '/reports/customers/aging' }],
    report,
    as_of: '2026-09-30',
    basis: {
      method: 'invoice_due_date', documents: 'posted', balance_semantics: 'current_outstanding_balance', as_of_role: 'age_reference_only',
      historical_balance_rebuilt: false, balance_as_of: 'generation_time', age_reference: 'as_of', reconciled_to_control_ledger: false,
    },
    buckets: [{ key: 'b0_30', days_past_due: '0-30', includes_not_yet_due: true }],
    totals: { b0_30: money(10_000), b31_60: money(20_000), b61_90: money(0), b90_plus: money(5_000), total: money(35_000) },
    partner_detail: 'included',
    rows: [{ partner_id: 'p1', name: 'شركة النور', b0_30: money(10_000), b31_60: money(20_000), b61_90: money(0), b90_plus: money(5_000), total: money(35_000) }],
    warnings: withWarning ? [{ code: 'as_of_not_historical', as_of: '2026-09-30', balance_as_of: '2026-10-16T09:00:00+03:00' }] : [],
  };
}

export function toolCall(kind: 'income' | 'aging' = 'income'): ToolCall {
  return kind === 'income'
    ? { tool: 'finance.income_statement', result: incomeResult() }
    : { tool: 'finance.receivables_aging', result: agingResult() };
}

export function messageResponse(calls: ToolCall[] = [toolCall('income')]): MessageResponse {
  return {
    request_id: 'req-1', status: 'ok', attempt: 1, provider: 'mock', locale: 'en',
    message: { role: 'assistant', content: 'This is a deterministic mock response.' },
    data_categories: ['assistant_messages', 'financial_summary'],
    scope_kind: 'authorization',
    scope: { branch: { mode: 'assigned', ids: [] }, warehouse: { mode: 'assigned', ids: ['w1'] } },
    usage: { input_tokens: 1, output_tokens: 1 },
    tool_calls: calls,
  };
}
