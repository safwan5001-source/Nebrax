// أنواع الذكاء الرقابي (Phase 2). المبالغ تصل بالريال كنص من الـ API؛ المعدّلات
// بمقياس ×1000 (milli). الدرجة/الشدّة/الأساس كلها خادمية لا يرسلها العميل.

export type Severity = 'watch' | 'review' | 'priority';
export type Band = 'normal' | 'watch' | 'review' | 'priority';
export type ReviewState = 'new' | 'reviewing' | 'explained' | 'dismissed' | 'needs_investigation';
export type Confidence = 'server_authoritative' | 'client_observed';

export interface ExceptionExplanation {
  rule_key: string;
  category: string;
  observed_rate_milli: number;
  baseline_rate_milli: number | null;
  baseline_type: string;
  per: number;
  denominator_kind: string;
  numerator: number;
  denominator: number;
  sample_size: number;
  sample_sufficient: boolean;
  window_days: number;
  confidence: Confidence;
  evidence_query?: { user_id: string; types: string[]; from: string; to: string };
  amount_event_ids?: string[];
}

export interface ExceptionReviewRow {
  id: string;
  from_state: string | null;
  to_state: string;
  reviewed_by: string | null;
  reviewer_name: string | null;
  reason: string | null;
  note: string | null;
  created_at: string | null;
}

export interface PosExceptionRow {
  id: string;
  branch_id: string | null;
  rule_key: string;
  category: string;
  rule_version: number;
  severity: Severity;
  risk_contribution: number;
  observed_count: number;
  denominator: number;
  observed_rate_milli: number;
  baseline_rate_milli: number | null;
  baseline_type: string;
  sample_size: number;
  amount_under_review: string;
  amount_under_review_minor: number;
  evidence_confidence: Confidence;
  subject_user_id: string | null;
  pos_session_id: string | null;
  performed_by: string | null;
  approved_by: string | null;
  window_start: string | null;
  window_end: string | null;
  detected_at: string | null;
  review_state: ReviewState;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_reason: string | null;
  review_note: string | null;
  explanation: ExceptionExplanation;
  rule_snapshot: Record<string, unknown> | null;
  subject?: { id: string; name: string } | null;
  performer?: { id: string; name: string } | null;
  approver?: { id: string; name: string } | null;
  reviewer?: { id: string; name: string } | null;
  session?: { id: string; number: string } | null;
  reviews?: ExceptionReviewRow[];
}

export interface RiskComponent {
  points: number;
  raw_points: number;
  rules: Array<{
    rule_key: string;
    severity: Severity;
    contribution: number;
    observed_rate_milli: number;
    baseline_rate_milli: number | null;
    baseline_type: string;
    confidence: Confidence;
    exception_id: string;
  }>;
}

export interface RiskSnapshotRow {
  subject_user_id: string;
  subject_name: string;
  branch_id: string | null;
  total_score: number;
  band: Band;
  exception_count: number;
  amount_under_review: string;
  amount_under_review_minor: number;
  sample_size: number;
  sample_sufficient: boolean;
  components: Record<string, RiskComponent>;
  window_start: string | null;
  window_end: string | null;
  calculated_at: string | null;
}

export interface IntelligenceOverview {
  needs_review_count: number;
  priority_count: number;
  review_count: number;
  watch_count: number;
  amount_under_review: string;
  subjects_needing_review: number;
  state_breakdown: Record<string, number>;
  band_breakdown: Record<string, number>;
}

export interface RelationshipRow {
  performed_by: string;
  performer_name: string;
  approved_by: string;
  approver_name: string;
  approvals: number;
  last_at: string | null;
  flagged_severity: Severity | null;
}

export interface RuleRow {
  id: string;
  rule_key: string;
  category: string;
  is_enabled: boolean;
  weight: number;
  min_sample: number;
  window_days: number;
  threshold: number;
  version: number;
}

export interface Paginated<T> {
  data: T[];
  meta: { total: number; per_page: number; current_page: number; last_page: number };
}
