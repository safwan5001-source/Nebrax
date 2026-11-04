/**
 * قواعد القرار الفردي في الواجهة (D-PS-16) — **مرآة للخادم لا بديلاً عنه**: تُظهر الحقل وتمنع الإرسال الواضح الخطأ مبكراً فقط؛ الخادم (`PartnerStatementReviewService::decide`) يعيد كل
 * فحص ولا يُخفَّف شيء منه هنا. عند أي اختلاف يغلب رفض الخادم ويُعرض مترجماً.
 *
 * السبب (≥ 3 أحرف بعد القصّ) إلزامي في:
 *  - `override` · `dismiss` · كل `link_pair`
 *  - `confirm` حين نتيجة المحرّك ليست `matched` (أي `amount_difference` أو `date_difference` **ولو كان الفرق المالي صفراً**)
 *  - أي قرار يكون صافي فرقه المالي **غير صفري ولو داخل التسامح**
 * وحده `confirm` على `matched` بفرق صفري بلا سبب. `clear` لا يتطلب سبباً.
 */
import { CONFIRMABLE_OUTCOMES, type DecisionAction, type DecisionRequest, type MatchOutcome, type MatchRow, type PairMember } from './types';

export const MIN_REASON_LENGTH = 3;
export const MAX_REASON_LENGTH = 500;
export const MAX_UNIT_SET = 50;

/** طول السبب بعد القصّ بمحارف Unicode (يطابق `mb_strlen(trim())`) — لا نعدّ وحدات UTF-16. */
export function reasonLength(reason: string): number {
  return Array.from(reason.trim()).length;
}

export function isReasonValid(reason: string): boolean {
  const length = reasonLength(reason);
  return length >= MIN_REASON_LENGTH && length <= MAX_REASON_LENGTH;
}

export interface ReasonContext {
  action: DecisionAction;
  /** نتيجة المحرّك للسطر في التشغيلة. */
  engineOutcome: MatchOutcome | string | null;
  /** صافي الفرق المالي بالهللات إن عُرف (اقتراح المحرّك أو نتيجة verify-set)؛ `null` = غير معروف. */
  netDifferenceMinor: number | null;
}

/**
 * هل السبب إلزامي؟ **عدم معرفة الفرق (`null`) لا تُعفي**: فرق مجهول لقرار `confirm` يُعامَل كغير صفري (محافظ) كي لا نخفي حقلاً يلزمه الخادم.
 */
export function reasonRequired(context: ReasonContext): boolean {
  switch (context.action) {
    case 'clear':
      return false;
    case 'override':
    case 'dismiss':
    case 'link_pair':
      return true;
    case 'confirm':
      if (context.engineOutcome !== 'matched') return true;
      return context.netDifferenceMinor === null || context.netDifferenceMinor !== 0;
  }
}

/** الفرق خارج التسامح المجمَّد ⇒ إقرار صريح (`accept_difference`) إلزامي في confirm/override/link_pair (الاستبعاد يقبله الخادم من تلقاء نفسه). */
export function acceptDifferenceRequired(differenceMinor: number | null, toleranceMinor: number): boolean {
  return differenceMinor !== null && Math.abs(differenceMinor) > toleranceMinor;
}

export type DecisionBlock =
  | 'reason_required'
  | 'reason_too_long'
  | 'accept_required'
  | 'units_required'
  | 'units_too_many'
  | 'pair_member_required'
  | 'not_confirmable'
  | 'dismiss_not_allowed';

export interface DecisionDraft {
  action: DecisionAction;
  row: Pick<MatchRow, 'outcome' | 'unit_key'>;
  reason: string;
  unitKeys: string[];
  acceptDifference: boolean;
  pairMember: PairMember | null;
  netDifferenceMinor: number | null;
  toleranceMinor: number;
}

/** أول مانع يمنع الإرسال، أو `null` إن كان القرار صالحاً للإرسال. الترتيب ثابت ليظهر السبب الأقرب للمستخدم. */
export function blockingIssue(draft: DecisionDraft): DecisionBlock | null {
  const { action } = draft;
  if (action === 'confirm' && (!CONFIRMABLE_OUTCOMES.includes(draft.row.outcome) || draft.row.unit_key === null)) return 'not_confirmable';
  if (action === 'dismiss' && draft.row.outcome !== 'missing_in_books') return 'dismiss_not_allowed';
  if (action === 'override' && draft.unitKeys.length === 0) return 'units_required';
  if ((action === 'override' || action === 'link_pair') && draft.unitKeys.length > MAX_UNIT_SET) return 'units_too_many';
  if (action === 'link_pair') {
    if (draft.unitKeys.length !== 1) return 'units_required';
    if (draft.pairMember === null) return 'pair_member_required';
  }
  if (draft.reason.trim() !== '' && reasonLength(draft.reason) > MAX_REASON_LENGTH) return 'reason_too_long';
  if (reasonRequired({ action, engineOutcome: draft.row.outcome, netDifferenceMinor: draft.netDifferenceMinor }) && !isReasonValid(draft.reason)) return 'reason_required';
  const accepts = action === 'confirm' || action === 'override' || action === 'link_pair';
  if (accepts && acceptDifferenceRequired(draft.netDifferenceMinor, draft.toleranceMinor) && !draft.acceptDifference) return 'accept_required';

  return null;
}

/** جسم `POST …/decisions` من مسودة صالحة. لا يُرسَل إلا ما يقبله الخادم لكل إجراء (المعاملات المجهولة ⇒ 422). */
export function buildDecisionRequest(runId: string, lineId: string, draft: DecisionDraft): DecisionRequest {
  const request: DecisionRequest = { run_id: runId, line_id: lineId, action: draft.action };
  const reason = draft.reason.trim();
  if (draft.action === 'override' || draft.action === 'link_pair') request.unit_keys = [...draft.unitKeys];
  if (draft.action === 'link_pair' && draft.pairMember) request.pair_member = draft.pairMember;
  if (reason !== '' && draft.action !== 'clear') request.reason = reason;
  if ((draft.action === 'confirm' || draft.action === 'override' || draft.action === 'link_pair') && draft.acceptDifference) request.accept_difference = true;
  return request;
}

/** مفتاح تفرّد طلب قرار لمنع الإرسال المكرر (نفس السطر والتشغيلة والإجراء والوحدات والسبب). */
export function decisionKey(request: DecisionRequest): string {
  return JSON.stringify([request.line_id, request.run_id, request.action, [...(request.unit_keys ?? [])].sort(), request.pair_member ?? null, request.reason ?? null, request.accept_difference === true]);
}

/** قرار فعّال صالح للتشغيلة الحالية؟ (قرار على تشغيلة أخرى لا يُحتسب: الخادم يعدّه `decisions_on_other_runs` ويمنع المراجعة). */
export function decisionState(row: Pick<MatchRow, 'decision'>, runId: string | null): 'none' | 'current' | 'other_run' {
  const decision = row.decision;
  if (!decision) return 'none';
  return runId !== null && decision.run_id === runId ? 'current' : 'other_run';
}

/** فهرس أول سطر بلا قرار **صالح** بعد `fromIndex` (دائرياً)؛ `-1` إن لم يوجد ضمن المحمَّل. */
export function nextUndecidedIndex(rows: readonly Pick<MatchRow, 'decision'>[], fromIndex: number, runId: string | null): number {
  const total = rows.length;
  for (let step = 1; step <= total; step += 1) {
    const index = (fromIndex + step + total) % total;
    if (decisionState(rows[index], runId) !== 'current') return index;
  }
  return -1;
}
