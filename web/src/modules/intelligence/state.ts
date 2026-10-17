import { ApiError } from '@/lib/api';
import type { CapabilityState } from './contract';

/**
 * كل حالة تعرضها الواجهة بدل نتيجة. المفتاح هو **رمز الخادم الفعلي** (`error.code`) حيث يوجد، وإلا حالة HTTP.
 * لا نصّ يُعرض على أنه «نتيجة» ما لم يُنتجها الخادم فعلاً.
 */
export type NoticeKey =
  | CapabilityState
  | 'tool_permission_denied'
  | 'branch_scope_forbidden'
  | 'warehouse_scope_forbidden'
  | 'scope_not_supported'
  | 'invalid_tool_arguments'
  | 'invalid_request'
  | 'budget_not_configured'
  | 'budget_exceeded'
  | 'platform_budget_exceeded'
  | 'pricing_unknown'
  | 'acknowledgement_required'
  | 'data_category_unavailable'
  | 'duplicate_request'
  | 'document_unavailable'
  | 'document_not_reviewed'
  | 'document_quarantined'
  | 'document_scan_incomplete'
  | 'document_on_hold'
  | 'document_retention_ended'
  | 'document_projection_unavailable'
  | 'rate_limited'
  | 'network_error'
  | 'server_error'
  | 'unknown_error';

/** رموز الخادم التي تُترجَم مباشرة إلى حالة. */
const CODE_TO_NOTICE: Record<string, NoticeKey> = {
  platform_disabled: 'platform_disabled',
  provider_unavailable: 'provider_unavailable',
  tenant_not_enabled: 'tenant_disabled',
  tenant_inactive: 'tenant_disabled',
  consent_required: 'consent_required',
  data_category_unavailable: 'data_category_unavailable',
  permission_denied: 'permission_denied',
  actor_unavailable: 'permission_denied',
  actor_inactive: 'permission_denied',
  tool_permission_denied: 'tool_permission_denied',
  branch_scope_forbidden: 'branch_scope_forbidden',
  warehouse_scope_forbidden: 'warehouse_scope_forbidden',
  scope_not_supported: 'scope_not_supported',
  invalid_tool_arguments: 'invalid_tool_arguments',
  invalid_request: 'invalid_request',
  currency_unsupported: 'currency_unsupported',
  budget_not_configured: 'budget_not_configured',
  budget_exceeded: 'budget_exceeded',
  platform_budget_exceeded: 'platform_budget_exceeded',
  pricing_unknown: 'pricing_unknown',
  acknowledgement_required: 'acknowledgement_required',
  duplicate_request: 'duplicate_request',
  request_in_progress: 'duplicate_request',
  idempotency_key_reuse: 'invalid_request',
  too_many_tool_calls: 'invalid_request',
  internal_error: 'server_error',
  document_unavailable: 'document_unavailable',
  document_not_reviewed: 'document_not_reviewed',
  document_quarantined: 'document_quarantined',
  document_scan_incomplete: 'document_scan_incomplete',
  document_on_hold: 'document_on_hold',
  document_retention_ended: 'document_retention_ended',
  document_projection_unavailable: 'document_projection_unavailable',
};

export interface ClassifiedError {
  notice: NoticeKey;
  /** رمز الخادم الخام إن وُجد — للتشخيص فقط (يُعرض بخط ثابت لا كنص مترجَم). */
  code: string | null;
  status: number | null;
  /** يستحق إعادة قراءة الحالة (صلاحية/موافقة/تفعيل قد تغيّرت منذ آخر قراءة). */
  refreshStatus: boolean;
  retryable: boolean;
}

const STATE_CHANGING: ReadonlySet<NoticeKey> = new Set([
  'permission_denied', 'platform_disabled', 'tenant_disabled', 'consent_required', 'tool_permission_denied',
  'provider_unavailable', 'currency_unsupported', 'data_category_unavailable', 'category_unavailable', 'document_center_unavailable',
]);

export function errorCode(body: unknown): string | null {
  if (body && typeof body === 'object') {
    const error = (body as { error?: unknown }).error;
    if (error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string') {
      return (error as { code: string }).code;
    }
  }
  return null;
}

export function classifyError(error: unknown): ClassifiedError {
  if (error instanceof ApiError) {
    const code = errorCode(error.body);
    let notice: NoticeKey;
    if (code !== null && code in CODE_TO_NOTICE) notice = CODE_TO_NOTICE[code];
    else if (error.status === 429) notice = 'rate_limited';
    else if (error.status === 403) notice = 'permission_denied';
    else if (error.status === 422) notice = 'invalid_request';
    else if (error.status >= 500) notice = 'server_error';
    else notice = 'unknown_error';

    return {
      notice,
      code,
      status: error.status,
      refreshStatus: STATE_CHANGING.has(notice),
      retryable: notice === 'rate_limited' || notice === 'server_error' || notice === 'network_error',
    };
  }

  // fetch رمى قبل أي استجابة: لا خادم وصل، فلا ندّعي شيئاً عن النتيجة.
  return { notice: 'network_error', code: null, status: null, refreshStatus: false, retryable: true };
}

/** هل الحالة تمنع المحادثة/التشغيل قبل أي طلب؟ */
export function isBlocked(state: CapabilityState): boolean {
  return state !== 'ready';
}
