/**
 * AWJ Intelligence (AI-03) — عقد الواجهة مع الخادم، مأخوذ من التنفيذ الفعلي (لا مختلق):
 *   GET  /ai-assistant/status          حالة المستخدم الحالي (AiAssistantStatusService)
 *   PUT  /ai-assistant/settings        موافقة المؤسسة (ai.consent.manage)
 *   POST /ai-assistant/messages        محادثة تجريبية (ai.assistant.use)
 *   POST /ai-assistant/tools/run       تشغيل صريح لأداة قراءة مالية من السجل المغلق (ai.assistant.use)
 *   GET  /ai-assistant/audit-events    سجل التدقيق الوصفي (ai.audit.view)
 *
 * الأرقام المالية تصل من الخادم كـ`{minor, decimal}`؛ الواجهة تعرض `decimal` ولا تحسب شيئاً.
 */

export type ToolName = 'finance.income_statement' | 'finance.receivables_aging' | 'finance.payables_aging';

export const TOOL_NAMES: readonly ToolName[] = [
  'finance.income_statement',
  'finance.receivables_aging',
  'finance.payables_aging',
];

export type CapabilityState =
  | 'ready'
  | 'permission_denied'
  | 'platform_disabled'
  | 'tenant_disabled'
  | 'consent_required'
  | 'provider_unavailable'
  | 'currency_unsupported'
  /** AI-04: فئة نصّ المستند غير متاحة على المنصة (مفتاح المنصة المستقل مغلق). */
  | 'category_unavailable'
  /** AI-04: قدرة مركز المستندات غير مستحقة لهذه المؤسسة. */
  | 'document_center_unavailable'
  /** AI-07: المزوّد خارجي ولم يُقرّ مالك المؤسسة بإرسال بيانات المساعد إليه. */
  | 'external_provider_not_acknowledged';

export type DataCategoryKey = 'assistant_messages' | 'financial_summary' | 'document_projected_text';

export interface AssistantStatus {
  platform_enabled: boolean;
  /** `external` (AI-07): مزوّد خارجي جاهز؛ يُسمّى في `provider_label`. */
  provider_mode: 'mock' | 'external' | 'unavailable';
  provider_label?: 'anthropic' | null;
  /** `external_acknowledged` يظهر فقط حين يكون المزوّد المضبوط خارجياً. */
  tenant: { enabled: boolean; consented_categories: DataCategoryKey[]; external_acknowledged?: boolean };
  categories: { key: DataCategoryKey; available: boolean; consented: boolean }[];
  abilities: { use: boolean; manage_consent: boolean; view_audit: boolean; partner_detail: boolean; document_read: boolean };
  chat: CapabilityState;
  financial: CapabilityState;
  financial_tools: ToolName[];
  /** AI-04: قراءة مستند مُسقَط — حالة محسوبة في الخادم (لا تخمين من العميل). */
  document: CapabilityState;
  document_tools: string[];
  clock: { timezone: string; today: string };
}

export interface Money {
  minor: number;
  decimal: string;
}

export interface ScopeBlock {
  branch: { mode: 'all' | 'selected' | 'assigned'; ids: string[] };
  warehouse: {
    mode: 'not_applicable' | 'all' | 'selected' | 'assigned';
    ids: string[];
    reason?: string;
    user_restriction_applied?: boolean;
  };
}

export interface SourceRef {
  type: string;
  service: string;
  api_path: string;
  ui_path: string;
}

export interface ResultWarning {
  code: string;
  as_of?: string;
  balance_as_of?: string;
}

interface ResultEnvelope {
  schema_version: number;
  currency: string;
  minor_unit: number;
  currency_assumption: string;
  scope: ScopeBlock;
  timezone: string;
  generated_at: string;
  sources: SourceRef[];
}

export interface StatementLine {
  code: string;
  name: string;
  amount: Money;
}

export interface IncomeStatementResult extends ResultEnvelope {
  report: 'income_statement';
  period: { from: string; to: string; inclusive: boolean };
  basis: { method: string; entries: string; date_field: string; excludes: string };
  totals: { total_revenue: Money; total_expense: Money; net_income: Money };
  revenues: StatementLine[];
  expenses: StatementLine[];
  unallocated?: { total_revenue: Money; total_expense: Money; net_income: Money };
}

