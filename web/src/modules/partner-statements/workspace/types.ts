/**
 * عقد مساحة المطابقة والمراجعة (IMP-PS-A4b) — أنواع فوق REST القائم (match · matches · lines · verify-set · decisions · reversed-pairs · status · review · reopen · events).
 * النقود بالهللات `*_minor`؛ لا حساب مالي هنا. **الخادم هو السلطة**: هذه الأنواع وصفٌ لما يعيده لا ضمان له (الحقول الاختيارية دفاعية).
 */
import type { PageMeta, ReconciliationRow } from '../contract';

export const MATCH_OUTCOMES = [
  'matched',
  'amount_difference',
  'date_difference',
  'ambiguous',
  'missing_in_books',
  'missing_in_statement',
  'needs_review',
  'neutralised',
  'incomplete',
] as const;
export type MatchOutcome = (typeof MATCH_OUTCOMES)[number];

/** نتائج جهة الكشف (تُراجَع بقرار) — `missing_in_statement` جهة دفتر معلوماتية لا تمنع المراجعة. */
export const STATEMENT_OUTCOMES: readonly MatchOutcome[] = ['matched', 'amount_difference', 'date_difference', 'ambiguous', 'missing_in_books', 'needs_review'];
/** النتائج القابلة للتأكيد باقتراح المحرّك (تحرسها `PartnerStatementReviewService::CONFIRMABLE`). */
export const CONFIRMABLE_OUTCOMES: readonly MatchOutcome[] = ['matched', 'amount_difference', 'date_difference'];

export const DECISION_ACTIONS = ['confirm', 'override', 'dismiss', 'link_pair', 'clear'] as const;
export type DecisionAction = (typeof DECISION_ACTIONS)[number];
export type PairMember = 'original' | 'reversal';

export interface StatementLine {
  id: string;
  ordinal: number;
  date: string;
  reference: string | null;
  our_reference: string | null;
  description: string | null;
  debit_minor: number;
  credit_minor: number;
  balance_minor: number | null;
  kind: string | null;
}

export interface UnitSnapshot {
  key: string;
  kind: string | null;
  doc_number: string | null;
  date: string | null;
  direction: 'debit' | 'credit' | string | null;
  amount_minor: number;
  state: string;
  entry_numbers?: string[] | null;
  entry_ids?: string[] | null;
}

export interface Suggestion {
  suggestion: true;
  unit_keys: string[];
  sum_minor: number;
  difference_minor: number;
}

export interface Explanation {
  code: string;
  params?: Record<string, unknown>;
}

export interface MatchWarning {
  code: string;
  params?: Record<string, unknown>;
}

export interface Decision {
  id: string;
  reconciliation_id: string;
  run_id: string;
  line_id: string;
  revision: number;
  action: DecisionAction;
  unit_keys: string[] | null;
  engine_outcome: string | null;
  engine_code: string | null;
  pair: { member: PairMember; original_entry_id: string | null; reversal_entry_id: string | null } | null;
  expected_net_minor: number | null;
  set_net_minor: number | null;
  difference_minor: number | null;
  accepted_difference: boolean;
  reason: string | null;
  created_by: string | null;
  created_at: string | null;
}

export interface MatchRow {
  id: string;
  side: 'statement' | 'ledger';
  line_id: string | null;
  ordinal: number | null;
  outcome: MatchOutcome;
  rule: string | null;
  unit_key: string | null;
  difference_minor: number | null;
  day_difference: number | null;
  explanation: Explanation | null;
  warnings: MatchWarning[];
  unit: UnitSnapshot | null;
  candidates: UnitSnapshot[] | null;
  suggestions: Suggestion[] | null;
  /** إضافة N3 (جهة الكشف فقط). */
  line?: StatementLine | null;
  decision?: Decision | null;
}