export interface AgingBuckets {
  b0_30: Money;
  b31_60: Money;
  b61_90: Money;
  b90_plus: Money;
  total: Money;
}

export interface AgingRow extends AgingBuckets {
  partner_id: string;
  name: string | null;
}

export interface AgingResult extends ResultEnvelope {
  report: 'receivables_aging' | 'payables_aging';
  as_of: string;
  basis: {
    method: string;
    documents: string;
    balance_semantics: string;
    as_of_role: string;
    historical_balance_rebuilt: boolean;
    balance_as_of: string;
    age_reference: string;
    reconciled_to_control_ledger: boolean;
  };
  buckets: { key: string; days_past_due: string; includes_not_yet_due: boolean }[];
  totals: AgingBuckets;
  partner_detail: 'included' | 'withheld';
  rows: AgingRow[];
  warnings: ResultWarning[];
}

export type FinancialResult = IncomeStatementResult | AgingResult;

export interface ToolCall {
  tool: ToolName;
  result: FinancialResult;
}

export interface ToolRunResponse {
  request_id: string;
  status: 'ok';
  tool_calls: ToolCall[];
}

export interface MessageResponse {
  request_id: string;
  status: 'ok';
  attempt: number;
  provider: string;
  locale: 'ar' | 'en';
  message: { role: 'assistant'; content: string };
  data_categories: DataCategoryKey[];
  /** نطاق **التفويض** لا مرشّح بيانات — راجع `scope_kind`. */
  scope_kind: 'authorization';
  scope: { branch: ScopeBlock['branch']; warehouse: { mode: string; ids: string[] } };
  usage: { input_tokens: number; output_tokens: number };
  tool_calls: ToolCall[];
}

export interface AuditEvent {
  id: string;
  request_id: string;
  actor_id: string | null;
  event: string;
  tool: string | null;
  outcome: 'allowed' | 'denied' | 'error';
  reason: string;
  occurred_at: string;
}

export interface SettingsPayload {
  enabled: boolean;
  consented_categories: DataCategoryKey[];
  acknowledge_privacy?: boolean;
  /** AI-07: إقرار بإرسال الرسائل وملخّصات الأرقام إلى مزوّد خارجي (يُسحب بالتعطيل أو بقيمة `false`). */
  acknowledge_external_provider?: boolean;
}

export const MESSAGE_MAX_CHARS = 2000;
export const MAX_PERIOD_DAYS = 366;

/** مفتاح الرسائل لاسم أداة (`finance.income_statement` → `income_statement`) — النقطة محظورة في مفاتيح next-intl. */
export function toolKey(tool: ToolName): 'income_statement' | 'receivables_aging' | 'payables_aging' {
  return tool.slice('finance.'.length) as 'income_statement' | 'receivables_aging' | 'payables_aging';
}

/* ───────────────────────── AI-04: قراءة مستند مُسقَط ───────────────────────── */

export const DOCUMENT_TOOL = 'documents.projected_read';

export type DocumentFieldType = 'text' | 'money' | 'flag';

export interface DocumentEntry {
  key: string;
  type: DocumentFieldType;
  /** `null` حين يكون الحقل منقَّحاً (`redacted`). النصّ بيانات غير موثوقة: يُعرض نصاً خاماً فقط. */
  value: string | number | boolean | null;
  /** للمبالغ: القيمة بالريال كما أرسلها الخادم — لا حساب في الواجهة. */
  decimal?: string;
  redacted: boolean;
}

export interface DocumentProjection {
  report: 'document_projection';
  schema_version: number;
  document: {
    ref: string;
    document_type: string;
    status: string;
    language: string | null;
    extracted_at: string | null;
    page_count: number;
  };
  basis: {
    values: string;
    redaction: string;
    content_trust: string;
    generated_by_model: boolean;
    redacted_values: number;
  };
  fields: DocumentEntry[];
  lines: { index: number; fields: DocumentEntry[] }[];
  warnings: string[];
  truncated: { fields: boolean; lines: boolean; warnings: boolean };
  timezone: string;
  generated_at: string;
  sources: { type: string; service: string; ui_path: string }[];
}

export interface DocumentToolRunResponse {
  request_id: string;
  status: 'ok';
  tool_calls: { tool: typeof DOCUMENT_TOOL; result: DocumentProjection }[];
}