export interface RunSummary {
  id: string;
  reconciliation_id: string;
  created: boolean;
  replayed: boolean;
  engine_version: string | number;
  status: string;
  policy: Record<string, unknown>;
  scope: Record<string, unknown>;
  ledger_fingerprint: string;
  /** مفاتيح بصيغة `{side}.{outcome}` (مثل `statement.matched` و`ledger.missing_in_statement`). */
  counts: Record<string, number>;
  created_at: string | null;
}

export interface MatchesResponse {
  data: MatchRow[];
  run: RunSummary | null;
  ledger_changed: boolean | null;
  meta: PageMeta;
}

export interface LinesResponse {
  data: StatementLine[];
  meta: PageMeta;
}

export interface ReconciliationHeader extends ReconciliationRow {
  policy: {
    version?: number;
    currency?: string;
    date_tolerance_days: number;
    amount_tolerance_minor: number;
    amount_direction?: string | null;
    include_reversed?: boolean;
    branch_id?: string | null;
  } | null;
  checks: Record<string, unknown> | null;
  source_import_job_id: string | null;
  reviewed_by: string | null;
  reviewed_run_id: string | null;
  closed_by: string | null;
  voided_by: string | null;
  void_reason: string | null;
}

export interface Blocker {
  code: string;
  message?: string;
  count?: number;
  sample_ordinals?: number[];
  causes?: unknown[];
}

export interface ReviewedState {
  run_id: string | null;
  ledger_changed_since_review: boolean;
  statement_changed_since_review: boolean;
}

export interface StatusResponse {
  reconciliation: {
    id: string;
    status: ReconciliationRow['status'];
    reviewed_at: string | null;
    reviewed_by: string | null;
    reviewed_run_id: string | null;
  } & Record<string, unknown>;
  run: { id: string; scope: Record<string, unknown>; ledger_fingerprint: string; created_at: string | null } | null;
  readiness: {
    lines_total: number;
    resolved: number;
    unresolved: number;
    decisions_on_other_runs: number;
    decisions_by_action: Partial<Record<DecisionAction, number>>;
    can_mark_reviewed: boolean;
  };
  blockers: Blocker[];
  reviewed_state: ReviewedState | null;
  close: { available: boolean; blocked_reason: string | null };
  void: { available: boolean; blocked_reason: string | null; separation_policy?: string };
  final: unknown;
}

export interface VerifyProblem {
  code: string;
  params?: Record<string, unknown>;
}

export interface VerifySetResponse {
  applied: false;
  line: { id: string; ordinal: number; date: string; debit_minor: number; credit_minor: number };
  units: { key: string; kind: string | null; doc_number: string | null; date: string | null; state: string; direction: string | null; net_minor: number }[];
  expected_net_minor: number;
  set_net_minor: number;
  difference_minor: number;
  tolerance_minor: number;
  equal_within_tolerance: boolean;
  problems: VerifyProblem[];
}

export interface PairMemberView {
  entry_id: string;
  number: string | null;
  date: string | null;
  net_minor: number;
  claimed: boolean;
  line_id: string | null;
}

export interface ReversedPair {
  unit_key: string;
  kind: string | null;
  state: string;
  reasons: string[];
  entry_numbers: string[] | null;
  reviewable: boolean;
  blocked_reason: string | null;
  original?: PairMemberView;
  reversal?: PairMemberView;
}

export interface ReversedPairsResponse {
  pairs: ReversedPair[];
  truncated: boolean;
}

export interface ReconciliationEvent {
  id: string;
  seq: number;
  action: string;
  from_status: string | null;
  to_status: string | null;
  run_id: string | null;
  reason: string | null;
  created_by: string | null;
  created_at: string | null;
  summary: Record<string, unknown> | null;
}

export interface DecisionRequest {
  run_id: string;
  line_id: string;
  action: DecisionAction;
  unit_keys?: string[];
  reason?: string;
  accept_difference?: boolean;
  pair_member?: PairMember;
}

export interface DecisionResponse {
  data: Decision | null;
  replayed: boolean;
  warnings: MatchWarning[];
}
